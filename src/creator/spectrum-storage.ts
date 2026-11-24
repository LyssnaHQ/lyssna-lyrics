import { isRecordingComplete, withRecordingWrite } from "./captured-replay";

export const LIVE_TILE_MS = 5_000;
export const LIVE_SAMPLE_MS = 10;
export const LIVE_COLUMNS = LIVE_TILE_MS / LIVE_SAMPLE_MS;
export const LIVE_ROWS = 512;
export const LIVE_FFT_SIZE = 8192;
export const TRANSIENT_FFT_SIZE = 2048;
const LEGACY_COLUMNS = LIVE_TILE_MS / 20;
const LEGACY_ROWS = 256;
const tileBytes = (columns: number, rows: number) => columns * (rows * Uint16Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT);
export const MEASURED_COLUMN = 1;
export const INTERPOLATED_COLUMN = 2;

export type LiveTile = {
  uri: string;
  index: number;
  levels: Uint16Array;
  filled: Uint8Array;
};

const databases = new Map<string, Promise<IDBDatabase>>();
// Keep the first format readable even when switching back to an older build.
const legacyDatabase = "lyssna-ttml-live-spectrum";
const currentDatabase = "lyssna-ttml-live-spectrum-hd";
function openSpectrum(name: string) {
  const cached = databases.get(name);
  if (cached) return cached;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("tiles", { keyPath: ["uri", "index"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databases.delete(name);
      reject(request.error);
    };
  });
  databases.set(name, opening);
  return opening;
}

function range(uri: string, first = 0, last = Number.MAX_SAFE_INTEGER) {
  return IDBKeyRange.bound([uri, first], [uri, last]);
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function hasLiveSpectrum(uri: string) {
  const keys = await Promise.all([currentDatabase, legacyDatabase].map(async name => {
    const db = await openSpectrum(name);
    return result(db.transaction("tiles").objectStore("tiles").getKey(range(uri)));
  }));
  return keys.some(Boolean);
}

export async function readLiveTiles(uri: string, first: number, last: number): Promise<LiveTile[]> {
  const [current, legacy] = await Promise.all([currentDatabase, legacyDatabase].map(async name => {
    const db = await openSpectrum(name);
    return result<LiveTile[]>(db.transaction("tiles").objectStore("tiles").getAll(range(uri, first, last)));
  }));
  const tiles = new Map(current.map(tile => [tile.index, tile]));
  for (const tile of legacy) {
    const existing = tiles.get(tile.index);
    tiles.set(tile.index, existing ? mergeLiveTile(existing, tile, false) : tile);
  }
  return [...tiles.values()].sort((left, right) => left.index - right.index);
}

export const liveSpectrumCleared = "lyssna-lyrics:spectrograms-cleared";
export const liveSpectrumSaved = "lyssna-lyrics:spectrograms-saved";

export async function savedSpectrogramBytes() {
  const count = async (name: string) => {
    const db = await openSpectrum(name);
    return result(db.transaction("tiles").objectStore("tiles").count());
  };
  const [current, legacy] = await Promise.all([count(currentDatabase), count(legacyDatabase)]);
  return current * tileBytes(LIVE_COLUMNS, LIVE_ROWS) + legacy * tileBytes(LEGACY_COLUMNS, LEGACY_ROWS);
}

export async function listSpectrogramTracks() {
  const keys = async (name: string) => {
    const db = await openSpectrum(name);
    return await result(db.transaction("tiles").objectStore("tiles").getAllKeys()) as [string, number][];
  };
  const [current, legacy] = await Promise.all([keys(currentDatabase), keys(legacyDatabase)]);
  const entries = new Map<string, number>();
  for (const [uri] of current) entries.set(uri, (entries.get(uri) ?? 0) + tileBytes(LIVE_COLUMNS, LIVE_ROWS));
  for (const [uri] of legacy) entries.set(uri, (entries.get(uri) ?? 0) + tileBytes(LEGACY_COLUMNS, LEGACY_ROWS));
  return [...entries].map(([key, bytes]) => ({ key, bytes }));
}

export async function clearLiveSpectrograms(uri?: string) {
  await Promise.all([currentDatabase, legacyDatabase].map(async name => {
    const db = await openSpectrum(name);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("tiles", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore("tiles");
      if (uri) store.delete(range(uri));
      else store.clear();
    });
  }));
  window.dispatchEvent(new CustomEvent(liveSpectrumCleared, { detail: uri }));
}

export function mergeLiveTile(target: LiveTile, update: LiveTile, overwrite: boolean) {
  const columns = target.filled.length;
  const incomingColumns = update.filled.length;
  if (columns < incomingColumns) {
    // Promote the preview buffer only. The previous recording stays in its own store.
    const promoted = { ...target, levels: new Uint16Array(update.levels.length), filled: new Uint8Array(incomingColumns) };
    mergeLiveTile(promoted, target, false);
    return mergeLiveTile(promoted, update, overwrite);
  }

  const rows = target.levels.length / columns;
  const incomingRows = update.levels.length / incomingColumns;
  if (columns !== incomingColumns) {
    for (let column = 0; column < columns; column++) {
      const source = Math.floor(column * incomingColumns / columns);
      if (target.filled[column] || !update.filled[source]) continue;
      target.filled[column] = INTERPOLATED_COLUMN;
      for (let row = 0; row < rows; row++) {
        target.levels[row * columns + column] = update.levels[Math.floor(row * incomingRows / rows) * incomingColumns + source];
      }
    }
    return target;
  }

  for (let column = 0; column < columns; column++) {
    const incoming = update.filled[column];
    const existing = target.filled[column];
    if (!incoming || (existing === MEASURED_COLUMN && incoming === INTERPOLATED_COLUMN) ||
      (!overwrite && existing && existing === incoming)) continue;
    target.filled[column] = incoming;
    for (let row = 0; row < rows; row++) {
      const offset = row * columns + column;
      target.levels[offset] = update.levels[offset];
    }
  }
  return target;
}

export function saveLiveTiles(uri: string, duration: number, tiles: LiveTile[]) {
  return withRecordingWrite(uri, async () => {
    if (await isRecordingComplete(uri, duration)) return false;
    const db = await openSpectrum(currentDatabase);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("tiles", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore("tiles");
      for (const tile of tiles) {
        const lookup = store.get([uri, tile.index]);
        lookup.onsuccess = () => {
          const previous = lookup.result as LiveTile | undefined;
          if (previous) mergeLiveTile(previous, tile, true);
          store.put(previous ?? tile);
        };
      }
    });
    window.dispatchEvent(new CustomEvent(liveSpectrumSaved, { detail: tiles }));
    return true;
  });
}
