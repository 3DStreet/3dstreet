/**
 * 3DStreet Gallery Service Worker
 *
 * Provides offline-first caching for Firebase Storage images with:
 * - Cache-first strategy for Firebase Storage URLs
 * - LRU (Least Recently Used) eviction
 * - Quota-aware storage management
 * - Proactive cache warming for recent thumbnails
 */

const CACHE_NAME = '3dstreet-gallery-v1';
const FIREBASE_STORAGE_DOMAIN = 'firebasestorage.googleapis.com';
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const METADATA_DB_NAME = '3DStreetGalleryCacheMeta';
const METADATA_STORE_NAME = 'metadata';

/**
 * IndexedDB helper for storing cache metadata
 */
class CacheMetadata {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(METADATA_DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
          const store = db.createObjectStore(METADATA_STORE_NAME, { keyPath: 'url' });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('accessCount', 'accessCount', { unique: false });
        }
      };
    });
  }

  async updateAccess(url) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(METADATA_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(METADATA_STORE_NAME);
      const getRequest = store.get(url);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        const metadata = {
          url,
          lastAccessedAt: Date.now(),
          accessCount: (existing?.accessCount || 0) + 1,
          cachedAt: existing?.cachedAt || Date.now(),
          size: existing?.size || 0
        };

        const putRequest = store.put(metadata);
        putRequest.onsuccess = () => resolve(metadata);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getAllMetadata() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(METADATA_STORE_NAME, 'readonly');
      const store = transaction.objectStore(METADATA_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMetadata(url) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(METADATA_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(METADATA_STORE_NAME);
      const request = store.delete(url);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async setSize(url, size) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(METADATA_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(METADATA_STORE_NAME);
      const getRequest = store.get(url);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (existing) {
          existing.size = size;
          const putRequest = store.put(existing);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }
}

const cacheMetadata = new CacheMetadata();

/**
 * Check if URL is a Firebase Storage URL
 */
function isFirebaseStorageUrl(url) {
  return url.includes(FIREBASE_STORAGE_DOMAIN);
}

/**
 * Get LRU candidates for eviction
 * Returns URLs sorted by least recently used
 */
async function getLRUCandidates() {
  const metadata = await cacheMetadata.getAllMetadata();

  // Sort by lastAccessedAt ascending (oldest first)
  return metadata.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
}

/**
 * Prune cache to free up space
 * Removes oldest entries until approximately targetBytes are freed
 */
async function pruneCache(targetBytes = 10 * 1024 * 1024) { // Default: try to free 10MB
  try {
    const cache = await caches.open(CACHE_NAME);
    const candidates = await getLRUCandidates();

    let freedBytes = 0;
    let prunedCount = 0;

    // Remove oldest entries until we've freed enough space
    for (const metadata of candidates) {
      if (freedBytes >= targetBytes && prunedCount >= 5) {
        break; // Freed enough space and removed at least 5 entries
      }

      try {
        const deleted = await cache.delete(metadata.url);
        if (deleted) {
          await cacheMetadata.deleteMetadata(metadata.url);
          freedBytes += metadata.size || 0;
          prunedCount++;
        }
      } catch (error) {
        console.warn('Failed to delete cached item:', metadata.url, error);
      }
    }

    console.log(`Pruned ${prunedCount} cache entries, freed ~${Math.round(freedBytes / 1024 / 1024)}MB`);
    return prunedCount;
  } catch (error) {
    console.error('Cache pruning failed:', error);
    return 0;
  }
}

/**
 * Add response to cache with quota handling
 */
async function cacheResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);

    // Clone response for caching
    const responseToCache = response.clone();

    try {
      await cache.put(request, responseToCache);

      // Store size metadata
      const blob = await response.clone().blob();
      await cacheMetadata.setSize(request.url, blob.size);

      // Update access metadata
      await cacheMetadata.updateAccess(request.url);
    } catch (error) {
      // Check if quota exceeded
      if (error.name === 'QuotaExceededError') {
        console.warn('Cache quota exceeded, pruning...');

        // Prune cache and retry
        const pruned = await pruneCache();

        if (pruned > 0) {
          // Retry cache after pruning
          try {
            await cache.put(request, responseToCache.clone());
            const blob = await response.clone().blob();
            await cacheMetadata.setSize(request.url, blob.size);
            await cacheMetadata.updateAccess(request.url);
          } catch (retryError) {
            console.warn('Failed to cache after pruning:', retryError);
          }
        }
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Failed to cache response:', error);
  }
}

/**
 * Service Worker Install Event
 */
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');

  event.waitUntil(
    cacheMetadata.init().then(() => {
      console.log('Cache metadata initialized');
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

/**
 * Service Worker Activate Event
 */
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');

  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Clean up old metadata entries
      cacheMetadata.init().then(async () => {
        const metadata = await cacheMetadata.getAllMetadata();
        const now = Date.now();

        // Remove metadata for entries older than MAX_CACHE_AGE
        for (const entry of metadata) {
          if (now - entry.cachedAt > MAX_CACHE_AGE) {
            const cache = await caches.open(CACHE_NAME);
            await cache.delete(entry.url);
            await cacheMetadata.deleteMetadata(entry.url);
          }
        }
      }),
      // Claim all clients immediately
      self.clients.claim()
    ])
  );
});

