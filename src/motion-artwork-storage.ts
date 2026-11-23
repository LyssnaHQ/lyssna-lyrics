export const motionArtworkBudget = 2_000_000_000;
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
  if (blob.size > motionArtworkBudget) return;
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  const store = transaction.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    const entries = (request.result as Entry[]).filter((entry) => entry.key !== key);
    let bytes = entries.reduce((total, entry) => total + entry.blob.size, blob.size);
    if (bytes > motionArtworkBudget) {
      entries.sort((a, b) => a.usedAt - b.usedAt);
      for (const entry of entries) {
        if (bytes <= motionArtworkBudget) break;
        store.delete(entry.key);
        bytes -= entry.blob.size;
      }
    }
    store.put({ key, blob, usedAt: Date.now() } satisfies Entry);
  };
  await done;
}

export async function cachedMotionArtworkBytes() {
  return (await listStoredMotionArtwork()).reduce((total, { bytes }) => total + bytes, 0);
}

export async function listStoredMotionArtwork() {
  const db = await openCache();
  const transaction = db.transaction(storeName);
  const done = complete(transaction);
  const request = transaction.objectStore(storeName).getAll();
  await done;
  return (request.result as Entry[]).sort((a, b) => b.usedAt - a.usedAt)
    .map(({ key, blob }) => ({ key, bytes: blob.size }));
}

export async function deleteStoredMotionArtwork(key: string) {
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  transaction.objectStore(storeName).delete(key);
  await done;
}

export async function clearStoredMotionArtwork() {
  const db = await openCache();
  const transaction = db.transaction(storeName, "readwrite");
  const done = complete(transaction);
  transaction.objectStore(storeName).clear();
  await done;
}
