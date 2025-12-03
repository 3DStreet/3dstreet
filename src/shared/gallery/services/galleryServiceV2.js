/**
 * Gallery Service V2 - Firestore + Firebase Storage
 *
 * This service uses Firestore as the source of truth for gallery assets,
 * with Firebase Storage for file storage. Browser HTTP cache handles
 * image caching (Cache-Control headers set on upload).
 *
 * Architecture:
 * - Firestore: Asset metadata (users/{userId}/assets/{assetId})
 * - Storage: File storage (users/{userId}/assets/{type}/{assetId}.ext)
 * - Browser: HTTP cache for images (1 year cache-control)
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
import {
  ASSET_TYPES,
  ASSET_CATEGORIES,
  STORAGE_PATHS,
  getTypeFolderName,
  validateUserIdForPath
} from '../constants.js';

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

/**
 * Gallery Service V2 Class
 *
 * @fires GalleryServiceV2#assetAdded - Dispatched immediately after asset is added
 * @fires GalleryServiceV2#assetAddedReload - Dispatched 1.5s after add for fallback reload
 * @fires GalleryServiceV2#assetUpdated - Dispatched when asset metadata is updated
 * @fires GalleryServiceV2#assetDeleted - Dispatched when asset is deleted
 * @fires GalleryServiceV2#uploadProgress - Dispatched during file upload with progress
 * @fires GalleryServiceV2#migrationComplete - Dispatched when V1→V2 migration completes
 */

/**
 * @event GalleryServiceV2#assetAdded
 * @type {CustomEvent}
 * @property {Object} detail - Event detail
 * @property {string} detail.assetId - The ID of the added asset
 * @property {string} detail.userId - The user ID
 * @property {Object} detail.asset - The full asset object for optimistic UI updates
 */

/**
 * @event GalleryServiceV2#assetAddedReload
 * @type {CustomEvent}
 * @property {Object} detail - Event detail
 * @property {string} detail.assetId - The ID of the added asset
 * @property {string} detail.userId - The user ID
 */

/**
 * @event GalleryServiceV2#assetUpdated
 * @type {CustomEvent}
 * @property {Object} detail - Event detail
 * @property {string} detail.assetId - The ID of the updated asset
 */

/**
 * @event GalleryServiceV2#assetDeleted
 * @type {CustomEvent}
 * @property {Object} detail - Event detail
 * @property {string} detail.assetId - The ID of the deleted asset
 * @property {boolean} detail.hard - Whether this was a hard (permanent) delete
 */

/**
 * @event GalleryServiceV2#uploadProgress
 * @type {CustomEvent}
 * @property {Object} detail - Event detail
 * @property {string} detail.assetId - The ID of the asset being uploaded
 * @property {number} detail.progress - Upload progress percentage (0-100)
 */

class GalleryServiceV2 {
  constructor() {
    this.events = galleryEvents;
    this.unsubscribe = null; // Real-time listener
  }

  /**
   * Initialize the service
   * @returns {Promise<void>}
   */
  async init() {
    // Service initialized
  }

