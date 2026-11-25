import { canEncodeOpus, decodeRecordingOpus, encodeRecordingOpus, opusSampleRate, type OpusRecording } from "./recording-opus";

const legacySampleRate = 48_000;
const channels = 2;
const pcm24Bytes = 3;
const recordingEdgeToleranceMs = 250;
const recordingGapToleranceMs = 60;

export type ReplayPacket = {
  uri: string;
  duration: number;
  startFrame: number;
  sampleRate: number;
  samples: Int32Array;
  bitrate?: number;
};
export type SavedRecording = { blob: Blob; startMs: number; endMs: number; full: boolean };

type Range = { start: number; end: number };
type Tile = {
  uri: string; index: number; samples: Int16Array | Uint8Array; ranges: Range[];
  bitrate?: number; writeId?: string; opus?: Omit<OpusRecording, "bytes">;
};
type CompactionCandidate = { tile: Tile; bitrate: number };
type TrackRecording = { uri: string; frames: number; sampleRate?: number; bytes?: number; savedAt?: number; sealed?: boolean };
export type RecordingCoverage = { uri: string; frames: number; sampleRate: number; sealed?: boolean };

// Audio and spectrograms live in separate databases. Serialize their writes
// for the same song across Spotify windows before checking completion.
export function withRecordingWrite<T>(uri: string, write: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(`lyssna-recording:${uri}`, write) : write();
}

export function couldBeComplete(frames: number, duration: number, sampleRate: number) {
  const total = Math.round(duration * sampleRate / 1000);
  return total > 0 && frames >= Math.max(total * 0.95, total - Math.round(sampleRate * 0.56));
}

export function recordingPercent(saved: RecordingCoverage | undefined, duration: number, full: boolean) {
  if (!saved?.frames || duration <= 0) return;
  return full || saved.sealed ? 100 : Math.max(1, Math.min(99, Math.round(100 * saved.frames / (duration * saved.sampleRate / 1000))));
}

