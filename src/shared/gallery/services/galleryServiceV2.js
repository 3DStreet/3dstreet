/**
 * Gallery Service V2 - Firestore + Firebase Storage
 *
 * This service uses Firestore as the source of truth for gallery assets,
 * with Firebase Storage for file storage and IndexedDB as a local cache.
 *
 * Architecture:
 * - Firestore: Asset metadata (users/{userId}/assets/{assetId})
 * - Storage: File storage (users/{userId}/assets/{type}/{category}/{assetId}.ext)
 * - IndexedDB: Local cache for offline access
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { db, storage } from '@shared/services/firebase.js';

// UUID generator
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Event emitter for real-time updates
const galleryEvents = new EventTarget();

class GalleryServiceV2 {
  constructor() {
    this.events = galleryEvents;
    this.unsubscribe = null; // Real-time listener
    this.db = null; // IndexedDB instance for caching (metadata only, no blobs)
    this.dbName = '3DStreetGalleryCache';
    this.dbVersion = 3; // Increment version for schema change
    this.storeName = 'assets';
  }

  /**
   * Initialize the service (both Firestore and local cache)
   * @returns {Promise<void>}
   */
  async init() {
    try {
      // Initialize IndexedDB cache
      this.db = await this.openCacheDB();
      console.log('Gallery Service V2 initialized (metadata-only cache)');

      // NOTE: Service Worker cache warming disabled due to CORS requirements
      // To re-enable, configure CORS on Firebase Storage first:
      // gsutil cors set public/storage-cors.json gs://dev-3dstreet.appspot.com
      //
      // this.warmServiceWorkerCache(50).catch((error) => {
      //   console.warn('Failed to warm Service Worker cache on init:', error);
      // });
    } catch (error) {
      console.error('Failed to initialize gallery service:', error);
      throw error;
    }
  }

  /**
   * Open IndexedDB for caching
   * @returns {Promise<IDBDatabase>}
   */
  openCacheDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('IndexedDB cache error:', event.target.error);
        reject(new Error(`IndexedDB error: ${event.target.error}`));
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: 'assetId'
          });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          // LRU tracking indexes
          store.createIndex('lastAccessedAt', 'lastAccessedAt', {
            unique: false
          });
          store.createIndex('accessCount', 'accessCount', { unique: false });
        } else if (event.oldVersion < 3) {
          // Upgrade from v2 to v3: Add LRU indexes and remove blob data
          const transaction = event.target.transaction;
          const store = transaction.objectStore(this.storeName);

          // Add new indexes if they don't exist
          if (!store.indexNames.contains('lastAccessedAt')) {
            store.createIndex('lastAccessedAt', 'lastAccessedAt', {
              unique: false
            });
          }
          if (!store.indexNames.contains('accessCount')) {
            store.createIndex('accessCount', 'accessCount', { unique: false });
          }

          // Clear blob data from existing records
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              // Remove imageData blob if it exists
              if (record.imageData) {
                delete record.imageData;
                record.lastAccessedAt = Date.now();
                record.accessCount = 0;
                cursor.update(record);
              }
              cursor.continue();
            }
          };
        }
      };
    });
  }

  /**
   * Add a new asset to gallery (uploads to Storage + saves metadata to Firestore)
   * @param {File|Blob|string} file - File, Blob, or data URI
   * @param {object} metadata - Asset metadata
   * @param {string} type - Asset type ('image' | 'video' | 'splat' | 'mesh')
   * @param {string} category - Asset category ('ai-render' | 'screenshot' | 'upload' | 'splat-source' | 'splat-output')
   * @param {string} userId - User ID
   * @returns {Promise<string>} - Returns the asset ID
   */
  async addAsset(
    file,
    metadata = {},
    type = 'image',
    category = 'ai-render',
    userId
  ) {
    if (!userId) {
      throw new Error('User ID is required to add assets');
    }

    try {
      // Generate unique asset ID
      const assetId = generateUUID();

      // Convert data URI to Blob if needed
      let blob = file;
      if (typeof file === 'string') {
        blob = await this.dataUriToBlob(file);
      }

      if (!blob || !(blob instanceof Blob)) {
        throw new Error('Invalid file format');
      }

      // Determine file extension and MIME type
      const mimeType = blob.type || 'image/jpeg';
      const extension = this.getExtensionFromMimeType(mimeType);
      const filename = `${assetId}.${extension}`;

      // Get storage path
      const storagePath = this.getStoragePath(userId, type, filename);

      // Upload to Firebase Storage with progress tracking
      const downloadURL = await this.uploadToStorage(
        blob,
        storagePath,
        (progress) => {
          this.events.dispatchEvent(
            new CustomEvent('uploadProgress', {
              detail: { assetId, progress }
            })
          );
        }
      );

      // Generate thumbnail if it's an image
      let thumbnailUrl = null;
      let thumbnailPath = null;
      if (type === 'image') {
        try {
          const thumbnailBlob = await this.generateThumbnail(blob);
          thumbnailPath = this.getStoragePath(
            userId,
            type,
            `${assetId}-thumb.jpg`
          );
          thumbnailUrl = await this.uploadToStorage(
            thumbnailBlob,
            thumbnailPath
          );
        } catch (error) {
          console.warn('Failed to generate thumbnail:', error);
        }
      }

      // Get image dimensions if applicable
      let dimensions = {};
      if (type === 'image' || type === 'video') {
        dimensions = await this.getMediaDimensions(blob, type);
      }

      // Create Firestore document
      const assetDoc = {
        // Identity
        assetId,
        userId,
        type,
        category,

        // Storage
        storagePath,
        storageUrl: downloadURL,
        ...(thumbnailUrl && {
          thumbnailPath: thumbnailPath,
          thumbnailUrl: thumbnailUrl
        }),

        // File Metadata
        filename,
        originalFilename: metadata.originalFilename || filename,
        size: blob.size,
        mimeType,

        // Media Dimensions
        ...dimensions,

        // Generation Metadata
        generationMetadata: metadata || {},

        // Timestamps
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        uploadedAt: serverTimestamp(),

        // Sync Tracking
        syncedToDevices: {},

        // Organization
        tags: metadata.tags || [],
        collections: metadata.collections || [],

        // Soft Delete
        deleted: false
      };

      // Save to Firestore (subcollection under user)
      const assetRef = doc(db, 'users', userId, 'assets', assetId);
      await setDoc(assetRef, assetDoc);

      // Cache metadata locally (no blob storage)
      await this.cacheAsset(assetId, {
        ...assetDoc,
        // DO NOT store blob - Service Worker will cache images
        createdAt: new Date().toISOString(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      });

      // Emit event
      this.events.dispatchEvent(
        new CustomEvent('assetAdded', { detail: { assetId } })
      );

      console.log(`Asset ${assetId} added successfully`);
      return assetId;
    } catch (error) {
      console.error('Error adding asset:', error);
      throw error;
    }
  }

  /**
   * Upload file to Firebase Storage
   * @param {Blob} blob - File blob
   * @param {string} storagePath - Storage path
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<string>} - Download URL
   */
  async uploadToStorage(blob, storagePath, onProgress = null) {
    const storageRef = ref(storage, storagePath);

    // Set metadata with cache control for browser caching
    const metadata = {
      cacheControl: 'public, max-age=31536000', // 1 year cache
      contentType: blob.type
    };

    const uploadTask = uploadBytesResumable(storageRef, blob, metadata);

    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress =
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (onProgress) onProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadURL);
        }
      );
    });
  }

  /**
   * Generate thumbnail for image
   * @param {Blob} blob - Image blob
   * @param {number} maxSize - Max dimension
   * @returns {Promise<Blob>}
   */
  async generateThumbnail(blob, maxSize = 300) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (thumbnailBlob) => {
            if (thumbnailBlob) {
              resolve(thumbnailBlob);
            } else {
              reject(new Error('Failed to generate thumbnail blob'));
            }
          },
          'image/jpeg',
          0.8
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for thumbnail'));
      };

      img.src = url;
    });
  }

  /**
   * Get media dimensions
   * @param {Blob} blob - Media blob
   * @param {string} type - Media type
   * @returns {Promise<object>}
   */
  async getMediaDimensions(blob, type) {
    if (type === 'image') {
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: img.width, height: img.height });
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };

        img.src = url;
      });
    } else if (type === 'video') {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(blob);

        video.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration
          });
        };

        video.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };

        video.src = url;
      });
    }

    return {};
  }

  /**
   * Get storage path for asset
   * @param {string} userId - User ID
   * @param {string} type - Asset type
   * @param {string} filename - Filename
   * @returns {string}
   * @example
   * getStoragePath('user123', 'image', 'abc.jpg') => 'users/user123/assets/images/abc.jpg'
   * getStoragePath('user123', 'video', 'xyz.mp4') => 'users/user123/assets/videos/xyz.mp4'
   */
  getStoragePath(userId, type, filename) {
    // Pluralize type for folder name (image -> images, video -> videos, model -> models)
    const typeFolder = `${type}s`;
    return `users/${userId}/assets/${typeFolder}/${filename}`;
  }

  /**
   * Get extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string}
   */
  getExtensionFromMimeType(mimeType) {
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'model/gltf-binary': 'glb',
      'application/octet-stream': 'ply'
    };

    return mimeMap[mimeType] || 'bin';
  }

  /**
   * Get asset by ID
   * @param {string} assetId - Asset ID
   * @param {string} userId - User ID
   * @returns {Promise<object|null>}
   */
  async getAsset(assetId, userId) {
    try {
      const assetRef = doc(db, 'users', userId, 'assets', assetId);
      const assetSnap = await getDoc(assetRef);

      if (assetSnap.exists()) {
        return { id: assetSnap.id, ...assetSnap.data() };
      }

      return null;
    } catch (error) {
      console.error('Error getting asset:', error);
      throw error;
    }
  }

  /**
   * Get all assets for a user with filters
   * @param {string} userId - User ID
   * @param {object} filters - Query filters
   * @param {number} limitCount - Max results
   * @param {string} orderByField - Field to order by
   * @returns {Promise<Array>}
   */
  async getAssets(
    userId,
    filters = {},
    limitCount = 50,
    orderByField = 'createdAt'
  ) {
    try {
      console.log('getAssets called with userId:', userId);
      // Use subcollection under user
      const assetsRef = collection(db, 'users', userId, 'assets');
      let q = query(assetsRef);

      // Apply filters
      if (filters.type) {
        q = query(q, where('type', '==', filters.type));
      }
      if (filters.category) {
        q = query(q, where('category', '==', filters.category));
      }
      if (filters.deleted !== undefined) {
        q = query(q, where('deleted', '==', filters.deleted));
      } else {
        // By default, exclude deleted assets
        q = query(q, where('deleted', '==', false));
      }

      // Order and limit
      q = query(q, orderBy(orderByField, 'desc'), firestoreLimit(limitCount));

      const querySnapshot = await getDocs(q);
      const assets = [];

      querySnapshot.forEach((doc) => {
        assets.push({ id: doc.id, ...doc.data() });
      });

      return assets;
    } catch (error) {
      console.error('Error getting assets:', error);
      throw error;
    }
  }

  /**
   * Update asset metadata
   * @param {string} assetId - Asset ID
   * @param {string} userId - User ID
   * @param {object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateAsset(assetId, userId, updates) {
    try {
      const assetRef = doc(db, 'users', userId, 'assets', assetId);

      // Verify asset exists
      const assetSnap = await getDoc(assetRef);
      if (!assetSnap.exists()) {
        throw new Error('Asset not found');
      }

      await updateDoc(assetRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });

      this.events.dispatchEvent(
        new CustomEvent('assetUpdated', { detail: { assetId } })
      );
    } catch (error) {
      console.error('Error updating asset:', error);
      throw error;
    }
  }

  /**
   * Delete asset (soft delete by default)
   * @param {string} assetId - Asset ID
   * @param {string} userId - User ID
   * @param {boolean} hard - Permanent delete
   * @returns {Promise<void>}
   */
  async deleteAsset(assetId, userId, hard = false) {
    try {
      const assetRef = doc(db, 'users', userId, 'assets', assetId);

      // Get asset
      const assetSnap = await getDoc(assetRef);
      if (!assetSnap.exists()) {
        throw new Error('Asset not found');
      }

      if (hard) {
        const asset = assetSnap.data();

        // Delete from storage
        if (asset.storagePath) {
          await deleteObject(ref(storage, asset.storagePath));
        }
        if (asset.thumbnailPath) {
          await deleteObject(ref(storage, asset.thumbnailPath));
        }

        // Delete Firestore document
        await deleteDoc(assetRef);
      } else {
        // Soft delete
        await updateDoc(assetRef, {
          deleted: true,
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      // Remove from cache
      await this.removeFromCache(assetId);

      this.events.dispatchEvent(
        new CustomEvent('assetDeleted', { detail: { assetId, hard } })
      );
    } catch (error) {
      console.error('Error deleting asset:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time updates for assets
   * @param {string} userId - User ID
   * @param {object} filters - Query filters
   * @param {Function} callback - Callback function
   * @returns {Function} - Unsubscribe function
   */
  subscribeToAssets(userId, filters = {}, callback) {
    try {
      // Use subcollection under user
      const assetsRef = collection(db, 'users', userId, 'assets');
      let q = query(assetsRef);

      // Apply filters
      if (filters.type) {
        q = query(q, where('type', '==', filters.type));
      }
      if (filters.category) {
        q = query(q, where('category', '==', filters.category));
      }
      if (filters.deleted !== undefined) {
        q = query(q, where('deleted', '==', filters.deleted));
      } else {
        q = query(q, where('deleted', '==', false));
      }

      q = query(q, orderBy('createdAt', 'desc'));

      this.unsubscribe = onSnapshot(q, (snapshot) => {
        const assets = [];
        snapshot.forEach((doc) => {
          assets.push({ id: doc.id, ...doc.data() });
        });

        callback(assets);
      });

      return this.unsubscribe;
    } catch (error) {
      console.error('Error subscribing to assets:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeFromAssets() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Cache asset metadata locally in IndexedDB (metadata only, no blobs)
   * @param {string} assetId - Asset ID
   * @param {object} assetData - Asset metadata (URLs, not blobs)
   * @returns {Promise<void>}
   */
  async cacheAsset(assetId, assetData) {
    if (!this.db) return;

    // Ensure no blob data is stored
    const metadataOnly = { ...assetData };
    delete metadataOnly.imageData; // Remove any blob data
    delete metadataOnly.imageDataBlob;

    // Add LRU tracking if not present
    if (!metadataOnly.lastAccessedAt) {
      metadataOnly.lastAccessedAt = Date.now();
    }
    if (!metadataOnly.accessCount) {
      metadataOnly.accessCount = 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(metadataOnly);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Remove asset from cache
   * @param {string} assetId - Asset ID
   * @returns {Promise<void>}
   */
  async removeFromCache(assetId) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(assetId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get cached assets from IndexedDB
   * @returns {Promise<Array>}
   */
  async getCachedAssets() {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Clear local cache
   * @returns {Promise<void>}
   */
  async clearLocalCache() {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Convert Data URI to Blob
   * @param {string} dataURI - Data URI string
   * @returns {Promise<Blob>}
   */
  async dataUriToBlob(dataURI) {
    if (!dataURI) return null;
    try {
      const response = await fetch(dataURI);
      return await response.blob();
    } catch (error) {
      console.error('Error converting data URI to Blob:', error);
      return null;
    }
  }

  /**
   * Track asset access for LRU (updates lastAccessedAt and accessCount)
   * @param {string} assetId - Asset ID
   * @returns {Promise<void>}
   */
  async trackAccess(assetId) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(assetId);

      getRequest.onsuccess = () => {
        const asset = getRequest.result;
        if (asset) {
          asset.lastAccessedAt = Date.now();
          asset.accessCount = (asset.accessCount || 0) + 1;

          const updateRequest = store.put(asset);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(); // Asset not in cache
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Warm Service Worker cache with recent thumbnails
   * @param {number} count - Number of recent thumbnails to cache
   * @returns {Promise<void>}
   */
  async warmServiceWorkerCache(count = 50) {
    try {
      // Get cached assets (already sorted by most recent)
      const cachedAssets = await this.getCachedAssets();

      // Extract thumbnail URLs (limit to count)
      const thumbnailUrls = cachedAssets
        .slice(0, count)
        .map((asset) => asset.thumbnailUrl || asset.storageUrl)
        .filter(Boolean);

      if (thumbnailUrls.length === 0) {
        console.log('No thumbnails to warm cache');
        return;
      }

      // Send message to Service Worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const messageChannel = new MessageChannel();

        return new Promise((resolve, reject) => {
          messageChannel.port1.onmessage = (event) => {
            if (event.data.success) {
              console.log(
                `Service Worker cache warmed with ${thumbnailUrls.length} thumbnails`
              );
              resolve();
            } else {
              reject(new Error(event.data.error));
            }
          };

          navigator.serviceWorker.controller.postMessage(
            {
              type: 'WARM_CACHE',
              data: { urls: thumbnailUrls }
            },
            [messageChannel.port2]
          );
        });
      } else {
        console.warn('Service Worker not available for cache warming');
      }
    } catch (error) {
      console.error('Failed to warm Service Worker cache:', error);
    }
  }

  /**
   * Get Service Worker cache status
   * @returns {Promise<object>}
   */
  async getServiceWorkerCacheStatus() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const messageChannel = new MessageChannel();

      return new Promise((resolve, reject) => {
        messageChannel.port1.onmessage = (event) => {
          if (event.data.success) {
            resolve(event.data.status);
          } else {
            reject(new Error(event.data.error));
          }
        };

        navigator.serviceWorker.controller.postMessage(
          {
            type: 'GET_CACHE_STATUS'
          },
          [messageChannel.port2]
        );
      });
    }

    return null;
  }

  /**
   * Clear Service Worker cache
   * @returns {Promise<void>}
   */
  async clearServiceWorkerCache() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const messageChannel = new MessageChannel();

      return new Promise((resolve, reject) => {
        messageChannel.port1.onmessage = (event) => {
          if (event.data.success) {
            console.log('Service Worker cache cleared');
            resolve();
          } else {
            reject(new Error(event.data.error));
          }
        };

        navigator.serviceWorker.controller.postMessage(
          {
            type: 'CLEAR_CACHE'
          },
          [messageChannel.port2]
        );
      });
    }
  }

  /**
   * Get assets by type
   * @param {string} userId - User ID
   * @param {string} type - Asset type
   * @param {number} limitCount - Max results
   * @returns {Promise<Array>}
   */
  async getAssetsByType(userId, type, limitCount = 50) {
    return this.getAssets(userId, { type }, limitCount);
  }

  /**
   * Get assets by category
   * @param {string} userId - User ID
   * @param {string} category - Asset category
   * @param {number} limitCount - Max results
   * @returns {Promise<Array>}
   */
  async getAssetsByCategory(userId, category, limitCount = 50) {
    return this.getAssets(userId, { category }, limitCount);
  }

  /**
   * Search assets by tags or metadata
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @returns {Promise<Array>}
   */
  async searchAssets(userId, query) {
    // Note: Firestore doesn't support full-text search natively
    // For production, consider using Algolia or similar service
    const allAssets = await this.getAssets(userId, {}, 100);

    return allAssets.filter((asset) => {
      const searchString = JSON.stringify(asset).toLowerCase();
      return searchString.includes(query.toLowerCase());
    });
  }
}

// Create singleton instance
const galleryServiceV2 = new GalleryServiceV2();

export default galleryServiceV2;
