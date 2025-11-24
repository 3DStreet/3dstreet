/**
 * Unified Gallery Service
 *
 * Provides a unified API that works with both:
 * - Legacy IndexedDB system (galleryService.js)
 * - New Firestore + Storage system (galleryServiceV2.js)
 *
 * This allows for gradual migration and backward compatibility
 */

import galleryService from './galleryService.js';
import galleryServiceV2 from './galleryServiceV2.js';
import galleryMigration from './galleryMigration.js';

class GalleryServiceUnified {
  constructor() {
    this.useV2 = true; // Flag to enable/disable V2 (can be toggled via feature flag)
    this.userId = null;
    this.events = galleryServiceV2.events; // Use V2 events
    this.migrationChecked = false;
  }

  /**
   * Initialize the service
   * @param {string} userId - User ID (required for V2)
   * @returns {Promise<void>}
   */
  async init(userId = null) {
    try {
      this.userId = userId;

      // Always initialize V1 for backward compatibility
      await galleryService.init();

      // Initialize V2 if user is authenticated
      if (this.useV2 && userId) {
        await galleryServiceV2.init();

        // Check if migration is needed (only once per session)
        if (!this.migrationChecked) {
          this.migrationChecked = true;
          const needsMigration =
            await galleryMigration.isMigrationNeeded(userId);

          if (needsMigration) {
            console.log(
              'Gallery migration needed. User can trigger migration manually.'
            );
            // Emit event so UI can show migration prompt
            this.events.dispatchEvent(
              new CustomEvent('migrationNeeded', { detail: { userId } })
            );
          }
        }
      }

      console.log(
        `Gallery Service initialized (V2: ${this.useV2 && !!userId})`
      );
    } catch (error) {
      console.error('Failed to initialize gallery service:', error);
      throw error;
    }
  }

  /**
   * Add a new item to gallery
   * @param {File|Blob|string} file - File, Blob, or data URI
   * @param {object} metadata - Asset metadata
   * @param {string} type - Asset type
   * @returns {Promise<string>} - Asset ID
   */
  async addItem(file, metadata = {}, type = 'ai-render') {
    try {
      // If V2 is enabled and user is authenticated, use V2
      if (this.useV2 && this.userId) {
        // Map old type names to new structure
        const assetType = type === 'video' ? 'video' : 'image';
        const category = type === 'video' ? 'ai-render' : type;

        return await galleryServiceV2.addAsset(
          file,
          metadata,
          assetType,
          category,
          this.userId
        );
      }

      // Otherwise, fall back to V1 (IndexedDB)
      return await galleryService.addItem(file, metadata, type);
    } catch (error) {
      console.error('Error adding item to gallery:', error);

      // If V2 fails, try V1 as fallback
      if (this.useV2 && this.userId) {
        console.warn('V2 failed, falling back to V1 (IndexedDB)');
        return await galleryService.addItem(file, metadata, type);
      }

      throw error;
    }
  }

  /**
   * Alias for addItem (backward compatibility)
   */
  async addImage(imageDataUri, metadata, type = 'ai-render') {
    return this.addItem(imageDataUri, metadata, type);
  }

  /**
   * Load items from gallery
   * @returns {Promise<Array>}
   */
  async loadFromDB() {
    try {
      // If V2 is enabled and user is authenticated, use V2
      if (this.useV2 && this.userId) {
        const assets = await galleryServiceV2.getAssets(this.userId, {}, 200);

        // Convert to V1 format for backward compatibility
        return assets.map((asset) => {
          // Handle Firestore Timestamp objects
          let timestamp = asset.createdAt;
          if (timestamp?.toMillis) {
            // Firestore Timestamp object
            timestamp = new Date(timestamp.toMillis()).toISOString();
          } else if (timestamp?.toDate) {
            // Legacy Firestore Timestamp
            timestamp = timestamp.toDate().toISOString();
          } else if (typeof timestamp !== 'string') {
            // Fallback to current time if not already a string
            timestamp = new Date().toISOString();
          }

          return {
            id: asset.assetId,
            type: asset.category,
            imageData: null, // Will be loaded on demand
            objectURL: asset.thumbnailUrl || asset.storageUrl,
            metadata: {
              ...asset.generationMetadata,
              timestamp
            }
          };
        });
      }

      // Otherwise, use V1
      return await galleryService.loadFromDB();
    } catch (error) {
      console.error('Error loading from gallery:', error);

      // If V2 fails, try V1 as fallback
      if (this.useV2 && this.userId) {
        console.warn('V2 failed, falling back to V1 (IndexedDB)');
        return await galleryService.loadFromDB();
      }

      throw error;
    }
  }

