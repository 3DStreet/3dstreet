/**
 * Gallery Migration Utility
 *
 * Migrates existing IndexedDB gallery assets to Firestore + Firebase Storage
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
   * Check if migration is needed
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async isMigrationNeeded(userId) {
    try {
      // Check if there are any assets in old IndexedDB
      await galleryService.init();
      const oldAssets = await galleryService.loadFromDB();

      if (oldAssets.length === 0) {
        return false;
      }

      // Check if any assets already exist in Firestore
      const newAssets = await galleryServiceV2.getAssets(userId, {}, 1);

      // If old assets exist and no new assets, migration is needed
      return oldAssets.length > 0 && newAssets.length === 0;
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false;
    }
  }

  /**
   * Migrate all assets from IndexedDB to Firestore
   * @param {string} userId - User ID
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<object>} - Migration status
   */
  async migrateAll(userId, onProgress = null) {
    if (!userId) {
      throw new Error('User ID is required for migration');
    }

    try {
      console.log('Starting gallery migration...');

      // Initialize services
      await galleryService.init();
      await galleryServiceV2.init();

      // Get all assets from old IndexedDB
      const oldAssets = await galleryService.loadFromDB();
      this.migrationStatus.total = oldAssets.length;

      if (oldAssets.length === 0) {
        console.log('No assets to migrate');
        return this.migrationStatus;
      }

      console.log(`Found ${oldAssets.length} assets to migrate`);

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
   * Clean up old IndexedDB data after successful migration
   * @returns {Promise<void>}
   */
  async cleanupOldData() {
    try {
      await galleryService.init();
      await galleryService.clearGallery();
      console.log('Old IndexedDB data cleaned up');
    } catch (error) {
      console.error('Error cleaning up old data:', error);
      throw error;
    }
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
