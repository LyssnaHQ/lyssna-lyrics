import { canEncodeOpus, decodeRecordingOpus, encodeRecordingOpus, opusSampleRate, type OpusRecording } from "./recording-opus";

const legacySampleRate = 48_000;
const channels = 2;
const pcm24Bytes = 3;

export type ReplayPacket = {
  uri: string;
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
type TrackRecording = { uri: string; frames: number; sampleRate?: number };
export type RecordingCoverage = { uri: string; frames: number; sampleRate: number };

export function couldBeComplete(frames: number, duration: number, sampleRate: number) {
  const total = Math.round(duration * sampleRate / 1000);
  return total > 0 && frames >= Math.max(total * 0.95, total - Math.round(sampleRate * 0.56));
}

export function recordingPercent(saved: RecordingCoverage | undefined, duration: number, full: boolean) {
  if (!saved?.frames || duration <= 0) return;
  return full ? 100 : Math.max(1, Math.min(99, Math.round(100 * saved.frames / (duration * saved.sampleRate / 1000))));
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

async function savePackets(uri: string, packets: ReplayPacket[]) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  const tiles = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const trackRequest = tracks.get(uri);
  const candidates: { tile: Tile; bitrate: number }[] = [];
  const writeId = crypto.randomUUID();
  const encodedUri = opusUri(uri);
  let summary: RecordingCoverage | undefined;
  trackRequest.onsuccess = () => {
    const previous: TrackRecording | undefined = trackRequest.result;
    const compactRecord = tracks.get(encodedUri);
    compactRecord.onsuccess = () => {
      const compact: TrackRecording | undefined = compactRecord.result;
      const compactFrames = compact?.frames ?? 0;
      const sampleRate = previous?.frames ? previous.sampleRate ?? legacySampleRate : compact?.sampleRate ??
        (canEncodeOpus() && packets[0].bitrate ? opusSampleRate : packets[0].sampleRate);
      const changes = writeTiles(packets.map((packet) => resampleReplay(packet, sampleRate)), sampleRate);
      let remaining = changes.size;
      if (!remaining) return;
      const next = { uri, sampleRate, frames: previous?.frames ?? 0 };
      function finishTile() {
        if (--remaining !== 0) return;
        tracks.put(next);
        summary = { ...next, frames: next.frames + compactFrames };
      }

      for (const [index, writes] of changes) {
        const write = () => {
          const request = tiles.get([uri, index]);
          request.onsuccess = () => {
            const tile: Tile = request.result ?? { uri, index, samples: new Uint8Array(sampleRate * channels * pcm24Bytes), ranges: [] };
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
            tiles.put(tile);
            if (bitrate && sampleRate === opusSampleRate && frames === sampleRate) candidates.push({ tile, bitrate });
            finishTile();
          };
        };
        if (compactFrames) {
          const request = tiles.getKey([encodedUri, index]);
          request.onsuccess = () => { if (request.result) finishTile(); else write(); };
        } else write();
      }
    };
  };
  await done;
  for (const { tile, bitrate } of candidates) {
    const packed = tile.samples;
    if (!(packed instanceof Uint8Array)) continue;
    try {
      const opus = await encodeRecordingOpus(packed, bitrate);
      if (opus && opus.bytes.byteLength < packed.byteLength) await compactTile(db, tile, opus);
    } catch { /* Keep the PCM layout if the client can't encode or store Opus. */ }
  }
  return summary;
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
      if (!previous) return;
      const uri = opusUri(tile.uri);
      const encoded = tracks.get(uri);
      encoded.onsuccess = () => {
        tracks.put({ ...previous, frames: Math.max(0, previous.frames - opusSampleRate) });
        tracks.put({ uri, sampleRate: opusSampleRate, frames: (encoded.result?.frames ?? 0) + opusSampleRate });
        tiles.delete(key);
        tiles.put({ ...tile, uri, samples: bytes, opus } satisfies Tile);
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
    sampleRate: compact?.sampleRate ?? raw?.sampleRate ?? legacySampleRate };
}

async function deleteRecording(uri: string) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  transaction.objectStore("tiles").delete(tileRange(uri));
  transaction.objectStore("tiles").delete(tileRange(opusUri(uri)));
  transaction.objectStore("tracks").delete(uri);
  transaction.objectStore("tracks").delete(opusUri(uri));
  await done;
}