let database: Promise<IDBDatabase> | undefined;
function openRecording() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lyssna-ttml-recorded-audio", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("tiles", { keyPath: ["uri", "index"] });
      request.result.createObjectStore("tracks", { keyPath: "uri" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

const tileRange = (uri: string) => IDBKeyRange.bound([uri, 0], [uri, Number.MAX_SAFE_INTEGER]);
// Older builds only read bare Spotify URIs, so they never treat compressed bytes as PCM.
const opusUri = (uri: string) => `opus:${uri}`;
const coverage = (ranges: Range[]) => ranges.reduce((sum, { start, end }) => sum + end - start, 0);
const tileBytes = (tile: Tile) => tile.samples.byteLength +
  (tile.opus ? tile.opus.packetSizes.byteLength + tile.opus.description.byteLength : 0);

function mergeRanges(ranges: Range[], tolerance = 0) {
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + tolerance) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function packPcm24(samples: Int32Array | Int16Array) {
  const packed = new Uint8Array(samples.length * pcm24Bytes);
  // Preserve older 16-bit samples exactly by putting their bits in the upper two bytes.
  const shift = samples instanceof Int16Array ? 8 : 0;
  for (let i = 0, offset = 0; i < samples.length; i++, offset += pcm24Bytes) {
    const value = samples[i] << shift;
    packed[offset] = value;
    packed[offset + 1] = value >> 8;
    packed[offset + 2] = value >> 16;
  }
  return packed;
}

type TileWrite = { offset: number; samples: Int32Array; bitrate?: number };

function writeTiles(packets: ReplayPacket[], framesPerTile: number) {
  const changes = new Map<number, TileWrite[]>();
  for (const { startFrame, samples, bitrate } of packets) {
    const end = startFrame + samples.length / channels;
    for (let frame = Math.max(startFrame, 0); frame < end;) {
      const index = Math.floor(frame / framesPerTile);
      const offset = frame - index * framesPerTile;
      const next = Math.min(end, (index + 1) * framesPerTile);
      const part = samples.subarray((frame - startFrame) * channels, (next - startFrame) * channels);
      const write = { offset, samples: part, bitrate };
      const existing = changes.get(index);
      if (existing) existing.push(write);
      else changes.set(index, [write]);
      frame = next;
    }
  }
  return changes;
}

function resampleReplay(packet: ReplayPacket, sampleRate: number): ReplayPacket {
  if (sampleRate === packet.sampleRate) return packet;
  const ratio = sampleRate / packet.sampleRate;
  const frames = packet.samples.length / channels;
  const startFrame = Math.round(packet.startFrame * ratio);
  const endFrame = Math.round((packet.startFrame + frames) * ratio);
  const samples = new Int32Array((endFrame - startFrame) * channels);
  for (let index = 0; index < endFrame - startFrame; index++) {
    const source = Math.max(0, Math.min(frames - 1, (startFrame + index) / ratio - packet.startFrame));
    const first = Math.floor(source);
    const next = Math.min(frames - 1, first + 1);
    for (let channel = 0; channel < channels; channel++) {
      const before = packet.samples[first * channels + channel];
      const after = packet.samples[next * channels + channel];
      samples[index * channels + channel] = Math.round(before + (after - before) * (source - first));
    }
  }
  return { ...packet, sampleRate, startFrame, samples };
}

function recordingTimeline(tiles: Tile[], sampleRate: number, total: number, duration: number) {
  const edgeTolerance = Math.round(sampleRate * recordingEdgeToleranceMs / 1000);
  const gapTolerance = Math.round(sampleRate * recordingGapToleranceMs / 1000);
  const timeline = mergeRanges(tiles.flatMap(({ index, ranges }) => ranges.map(({ start, end }) => ({
    start: index * sampleRate + start, end: Math.min(total, index * sampleRate + end),
  })).filter(({ start, end }) => end > start)));
  const ranges = mergeRanges(timeline, gapTolerance);
  const full = ranges.length === 1 && ranges[0].start <= edgeTolerance && ranges[0].end >= total - edgeTolerance &&
    couldBeComplete(coverage(timeline), duration, sampleRate);
  return { timeline, ranges, full };
}

async function sealRecording(tracks: IDBObjectStore, tiles: IDBObjectStore, raw: TrackRecording | undefined,
  compact: TrackRecording | undefined, uri: string, duration: number) {
  if (raw?.sealed || compact?.sealed) return true;
  const record = raw ?? compact;
  const sampleRate = raw?.sampleRate ?? compact?.sampleRate ?? legacySampleRate;
  if (!record || !couldBeComplete((raw?.frames ?? 0) + (compact?.frames ?? 0), duration, sampleRate)) return false;
  const [rawTiles, encodedTiles] = await Promise.all([
    result<Tile[]>(tiles.getAll(tileRange(uri))), result<Tile[]>(tiles.getAll(tileRange(opusUri(uri)))),
  ]);
  const byIndex = new Map(rawTiles.map((tile) => [tile.index, tile]));
  if (sampleRate === opusSampleRate) for (const tile of encodedTiles) byIndex.set(tile.index, tile);
  const { full } = recordingTimeline([...byIndex.values()], sampleRate, Math.ceil(duration * sampleRate / 1000), duration);
  if (full) tracks.put({ ...record, sealed: true });
  return full;
}

async function savePackets(uri: string, packets: ReplayPacket[]) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  const tiles = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const duration = packets[0].duration;
  const candidates: CompactionCandidate[] = [];
  const writeId = crypto.randomUUID();
  const encodedUri = opusUri(uri);
  let summary: RecordingCoverage | undefined;
  try {
    const [previous, compact] = await Promise.all([
      result<TrackRecording | undefined>(tracks.get(uri)), result<TrackRecording | undefined>(tracks.get(encodedUri)),
    ]);
    const sealed = await sealRecording(tracks, tiles, previous, compact, uri, duration);
    if (!sealed) {
      const compactFrames = compact?.frames ?? 0;
      const sampleRate = previous?.frames ? previous.sampleRate ?? legacySampleRate : compact?.sampleRate ??
        (canEncodeOpus() && packets[0].bitrate ? opusSampleRate : packets[0].sampleRate);
      const changes = writeTiles(packets.map((packet) => resampleReplay(packet, sampleRate)), sampleRate);
      const next: TrackRecording = {
        uri, sampleRate, frames: previous?.frames ?? 0, bytes: previous ? previous.bytes : 0, savedAt: Date.now(),
      };
      await Promise.all([...changes].map(async ([index, writes]) => {
        if (compactFrames && await result(tiles.getKey([encodedUri, index]))) return;
        const existing = await result<Tile | undefined>(tiles.get([uri, index]));
        const tile: Tile = existing ?? { uri, index, samples: new Uint8Array(sampleRate * channels * pcm24Bytes), ranges: [] };
        const previousBytes = existing ? tileBytes(tile) : 0;
        const packed = tile.samples instanceof Int16Array ? packPcm24(tile.samples) : tile.samples;
        const before = coverage(tile.ranges);
        let bitrate = before ? tile.bitrate : writes[0].bitrate;
        for (const { offset, samples, bitrate: source } of writes) {
          packed.set(packPcm24(samples), offset * channels * pcm24Bytes);
          tile.ranges.push({ start: offset, end: offset + samples.length / channels });
          bitrate = bitrate && source ? Math.max(bitrate, source) : undefined;
        }
        tile.samples = packed;
        tile.ranges = mergeRanges(tile.ranges);
        tile.bitrate = bitrate;
        tile.writeId = writeId;
        const frames = coverage(tile.ranges);
        next.frames += frames - before;
        if (next.bytes !== undefined) next.bytes += tileBytes(tile) - previousBytes;
        tiles.put(tile);
        if (bitrate && sampleRate === opusSampleRate && frames === sampleRate) candidates.push({ tile, bitrate });
      }));
      if (changes.size) {
        tracks.put(next);
        const sealed = await sealRecording(tracks, tiles, next, compact, uri, duration);
        summary = { uri, sampleRate, frames: next.frames + compactFrames, sealed };
      }
    }
  } catch (error) {
    try { transaction.abort(); } catch { /* The request may already have aborted the transaction. */ }
    await done.catch(() => {});
    throw error;
  }
  await done;
  return { summary, candidates };
}

async function compactRecordings(candidates: CompactionCandidate[]) {
  const db = await openRecording();
  for (const { tile, bitrate } of candidates) {
    const packed = tile.samples;
    if (!(packed instanceof Uint8Array)) continue;
    try {
      const opus = await encodeRecordingOpus(packed, bitrate);
      if (opus && opus.bytes.byteLength < packed.byteLength) await compactTile(db, tile, opus);
    } catch { /* Keep the PCM layout if the client can't encode or store Opus. */ }
  }
}

async function compactTile(db: IDBDatabase, tile: Tile, { bytes, ...opus }: OpusRecording) {
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  const tiles = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const key = [tile.uri, tile.index];
  const current = tiles.get(key);
  current.onsuccess = () => {
    if (current.result?.writeId !== tile.writeId) return;
    const raw = tracks.get(tile.uri);
    raw.onsuccess = () => {
      const previous: TrackRecording | undefined = raw.result;
      if (!previous || previous.sealed) return;
      const uri = opusUri(tile.uri);
      const encoded = tracks.get(uri);
      encoded.onsuccess = () => {
        const compact: TrackRecording | undefined = encoded.result;
        if (compact?.sealed) return;
        const packed = { ...tile, uri, samples: bytes, opus } satisfies Tile;
        tracks.put({
          ...previous,
          frames: Math.max(0, previous.frames - opusSampleRate),
          bytes: previous.bytes === undefined ? undefined : previous.bytes - tileBytes(current.result),
        });
        tracks.put({
          uri, sampleRate: opusSampleRate, frames: (compact?.frames ?? 0) + opusSampleRate,
          bytes: compact && compact.bytes === undefined ? undefined : (compact?.bytes ?? 0) + tileBytes(packed),
          savedAt: previous.savedAt,
        });
        tiles.delete(key);
        tiles.put(packed);
      };
    };
  };
  await done;
}

export async function recordedCoverage(uri: string): Promise<RecordingCoverage | undefined> {
  const db = await openRecording();
  const store = db.transaction("tracks").objectStore("tracks");
  const [raw, compact]: (TrackRecording | undefined)[] = await Promise.all([result(store.get(uri)), result(store.get(opusUri(uri)))]);
  if (raw || compact) return { uri, frames: (raw?.frames ?? 0) + (compact?.frames ?? 0),
    sampleRate: compact?.sampleRate ?? raw?.sampleRate ?? legacySampleRate, sealed: raw?.sealed || compact?.sealed };
}

export async function deleteRecording(uri: string) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  transaction.objectStore("tiles").delete(tileRange(uri));
  transaction.objectStore("tiles").delete(tileRange(opusUri(uri)));
  transaction.objectStore("tracks").delete(uri);
  transaction.objectStore("tracks").delete(opusUri(uri));
  await done;
  window.dispatchEvent(new CustomEvent(savedAudioCleared, { detail: uri }));
}

