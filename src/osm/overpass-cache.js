/**
 * IndexedDB cache for Overpass tile responses (#1962 step F).
 *
 * Worker-compatible (IndexedDB is available in workers; no DOM). One store
 * keyed by a caller-provided string (e.g. `buildings/17/x/y`), each row
 * `{ key, savedAt, payload }`. Callers pass a TTL on read; stale rows are
 * treated as misses and overwritten by the next put. Every operation
 * swallows storage failures into a miss/no-op — private windows and
 * storage-restricted contexts must degrade to network-only, never break
 * the layer.
 *
 * Shared by design: #1930's centerline fetcher caches under its own key
 * prefix in the same store.
 */

const DB_NAME = '3dstreet-osm-cache';
const STORE = 'overpass-tiles';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Cached payload for key, or null on miss/stale/storage failure. */
export async function cacheGet(key, ttlMs) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => {
        const row = request.result;
        if (!row || Date.now() - row.savedAt > ttlMs) resolve(null);
        else resolve(row.payload);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store payload for key (best-effort; resolves regardless of outcome). */
export async function cachePut(key, payload) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, savedAt: Date.now(), payload });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
