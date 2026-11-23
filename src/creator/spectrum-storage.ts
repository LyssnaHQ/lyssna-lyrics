export const LIVE_TILE_MS = 5_000;
export const LIVE_SAMPLE_MS = 20;
export const LIVE_COLUMNS = LIVE_TILE_MS / LIVE_SAMPLE_MS;
export const LIVE_ROWS = 256;
const tileBytes = LIVE_COLUMNS * (LIVE_ROWS * Uint16Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT);
export const MEASURED_COLUMN = 1;
export const INTERPOLATED_COLUMN = 2;

export type LiveTile = {
  uri: string;
  index: number;
  levels: Uint16Array;
  filled: Uint8Array;
};

let database: Promise<IDBDatabase> | undefined;
function openSpectrum() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lyssna-ttml-live-spectrum", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("tiles", { keyPath: ["uri", "index"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
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
  const db = await openSpectrum();
  return !!await result(db.transaction("tiles").objectStore("tiles").getKey(range(uri)));
}

export async function readLiveTiles(uri: string, first: number, last: number): Promise<LiveTile[]> {
  const db = await openSpectrum();
  return result(db.transaction("tiles").objectStore("tiles").getAll(range(uri, first, last)));
}

export const liveSpectrumCleared = "lyssna-lyrics:spectrograms-cleared";
export const liveSpectrumSaved = "lyssna-lyrics:spectrograms-saved";

export async function savedSpectrogramBytes() {
  const db = await openSpectrum();
  const count = await result(db.transaction("tiles").objectStore("tiles").count());
  return count * tileBytes;
}

export async function listSpectrogramTracks() {
  const db = await openSpectrum();
  const keys = await result(db.transaction("tiles").objectStore("tiles").getAllKeys()) as [string, number][];
  const entries = new Map<string, number>();
  for (const [uri] of keys) entries.set(uri, (entries.get(uri) ?? 0) + tileBytes);
  return [...entries].map(([key, bytes]) => ({ key, bytes }));
}

export async function clearLiveSpectrograms(uri?: string) {
  const db = await openSpectrum();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("tiles", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    const store = transaction.objectStore("tiles");
    if (uri) store.delete(range(uri));
    else store.clear();
  });
  window.dispatchEvent(new CustomEvent(liveSpectrumCleared, { detail: uri }));
}

export function mergeLiveTile(target: LiveTile, update: LiveTile, overwrite: boolean) {
  for (let column = 0; column < LIVE_COLUMNS; column++) {
    const incoming = update.filled[column];
    const existing = target.filled[column];
    if (!incoming || (existing === MEASURED_COLUMN && incoming === INTERPOLATED_COLUMN) ||
      (!overwrite && existing && existing === incoming)) continue;
    target.filled[column] = incoming;
    for (let row = 0; row < LIVE_ROWS; row++) {
      const offset = row * LIVE_COLUMNS + column;
      target.levels[offset] = update.levels[offset];
    }
  }
}

export async function saveLiveTiles(tiles: LiveTile[]) {
  const db = await openSpectrum();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("tiles", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    const store = transaction.objectStore("tiles");
    for (const tile of tiles) {
      const lookup = store.get([tile.uri, tile.index]);
      lookup.onsuccess = () => {
        const previous = lookup.result as LiveTile | undefined;
        if (previous) mergeLiveTile(previous, tile, true);
        store.put(previous ?? tile);
      };
    }
  });
  window.dispatchEvent(new CustomEvent(liveSpectrumSaved, { detail: tiles }));
}