export const savedAudioCleared = "lyssna-lyrics:saved-audio-cleared";

export async function savedAudioBytes() {
  const db = await openRecording();
  const transaction = db.transaction("tiles");
  const done = complete(transaction);
  let bytes = 0;
  const request = transaction.objectStore("tiles").openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const tile: Tile = cursor.value;
    bytes += tile.samples.byteLength + (tile.opus ? tile.opus.packetSizes.byteLength + tile.opus.description.byteLength : 0);
    cursor.continue();
  };
  await done;
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

export function createCapturedReplay(onSaved: (summary: RecordingCoverage) => void, onError: () => void) {
  let pending: ReplayPacket[] = [];
  let saving = Promise.resolve();
  let queued = 0;

  function flush() {
    if (!pending.length) return saving;
    const batch = pending;
    pending = [];
    queued++;
    saving = saving.then(async () => {
      const byTrack = new Map<string, ReplayPacket[]>();
      for (const packet of batch) {
        const packets = byTrack.get(packet.uri);
        if (packets) packets.push(packet);
        else byTrack.set(packet.uri, [packet]);
      }
      for (const [uri, packets] of byTrack) {
        const summary = await savePackets(uri, packets);
        if (summary) onSaved(summary);
      }
    }).catch(onError).finally(() => { queued--; });
    return saving;
  }

  return {
    append(packet: ReplayPacket) {
      if (queued >= 10) {
        onError();
        return;
      }
      pending.push(packet);
      if (pending.length >= 10) void flush();
    },
    flush,
    async read(uri: string, positionMs: number, duration: number, completeOnly = false) {
      await flush();
      return readRecording(uri, positionMs, duration, completeOnly);
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
  const edgeTolerance = Math.round(sampleRate * 0.25);
  const gapTolerance = Math.round(sampleRate * 0.06);
  const tiles = [...byIndex.values()];
  const bytesPerSample = tiles.some(({ samples }) => samples instanceof Uint8Array) ? pcm24Bytes : 2;
  const bytesPerFrame = channels * bytesPerSample;
  const total = Math.min(Math.ceil(duration * sampleRate / 1000), Math.floor((0xffffffff - 36) / bytesPerFrame));
  const timeline = tiles.flatMap(({ index, ranges }) => ranges.map(({ start, end }) => ({
    start: index * framesPerTile + start, end: Math.min(total, index * framesPerTile + end),
  })).filter(({ start, end }) => end > start));
  const ranges = mergeRanges(timeline, gapTolerance);
  const full = ranges.length === 1 && ranges[0].start <= edgeTolerance && ranges[0].end >= total - edgeTolerance &&
    couldBeComplete(coverage(timeline), duration, sampleRate);
  return { byIndex, sampleRate, bytesPerSample, bytesPerFrame, total, ranges, full };
}

export async function isRecordingComplete(uri: string, duration: number) {
  return (await readRecordingLayout(uri, duration))?.full ?? false;
}

async function readRecording(uri: string, positionMs: number, duration: number, completeOnly: boolean): Promise<SavedRecording | undefined> {
  const layout = await readRecordingLayout(uri, duration);
  if (!layout) return;
  const { byIndex, sampleRate, bytesPerSample, bytesPerFrame, total, ranges, full } = layout;
  if (completeOnly && !full) return;
  const position = Math.round(positionMs * sampleRate / 1000);
  const distance = (range: Range) => Math.max(range.start - position, position - range.end, 0);
  const selected = full ? { start: 0, end: total } : ranges.filter(({ start, end }) => end - start >= sampleRate / 2)
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
