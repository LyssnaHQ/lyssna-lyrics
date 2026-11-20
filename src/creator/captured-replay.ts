const legacySampleRate = 48_000;
const channels = 2;
const pcm24Bytes = 3;

export type ReplayPacket = {
  uri: string;
  startFrame: number;
  sampleRate: number;
  samples: Int32Array;
};
export type SavedRecording = { blob: Blob; startMs: number; endMs: number; full: boolean };

type Range = { start: number; end: number };
type Tile = { uri: string; index: number; samples: Int16Array | Uint8Array; ranges: Range[] };
type TrackRecording = { uri: string; frames: number; sampleRate?: number };
export type RecordingCoverage = { uri: string; frames: number; sampleRate: number };

export function couldBeComplete(frames: number, duration: number, sampleRate: number) {
  const total = Math.round(duration * sampleRate / 1000);
  return total > 0 && frames >= Math.max(total * 0.95, total - Math.round(sampleRate * 0.56));
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

type TileWrite = { offset: number; samples: Int32Array };

function writeTiles(packets: ReplayPacket[], framesPerTile: number) {
  const changes = new Map<number, TileWrite[]>();
  for (const { startFrame, samples } of packets) {
    const end = startFrame + samples.length / channels;
    for (let frame = Math.max(startFrame, 0); frame < end;) {
      const index = Math.floor(frame / framesPerTile);
      const offset = frame - index * framesPerTile;
      const next = Math.min(end, (index + 1) * framesPerTile);
      const part = samples.subarray((frame - startFrame) * channels, (next - startFrame) * channels);
      const write = { offset, samples: part };
      const existing = changes.get(index);
      if (existing) existing.push(write);
      else changes.set(index, [write]);
      frame = next;
    }
  }
  return changes;
}

async function savePackets(uri: string, packets: ReplayPacket[]) {
  const { sampleRate } = packets[0];
  const framesPerTile = sampleRate;
  const changes = writeTiles(packets, framesPerTile);
  if (!changes.size) return;
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  const tiles = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const trackRequest = tracks.get(uri);
  let remaining = changes.size;
  const summary = { uri, sampleRate, frames: 0 };
  trackRequest.onsuccess = () => {
    const previous: TrackRecording | undefined = trackRequest.result;
    // Every tile for a song uses the same sample rate, including legacy captures.
    if (previous?.frames && (previous.sampleRate ?? legacySampleRate) !== sampleRate) {
      transaction.abort();
      return;
    }
    summary.frames = previous?.frames ?? 0;
    for (const [index, writes] of changes) {
      const request = tiles.get([uri, index]);
      request.onsuccess = () => {
        const tile: Tile = request.result ?? { uri, index, samples: new Uint8Array(framesPerTile * channels * pcm24Bytes), ranges: [] };
        const packed = tile.samples instanceof Int16Array ? packPcm24(tile.samples) : tile.samples;
        const before = coverage(tile.ranges);
        for (const { offset, samples } of writes) {
          packed.set(packPcm24(samples), offset * channels * pcm24Bytes);
          tile.ranges.push({ start: offset, end: offset + samples.length / channels });
        }
        tile.samples = packed;
        tile.ranges = mergeRanges(tile.ranges);
        summary.frames += coverage(tile.ranges) - before;
        tiles.put(tile);
        if (--remaining === 0) tracks.put(summary);
      };
    }
  };
  await done;
  return summary;
}

export async function recordedCoverage(uri: string): Promise<RecordingCoverage | undefined> {
  const db = await openRecording();
  const track: TrackRecording | undefined = await result(db.transaction("tracks").objectStore("tracks").get(uri));
  if (track) return { ...track, sampleRate: track.sampleRate ?? legacySampleRate };
}

async function deleteRecording(uri: string) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  transaction.objectStore("tiles").delete(tileRange(uri));
  transaction.objectStore("tracks").delete(uri);
  await done;
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

async function readRecording(uri: string, positionMs: number, duration: number, completeOnly: boolean): Promise<SavedRecording | undefined> {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"]);
  const [tiles, track]: [Tile[], TrackRecording | undefined] = await Promise.all([
    result(transaction.objectStore("tiles").getAll(tileRange(uri))),
    result(transaction.objectStore("tracks").get(uri)),
  ]);
  if (!tiles.length) return;
  const sampleRate = track?.sampleRate ?? legacySampleRate;
  const framesPerTile = sampleRate;
  const edgeTolerance = Math.round(sampleRate * 0.25);
  const gapTolerance = Math.round(sampleRate * 0.06);
  const bytesPerSample = tiles.some(({ samples }) => samples instanceof Uint8Array) ? pcm24Bytes : 2;
  const bytesPerFrame = channels * bytesPerSample;
  const total = Math.min(Math.ceil(duration * sampleRate / 1000), Math.floor((0xffffffff - 36) / bytesPerFrame));
  const timeline = tiles.flatMap(({ index, ranges }) => ranges.map(({ start, end }) => ({
    start: index * framesPerTile + start, end: Math.min(total, index * framesPerTile + end),
  })).filter(({ start, end }) => end > start));
  const position = Math.round(positionMs * sampleRate / 1000);
  const distance = (range: Range) => Math.max(range.start - position, position - range.end, 0);
  const ranges = mergeRanges(timeline, gapTolerance);
  const full = ranges.length === 1 && ranges[0].start <= edgeTolerance && ranges[0].end >= total - edgeTolerance &&
    couldBeComplete(coverage(timeline), duration, sampleRate);
  if (completeOnly && !full) return;
  const selected = full ? { start: 0, end: total } : ranges.filter(({ start, end }) => end - start >= sampleRate / 2)
    .sort((a, b) => distance(a) - distance(b) || (b.end - b.start) - (a.end - a.start))[0];
  if (!selected) return;

  const { start, end } = selected;
  const parts: BlobPart[] = [wavHeader(end - start, sampleRate, bytesPerSample)];
  const byIndex = new Map(tiles.map((tile) => [tile.index, tile]));
  for (let index = Math.floor(start / framesPerTile); index * framesPerTile < end; index++) {
    const first = Math.max(0, start - index * framesPerTile);
    const last = Math.min(framesPerTile, end - index * framesPerTile);
    const samples = byIndex.get(index)?.samples;
    if (samples instanceof Uint8Array) {
      parts.push(samples.slice(first * bytesPerFrame, last * bytesPerFrame));
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
