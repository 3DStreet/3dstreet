/**
 * Gallery Migration Utility
 *
 * One-way migration from V1 (IndexedDB) to V2 (Firestore + Firebase Storage)
 * Migration is per-user and happens only once
 */

import galleryService from './galleryService.js';
import galleryServiceV2 from './galleryServiceV2.js';

class GalleryMigration {
  constructor() {
    this.migrationStatus = {
      total: 0,
      migrated: 0,
      failed: 0,
      errors: []
    };
  }

  /**
   * Get migration flag key for user
   * @param {string} userId - User ID
   * @returns {string}
   */
  getMigrationFlagKey(userId) {
    return `gallery_migrated_${userId}`;
  }

  /**
   * Check if user has already migrated
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  hasMigrated(userId) {
    if (!userId) return false;
    const flagKey = this.getMigrationFlagKey(userId);
    return localStorage.getItem(flagKey) === 'true';
  }

  /**
   * Mark user as migrated
   * @param {string} userId - User ID
   */
  markAsMigrated(userId) {
    if (!userId) return;
    const flagKey = this.getMigrationFlagKey(userId);
    localStorage.setItem(flagKey, 'true');
    console.log(`User ${userId} marked as migrated`);
  }

  /**
   * Check if migration is needed for this user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async isMigrationNeeded(userId) {
    try {
      if (!userId) {
        return false;
      }

      // Check if already migrated
      if (this.hasMigrated(userId)) {
        console.log(`User ${userId} already migrated, skipping`);
        return false;
      }

      // Check if there are any assets in old IndexedDB
      await galleryService.init();
      const oldAssets = await galleryService.loadFromDB();

      // Migration needed if V1 has data and user hasn't migrated yet
      return oldAssets.length > 0;
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false;
    }
  }

  /**
   * Migrate all assets from V1 (IndexedDB) to V2 (Firestore)
   * This is a one-way, one-time migration per user
   * @param {string} userId - User ID
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<object>} - Migration status
   */
  async migrateAll(userId, onProgress = null) {
    if (!userId) {
      throw new Error('User ID is required for migration');
    }

    // Check if already migrated
    if (this.hasMigrated(userId)) {
      console.log(`User ${userId} already migrated, skipping`);
      return {
        total: 0,
        migrated: 0,
        failed: 0,
        errors: [],
        alreadyMigrated: true
      };
    }

    // Reset migration status
    this.reset();

    try {
      console.log(`Starting one-way V1→V2 migration for user ${userId}...`);

      // Initialize services
      await galleryService.init();
      await galleryServiceV2.init();

      // Get all assets from old IndexedDB
      const oldAssets = await galleryService.loadFromDB();
      this.migrationStatus.total = oldAssets.length;

      if (oldAssets.length === 0) {
        console.log('No V1 assets to migrate');
        // Mark as migrated even if no assets
        this.markAsMigrated(userId);
        return this.migrationStatus;
      }

      console.log(`Found ${oldAssets.length} V1 assets to migrate to V2`);

      // Migrate each asset
      for (let i = 0; i < oldAssets.length; i++) {
        const asset = oldAssets[i];

        try {
          await this.migrateAsset(asset, userId);
          this.migrationStatus.migrated++;

          if (onProgress) {
            onProgress({
              current: i + 1,
              total: oldAssets.length,
              percentage: ((i + 1) / oldAssets.length) * 100
            });
          }
        } catch (error) {
          console.error(`Failed to migrate asset ${asset.id}:`, error);
          this.migrationStatus.failed++;
          this.migrationStatus.errors.push({
            assetId: asset.id,
            error: error.message
          });
        }
      }

      console.log('Migration completed:', this.migrationStatus);

      // If migration was successful (all or most migrated), mark as complete and delete V1 DB
      if (this.migrationStatus.migrated > 0) {
        // Mark user as migrated
        this.markAsMigrated(userId);

        // Delete V1 database
        await this.deleteV1Database();

        console.log('V1 database deleted, migration complete');
      } else {
        console.warn('Migration failed for all assets, V1 database retained');
      }

      return this.migrationStatus;
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  }

  /**
   * Migrate a single asset
   * @param {object} asset - Asset from old IndexedDB
   * @param {string} userId - User ID
   * @returns {Promise<string>} - New asset ID
   */
  async migrateAsset(asset, userId) {
    // Extract metadata from old asset
    const metadata = {
      ...asset.metadata,
      originalFilename: asset.id, // Use old ID as filename reference
      migrated: true,
      migratedAt: new Date().toISOString(),
      oldAssetId: asset.id
    };

    // Determine type and category
    const type = asset.type === 'video' ? 'video' : 'image';
    const category = asset.type || 'ai-render';

    // Get blob data
    const blob = asset.imageData || asset.imageDataBlob;

    if (!blob) {
      throw new Error('No image data found in asset');
    }

    // Add to new service
    const newAssetId = await galleryServiceV2.addAsset(
      blob,
      metadata,
      type,
      category,
      userId
    );

    console.log(`Migrated asset ${asset.id} → ${newAssetId}`);
    return newAssetId;
  }

  /**
   * Delete V1 IndexedDB database completely
   * @returns {Promise<void>}
   */
  async deleteV1Database() {
    return new Promise((resolve, reject) => {
      console.log('Deleting V1 IndexedDB database...');

      const dbName = galleryService.dbName; // '3DStreetGalleryDB'
      const deleteRequest = indexedDB.deleteDatabase(dbName);

      deleteRequest.onsuccess = () => {
        console.log(`V1 database '${dbName}' deleted successfully`);
        resolve();
      };

      deleteRequest.onerror = (event) => {
        console.error('Error deleting V1 database:', event.target.error);
        reject(event.target.error);
      };

      deleteRequest.onblocked = () => {
        console.warn('V1 database deletion blocked (close all tabs using it)');
        // Still resolve, will be deleted when tabs close
        resolve();
      };
    });
  }

  /**
   * Clean up old IndexedDB data (deprecated - use deleteV1Database)
   * @deprecated Use deleteV1Database instead
   * @returns {Promise<void>}
   */
  async cleanupOldData() {
    console.warn('cleanupOldData is deprecated, use deleteV1Database');
    return this.deleteV1Database();
  }

  /**
   * Get migration status
   * @returns {object}
   */
  getStatus() {
    return this.migrationStatus;
  }

  /**
   * Reset migration status
   */
  reset() {
    this.migrationStatus = {
      total: 0,
      migrated: 0,
      failed: 0,
      errors: []
    };
  }
}

// Export singleton
const galleryMigration = new GalleryMigration();
export default galleryMigration;