export const savedAudioCleared = "lyssna-lyrics:saved-audio-cleared";

async function trackRecords() {
  const db = await openRecording();
  return result<TrackRecording[]>(db.transaction("tracks").objectStore("tracks").getAll());
}

export async function listRecordedTracks() {
  const tracks = new Map<string, { key: string; bytes?: number; savedAt: number }>();
  for (const record of await trackRecords()) {
    if (!record.frames) continue;
    const key = record.uri.replace(/^opus:/, "");
    const previous = tracks.get(key);
    tracks.set(key, {
      key,
      bytes: record.bytes === undefined || (previous && previous.bytes === undefined)
        ? undefined : record.bytes + (previous?.bytes ?? 0),
      savedAt: Math.max(record.savedAt ?? 0, previous?.savedAt ?? 0),
    });
  }
  return [...tracks.values()].sort((a, b) => b.savedAt - a.savedAt);
}

// Older recordings have coverage but no byte counts. Backfill once and
// commit the size alongside the record so future views only read metadata.
async function indexRecordingBytes(uri: string) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  let bytes = 0;
  const tracks = transaction.objectStore("tracks");
  const record = tracks.get(uri);
  record.onsuccess = () => {
    const track: TrackRecording | undefined = record.result;
    if (!track) return;
    if (track.bytes !== undefined) { bytes = track.bytes; return; }
    const request = transaction.objectStore("tiles").openCursor(tileRange(uri));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { tracks.put({ ...track, bytes }); return; }
      bytes += tileBytes(cursor.value);
      cursor.continue();
    };
  };
  await done;
  return bytes;
}

