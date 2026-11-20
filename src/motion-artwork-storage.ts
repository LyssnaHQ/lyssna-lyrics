const budget = 256 * 1024 * 1024;
const storeName = "covers";
type Entry = { key: string; blob: Blob; usedAt: number };

let database: Promise<IDBDatabase> | undefined;

function openCache() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lyssna-motion-artwork", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "key" });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readStoredMotionArtwork(key: string) {
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  const store = transaction.objectStore(storeName);
  const request = store.get(key);
  request.onsuccess = () => {
    const entry: Entry | undefined = request.result;
    if (entry && Date.now() - entry.usedAt > 60_000) store.put({ ...entry, usedAt: Date.now() });
  };
  await done;
  return (request.result as Entry | undefined)?.blob;
}

export async function saveMotionArtwork(key: string, blob: Blob) {
  if (blob.size > budget) return;
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  const store = transaction.objectStore(storeName);
  store.put({ key, blob, usedAt: Date.now() } satisfies Entry);
  const request = store.getAll();
  request.onsuccess = () => {
    const entries: Entry[] = request.result;
    let bytes = entries.reduce((total, entry) => total + entry.blob.size, 0);
    if (bytes <= budget) return;
    entries.sort((a, b) => a.usedAt - b.usedAt);
    for (const entry of entries) {
      if (bytes <= budget) break;
      if (entry.key === key) continue;
      store.delete(entry.key);
      bytes -= entry.blob.size;
    }
  };
  await done;
}

export async function cachedMotionArtworkBytes() {
  const db = await openCache();
  const transaction = db.transaction(storeName);
  const done = complete(transaction);
  const request = transaction.objectStore(storeName).getAll();
  await done;
  return (request.result as Entry[]).reduce((total, entry) => total + entry.blob.size, 0);
}

export async function clearStoredMotionArtwork() {
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  transaction.objectStore(storeName).clear();
  await done;
}