  /**
   * Remove an item from gallery
   * @param {string} id - Item ID
   * @returns {Promise<boolean>}
   */
  async removeImage(id) {
    try {
      // If V2 is enabled and user is authenticated, use V2
      if (this.useV2 && this.userId) {
        await galleryServiceV2.deleteAsset(id, this.userId, false);
        return true;
      }

      // Otherwise, use V1
      return await galleryService.removeImage(id);
    } catch (error) {
      console.error('Error removing item from gallery:', error);

      // If V2 fails, try V1 as fallback
      if (this.useV2 && this.userId) {
        console.warn('V2 failed, falling back to V1 (IndexedDB)');
        return await galleryService.removeImage(id);
      }

      throw error;
    }
  }

  /**
   * Clear all items from gallery
   * @returns {Promise<void>}
   */
  async clearGallery() {
    try {
      // Clear both V1 and V2
      await galleryService.clearGallery();

      if (this.useV2 && this.userId) {
        const assets = await galleryServiceV2.getAssets(this.userId, {}, 500);
        for (const asset of assets) {
          await galleryServiceV2.deleteAsset(asset.assetId, this.userId, true);
        }
      }
    } catch (error) {
      console.error('Error clearing gallery:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time updates (V2 only)
   * @param {Function} callback - Callback function
   * @returns {Function|null} - Unsubscribe function
   */
  subscribeToAssets(callback) {
    if (this.useV2 && this.userId) {
      return galleryServiceV2.subscribeToAssets(this.userId, {}, callback);
    }

    console.warn('Real-time updates require V2 and authenticated user');
    return null;
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeFromAssets() {
    if (this.useV2) {
      galleryServiceV2.unsubscribeFromAssets();
    }
  }

  /**
   * Trigger migration from V1 to V2
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<object>}
   */
  async migrate(onProgress = null) {
    if (!this.userId) {
      throw new Error('User must be authenticated to migrate');
    }

    try {
      const status = await galleryMigration.migrateAll(this.userId, onProgress);

      // Clean up old data if migration was successful
      if (status.migrated > 0 && status.failed === 0) {
        await galleryMigration.cleanupOldData();
      }

      return status;
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Check if migration is needed
   * @returns {Promise<boolean>}
   */
  async isMigrationNeeded() {
    if (!this.userId) {
      return false;
    }

    return await galleryMigration.isMigrationNeeded(this.userId);
  }

  /**
   * Get asset by ID (V2 only)
   * @param {string} assetId - Asset ID
   * @returns {Promise<object|null>}
   */
  async getAsset(assetId) {
    if (this.useV2 && this.userId) {
      return await galleryServiceV2.getAsset(assetId, this.userId);
    }

    console.warn('getAsset requires V2 and authenticated user');
    return null;
  }

  /**
   * Update asset metadata (V2 only)
   * @param {string} assetId - Asset ID
   * @param {object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateAsset(assetId, updates) {
    if (this.useV2 && this.userId) {
      return await galleryServiceV2.updateAsset(assetId, this.userId, updates);
    }

    console.warn('updateAsset requires V2 and authenticated user');
  }

  /**
   * Search assets (V2 only)
   * @param {string} query - Search query
   * @returns {Promise<Array>}
   */
  async searchAssets(query) {
    if (this.useV2 && this.userId) {
      return await galleryServiceV2.searchAssets(this.userId, query);
    }

    console.warn('searchAssets requires V2 and authenticated user');
    return [];
  }

  /**
   * Get assets by type (V2 only)
   * @param {string} type - Asset type
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async getAssetsByType(type, limit = 50) {
    if (this.useV2 && this.userId) {
      return await galleryServiceV2.getAssetsByType(this.userId, type, limit);
    }

    console.warn('getAssetsByType requires V2 and authenticated user');
    return [];
  }

  /**
   * Get assets by category (V2 only)
   * @param {string} category - Asset category
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async getAssetsByCategory(category, limit = 50) {
    if (this.useV2 && this.userId) {
      return await galleryServiceV2.getAssetsByCategory(
        this.userId,
        category,
        limit
      );
    }

    console.warn('getAssetsByCategory requires V2 and authenticated user');
    return [];
  }

  /**
   * Enable or disable V2
   * @param {boolean} enabled - Enable V2
   */
  setV2Enabled(enabled) {
    this.useV2 = enabled;
    console.log(`Gallery V2 ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if V2 is enabled
   * @returns {boolean}
   */
  isV2Enabled() {
    return this.useV2 && !!this.userId;
  }
}

// Export singleton
const galleryServiceUnified = new GalleryServiceUnified();

export default galleryServiceUnified;