export async function savedAudioBytes() {
  const records = await trackRecords();
  let bytes = 0;
  for (const track of records) bytes += track.bytes ?? (track.frames ? await indexRecordingBytes(track.uri) : 0);
  return bytes;
}

export async function clearRecordedAudio() {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  transaction.objectStore("tiles").clear();
  transaction.objectStore("tracks").clear();
  await done;
  window.dispatchEvent(new Event(savedAudioCleared));
}

export function createCapturedReplay(onSaved: (summary: RecordingCoverage) => void, onError: () => void,
  saveSpectrum: () => Promise<void> | undefined) {
  const pending: ReplayPacket[] = [];
  let saving: Promise<void> | undefined;
  let compacting = false;

  function flush() {
    if (saving) return saving;
    if (!pending.length) return Promise.resolve();
    saving = (async () => {
      while (pending.length) {
        const batch = pending.splice(0, 10);
        await saveSpectrum();
        const byTrack = new Map<string, ReplayPacket[]>();
        for (const packet of batch) {
          const packets = byTrack.get(packet.uri);
          if (packets) packets.push(packet);
          else byTrack.set(packet.uri, [packet]);
        }
        for (const [uri, packets] of byTrack) {
          try {
            const { summary, candidates } = await withRecordingWrite(uri, () => savePackets(uri, packets));
            if (summary) onSaved(summary);
            if (!compacting && candidates.length) {
              // PCM is already durable. Keep it if the optional encoder is busy.
              compacting = true;
              void compactRecordings(candidates).catch(() => {}).finally(() => { compacting = false; });
            }
          } catch { onError(); }
        }
      }
    })().catch(onError).finally(() => { saving = undefined; });
    return saving;
  }

  return {
    append(packet: ReplayPacket) {
      pending.push(packet);
      if (pending.length >= 10) void flush();
    },
    flush,
    async read(uri: string, positionMs: number, duration: number, completeOnly = false) {
      await flush();
      return readRecording(uri, positionMs, duration, completeOnly);
    },
    async nextMissing(uri: string, duration: number, positionMs: number) {
      await flush();
      return nextMissingRecordingPosition(uri, duration, positionMs);
    },
    async remove(uri: string) {
      await flush();
      await deleteRecording(uri);
    },
  };
}

function wavHeader(frames: number, sampleRate: number, bytesPerSample: number) {
  const bytesPerFrame = channels * bytesPerSample;
  const byteLength = frames * bytesPerFrame;
  const header = new DataView(new ArrayBuffer(44));
  header.setUint32(0, 0x52494646); // RIFF
  header.setUint32(4, 36 + byteLength, true);
  header.setUint32(8, 0x57415645); // WAVE
  header.setUint32(12, 0x666d7420); // fmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * bytesPerFrame, true);
  header.setUint16(32, bytesPerFrame, true);
  header.setUint16(34, bytesPerSample * 8, true);
  header.setUint32(36, 0x64617461); // data
  header.setUint32(40, byteLength, true);
  return header.buffer;
}