/**
 * Service Worker Fetch Event
 * Cache-first strategy for Firebase Storage URLs
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle Firebase Storage URLs
  if (!isFirebaseStorageUrl(request.url)) {
    return; // Let browser handle normally
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try cache first
      const cachedResponse = await cache.match(request);

      if (cachedResponse) {
        // Update access metadata in background
        cacheMetadata.updateAccess(request.url).catch((error) => {
          console.warn('Failed to update access metadata:', error);
        });

        return cachedResponse;
      }

      // Not in cache, fetch from network
      try {
        const networkResponse = await fetch(request);

        // Only cache successful responses
        if (networkResponse && networkResponse.status === 200) {
          // Cache response in background
          cacheResponse(request, networkResponse.clone()).catch((error) => {
            console.warn('Background caching failed:', error);
          });
        }

        return networkResponse;
      } catch (error) {
        console.error('Fetch failed:', error);

        // Could return a fallback image here
        throw error;
      }
    })
  );
});

/**
 * Service Worker Message Event
 * Handles commands from the main app
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'WARM_CACHE':
      // Proactively cache a list of URLs
      handleWarmCache(data.urls).then(() => {
        event.ports[0]?.postMessage({ success: true });
      }).catch((error) => {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      });
      break;

    case 'CLEAR_CACHE':
      // Clear all cache
      handleClearCache().then(() => {
        event.ports[0]?.postMessage({ success: true });
      }).catch((error) => {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      });
      break;

    case 'GET_CACHE_STATUS':
      // Return cache statistics
      handleGetCacheStatus().then((status) => {
        event.ports[0]?.postMessage({ success: true, status });
      }).catch((error) => {
        event.ports[0]?.postMessage({ success: false, error: error.message });
      });
      break;

    default:
      console.warn('Unknown message type:', type);
  }
});

/**
 * Warm cache by proactively fetching URLs
 */
async function handleWarmCache(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return;
  }

  console.log(`Warming cache with ${urls.length} URLs...`);

  const cache = await caches.open(CACHE_NAME);
  let cached = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      // Skip if already cached
      const existing = await cache.match(url);
      if (existing) {
        continue;
      }

      // Fetch and cache
      const response = await fetch(url);
      if (response && response.status === 200) {
        await cacheResponse(new Request(url), response);
        cached++;
      }
    } catch (error) {
      console.warn('Failed to warm cache for URL:', url, error);
      failed++;
    }
  }

  console.log(`Cache warming complete: ${cached} cached, ${failed} failed`);
}

/**
 * Clear all cache
 */
async function handleClearCache() {
  console.log('Clearing gallery cache...');

  await caches.delete(CACHE_NAME);

  // Clear metadata
  const metadata = await cacheMetadata.getAllMetadata();
  for (const entry of metadata) {
    await cacheMetadata.deleteMetadata(entry.url);
  }

  console.log('Gallery cache cleared');
}

/**
 * Get cache status/statistics
 */
async function handleGetCacheStatus() {
  const metadata = await cacheMetadata.getAllMetadata();

  const totalSize = metadata.reduce((sum, entry) => sum + (entry.size || 0), 0);
  const totalEntries = metadata.length;

  // Get cache storage estimate
  let quota = null;
  let usage = null;

  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    quota = estimate.quota;
    usage = estimate.usage;
  }

  return {
    totalEntries,
    totalSize,
    totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    quota,
    usage,
    quotaMB: quota ? Math.round(quota / 1024 / 1024) : null,
    usageMB: usage ? Math.round(usage / 1024 / 1024) : null,
    usagePercent: quota ? Math.round(usage / quota * 100) : null
  };
}
