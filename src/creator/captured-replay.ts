export const replaySampleRate = 48_000;
const channels = 2;
const bytesPerFrame = channels * Int16Array.BYTES_PER_ELEMENT;
const framesPerTile = replaySampleRate;
const edgeTolerance = Math.round(replaySampleRate * 0.25);
const gapTolerance = Math.round(replaySampleRate * 0.06);

export type ReplayPacket = {
  uri: string;
  startFrame: number;
  samples: Int16Array;
};
export type SavedRecording = { blob: Blob; startMs: number; endMs: number; full: boolean };

type Range = { start: number; end: number };
type Tile = { uri: string; index: number; samples: Int16Array; ranges: Range[] };
type TrackRecording = { uri: string; frames: number };

export function couldBeComplete(frames: number, duration: number) {
  const total = Math.round(duration * replaySampleRate / 1000);
  return total > 0 && frames >= Math.max(total * 0.95, total - 2 * edgeTolerance - gapTolerance);
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

type TileWrite = { offset: number; samples: Int16Array };

function writeTiles(packets: ReplayPacket[]) {
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
  const changes = writeTiles(packets);
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  const tiles = transaction.objectStore("tiles");
  const tracks = transaction.objectStore("tracks");
  const trackRequest = tracks.get(uri);
  let frames = 0;
  let remaining = changes.size;
  // Queue the track summary after the tile reads, in the same transaction.
  for (const [index, writes] of changes) {
    const request = tiles.get([uri, index]);
    request.onsuccess = () => {
      const tile: Tile = request.result ?? { uri, index, samples: new Int16Array(framesPerTile * channels), ranges: [] };
      const before = coverage(tile.ranges);
      for (const { offset, samples } of writes) {
        tile.samples.set(samples, offset * channels);
        tile.ranges.push({ start: offset, end: offset + samples.length / channels });
      }
      tile.ranges = mergeRanges(tile.ranges);
      frames += coverage(tile.ranges) - before;
      tiles.put(tile);
      if (--remaining === 0) {
        frames += (trackRequest.result as TrackRecording | undefined)?.frames ?? 0;
        tracks.put({ uri, frames } satisfies TrackRecording);
      }
    };
  }
  await done;
  return changes.size ? frames : undefined;
}

export async function recordedFrames(uri: string) {
  const db = await openRecording();
  const track: TrackRecording | undefined = await result(db.transaction("tracks").objectStore("tracks").get(uri));
  return track?.frames ?? 0;
}

async function deleteRecording(uri: string) {
  const db = await openRecording();
  const transaction = db.transaction(["tiles", "tracks"], "readwrite");
  const done = complete(transaction);
  transaction.objectStore("tiles").delete(tileRange(uri));
  transaction.objectStore("tracks").delete(uri);
  await done;
}

export function createCapturedReplay(onSaved: (uri: string, frames: number) => void, onError: () => void) {
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
        const frames = await savePackets(uri, packets);
        if (frames !== undefined) onSaved(uri, frames);
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

function wavHeader(frames: number) {
  const byteLength = frames * bytesPerFrame;
  const header = new DataView(new ArrayBuffer(44));
  header.setUint32(0, 0x52494646); // RIFF
  header.setUint32(4, 36 + byteLength, true);
  header.setUint32(8, 0x57415645); // WAVE
  header.setUint32(12, 0x666d7420); // fmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, replaySampleRate, true);
  header.setUint32(28, replaySampleRate * bytesPerFrame, true);
  header.setUint16(32, bytesPerFrame, true);
  header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461); // data
  header.setUint32(40, byteLength, true);
  return header.buffer;
}

async function readRecording(uri: string, positionMs: number, duration: number, completeOnly: boolean): Promise<SavedRecording | undefined> {
  const db = await openRecording();
  const tiles: Tile[] = await result(db.transaction("tiles").objectStore("tiles").getAll(tileRange(uri)));
  const total = Math.min(Math.ceil(duration * replaySampleRate / 1000), Math.floor((0xffffffff - 36) / bytesPerFrame));
  const timeline = tiles.flatMap(({ index, ranges }) => ranges.map(({ start, end }) => ({
    start: index * framesPerTile + start, end: Math.min(total, index * framesPerTile + end),
  })).filter(({ start, end }) => end > start));
  const position = Math.round(positionMs * replaySampleRate / 1000);
  const distance = (range: Range) => Math.max(range.start - position, position - range.end, 0);
  const ranges = mergeRanges(timeline, gapTolerance);
  const full = ranges.length === 1 && ranges[0].start <= edgeTolerance && ranges[0].end >= total - edgeTolerance &&
    couldBeComplete(coverage(timeline), duration);
  if (completeOnly && !full) return;
  const selected = full ? { start: 0, end: total } : ranges.filter(({ start, end }) => end - start >= replaySampleRate / 2)
    .sort((a, b) => distance(a) - distance(b) || (b.end - b.start) - (a.end - a.start))[0];
  if (!selected) return;

  const { start, end } = selected;
  const parts: BlobPart[] = [wavHeader(end - start)];
  const byIndex = new Map(tiles.map((tile) => [tile.index, tile]));
  for (let index = Math.floor(start / framesPerTile); index * framesPerTile < end; index++) {
    const first = Math.max(0, start - index * framesPerTile);
    const last = Math.min(framesPerTile, end - index * framesPerTile);
    const tile = byIndex.get(index);
    parts.push(tile ? tile.samples.slice(first * channels, last * channels) : new Int16Array((last - first) * channels));
  }
  return {
    blob: new Blob(parts, { type: "audio/wav" }),
    startMs: start * 1000 / replaySampleRate,
    endMs: end * 1000 / replaySampleRate,
    full,
  };
}