async function readRecordingLayout(uri: string, duration: number) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"]);
  const tileStore = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const [rawTiles, encodedTiles, track]: [Tile[], Tile[], TrackRecording | undefined] = await Promise.all([
    result(tileStore.getAll(tileRange(uri))), result(tileStore.getAll(tileRange(opusUri(uri)))), result(tracks.get(uri)),
  ]);
  const sampleRate = track?.frames || !encodedTiles.length ? track?.sampleRate ?? legacySampleRate : opusSampleRate;
  const byIndex = new Map(rawTiles.map((tile) => [tile.index, tile]));
  if (sampleRate === opusSampleRate) for (const tile of encodedTiles) byIndex.set(tile.index, tile);
  if (byIndex.size === 0) return;
  const framesPerTile = sampleRate;
  const tiles = [...byIndex.values()];
  const bytesPerSample = tiles.some(({ samples }) => samples instanceof Uint8Array) ? pcm24Bytes : 2;
  const bytesPerFrame = channels * bytesPerSample;
  const total = Math.min(Math.ceil(duration * sampleRate / 1000), Math.floor((0xffffffff - 36) / bytesPerFrame));
  const { timeline, ranges, full } = recordingTimeline(tiles, framesPerTile, total, duration);
  return { byIndex, sampleRate, bytesPerSample, bytesPerFrame, total, timeline, ranges, full };
}

async function nextMissingRecordingPosition(uri: string, duration: number, positionMs: number) {
  const layout = await readRecordingLayout(uri, duration);
  if (!layout || layout.full) return;
  const { timeline, total, sampleRate } = layout;
  const gaps: Range[] = [];
  let end = 0;
  for (const range of timeline) {
    if (range.start > end) gaps.push({ start: end, end: range.start });
    end = range.end;
  }
  if (end < total) gaps.push({ start: end, end: total });
  const significant = gaps.filter((gap) => {
    const edge = gap.start === 0 || gap.end === total;
    const tolerance = edge ? recordingEdgeToleranceMs : recordingGapToleranceMs;
    return gap.end - gap.start > Math.round(sampleRate * tolerance / 1000);
  });
  const candidates = significant.length ? significant : gaps;
  const position = positionMs * sampleRate / 1000;
  const next = candidates.find((gap) => gap.end > position) ?? candidates[0];
  // Give capture time to settle after the seek before the gap begins.
  return next && Math.max(0, next.start * 1000 / sampleRate - 1000);
}

export async function isRecordingComplete(uri: string, duration: number) {
  const coverage = await recordedCoverage(uri);
  if (coverage?.sealed) return true;
  if (!coverage || !couldBeComplete(coverage.frames, duration, coverage.sampleRate)) return false;
  return (await readRecordingLayout(uri, duration))?.full ?? false;
}

async function readRecording(uri: string, positionMs: number, duration: number, completeOnly: boolean, includeGaps = false): Promise<SavedRecording | undefined> {
  const layout = await readRecordingLayout(uri, duration);
  if (!layout) return;
  const { byIndex, sampleRate, bytesPerSample, bytesPerFrame, total, ranges, full } = layout;
  if (completeOnly && !full) return;
  const position = Math.round(positionMs * sampleRate / 1000);
  const distance = (range: Range) => Math.max(range.start - position, position - range.end, 0);
  const selected = full ? { start: 0, end: total }
    : includeGaps && ranges.length ? { start: ranges[0].start, end: ranges.at(-1)!.end }
    : ranges.filter(({ start, end }) => end - start >= sampleRate / 2)
      .sort((a, b) => distance(a) - distance(b) || (b.end - b.start) - (a.end - a.start))[0];
  if (!selected) return;

  const { start, end } = selected;
  const parts: BlobPart[] = [wavHeader(end - start, sampleRate, bytesPerSample)];
  const framesPerTile = sampleRate;
  for (let index = Math.floor(start / framesPerTile); index * framesPerTile < end; index++) {
    const first = Math.max(0, start - index * framesPerTile);
    const last = Math.min(framesPerTile, end - index * framesPerTile);
    const tile = byIndex.get(index);
    const samples = tile?.samples;
    if (samples instanceof Uint8Array) {
      const pcm = tile?.opus ? await decodeRecordingOpus({ ...tile.opus, bytes: samples.slice() }, framesPerTile) : samples;
      parts.push(pcm.slice(first * bytesPerFrame, last * bytesPerFrame));
    } else if (samples) {
      const old = samples.slice(first * channels, last * channels);
      parts.push(bytesPerSample === pcm24Bytes ? packPcm24(old) : old);
    } else {
      parts.push(new Uint8Array((last - first) * bytesPerFrame));
    }
  }
  return {
    blob: new Blob(parts, { type: "audio/wav" }),
    startMs: start * 1000 / sampleRate,
    endMs: end * 1000 / sampleRate,
    full,
  };
}

export function readStoredRecording(uri: string, duration = Infinity) {
  return readRecording(uri, 0, duration > 0 ? duration : Infinity, false, true);
}