  /**
   * Add a new asset to gallery (uploads to Storage + saves metadata to Firestore)
   * @param {File|Blob|string} file - File, Blob, or data URI
   * @param {object} metadata - Asset metadata
   * @param {string} type - Asset type (use ASSET_TYPES constants)
   * @param {string} category - Asset category (use ASSET_CATEGORIES constants)
   * @param {string} userId - User ID
   * @returns {Promise<string>} - Returns the asset ID
   */
  async addAsset(
    file,
    metadata = {},
    type = ASSET_TYPES.IMAGE,
    category = ASSET_CATEGORIES.AI_RENDER,
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

      // IMPORTANT: Upload to Storage FIRST before creating Firestore doc
      // This ensures no orphaned Firestore documents if upload fails
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
      if (type === ASSET_TYPES.IMAGE) {
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
      if (type === ASSET_TYPES.IMAGE || type === ASSET_TYPES.VIDEO) {
        dimensions = await this.getMediaDimensions(blob, type);
      }

      // Clean metadata to remove undefined values (Firestore doesn't accept undefined)
      const cleanMetadata = this.removeUndefinedValues(metadata || {});

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

        // Generation Metadata (cleaned of undefined values)
        generationMetadata: cleanMetadata,

        // Timestamps
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        uploadedAt: serverTimestamp(),

        // Organization
        tags: metadata.tags || [],
        collections: metadata.collections || [],

        // Soft Delete
        deleted: false
      };

      // Save to Firestore (subcollection under user)
      const assetRef = doc(db, 'users', userId, 'assets', assetId);
      await setDoc(assetRef, assetDoc);

      // Create a version of the asset with resolved timestamp for optimistic UI
      // (assetDoc has serverTimestamp() which is a sentinel, not a real Date)
      const now = new Date();
      const assetForEvent = {
        ...assetDoc,
        createdAt: now,
        updatedAt: now,
        uploadedAt: now
      };

      // Event dispatch strategy for gallery UI updates:
      //
      // We use 3 events due to different React architectures:
      // 1. assetAdded (immediate) - Optimistic update with full asset data.
      //    Works in editor where Gallery shares the same module instance.
      // 2. assetAddedReload (1.5s) - Fallback that triggers Firestore reload.
      //    Catches cases where optimistic update fails during re-renders.
      // 3. gallery:refresh (2.5s) - Window event for generator app.
      //    Generator uses React islands (separate createRoot calls), so the
      //    EventTarget instance may differ from what Gallery listens to.
      //    Window events bypass this module isolation issue.
      //
      // TODO: Remove fallbacks #2 and #3 when generator is fully converted to React
      // with a single React tree (no more islands architecture).

      const eventDetail = {
        assetId,
        userId,
        asset: assetForEvent
      };

      // Event #1: Immediate optimistic update (works in editor)
      this.events.dispatchEvent(
        new CustomEvent('assetAdded', { detail: eventDetail })
      );

      // Event #2: Delayed reload fallback via EventTarget
      setTimeout(() => {
        this.events.dispatchEvent(
          new CustomEvent('assetAddedReload', { detail: { userId, assetId } })
        );
      }, 1500);

      // Event #3: Window event fallback for generator (bypasses EventTarget issues)
      setTimeout(() => {
        window.dispatchEvent(new Event('gallery:refresh'));
      }, 2500);

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
   * @param {string} type - Media type (use ASSET_TYPES constants)
   * @returns {Promise<object>}
   */
  async getMediaDimensions(blob, type) {
    if (type === ASSET_TYPES.IMAGE) {
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
    } else if (type === ASSET_TYPES.VIDEO) {
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
   * @param {string} type - Asset type (must be one of ASSET_TYPES)
   * @param {string} filename - Filename
   * @returns {string}
   * @throws {Error} If userId or type is invalid
   * @example
   * getStoragePath('user123', 'image', 'abc.jpg') => 'users/user123/assets/images/abc.jpg'
   * getStoragePath('user123', 'video', 'xyz.mp4') => 'users/user123/assets/videos/xyz.mp4'
   */
  getStoragePath(userId, type, filename) {
    // Validate userId to prevent path traversal attacks
    validateUserIdForPath(userId);

    // Get the pluralized folder name using the mapping (handles irregular plurals correctly)
    const typeFolder = getTypeFolderName(type);

    return STORAGE_PATHS.assetFile(userId, typeFolder, filename);
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
   * Remove undefined values from object (Firestore doesn't accept undefined)
   * @param {object} obj - Object to clean
   * @returns {object} - Cleaned object
   */
  removeUndefinedValues(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.removeUndefinedValues(item));
    }

    const cleaned = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        cleaned[key] = this.removeUndefinedValues(obj[key]);
      }
    }
    return cleaned;
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
   * WARNING: Client-side search, not scalable beyond ~200 assets.
   * For production scale, consider using Algolia or Elasticsearch.
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @returns {Promise<Array>}
   */
  async searchAssets(userId, query) {
    // WARNING: Client-side search, not scalable beyond ~200 assets
    // This fetches all assets and filters in-memory. For larger galleries,
    // consider implementing server-side search with Algolia or similar.
    const allAssets = await this.getAssets(userId, {}, 200);

    return allAssets.filter((asset) => {
      const searchString = JSON.stringify(asset).toLowerCase();
      return searchString.includes(query.toLowerCase());
    });
  }
}

// Create singleton instance
const galleryServiceV2 = new GalleryServiceV2();

export default galleryServiceV2;
