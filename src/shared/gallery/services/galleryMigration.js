/**
 * Gallery Migration Utility
 *
 * One-way migration from V1 (IndexedDB) to V2 (Firestore + Firebase Storage)
 * Migration is per-user and happens only once
 */

import galleryService from './galleryService.js';
import galleryServiceV2 from './galleryServiceV2.js';

/**
 * Remove undefined values from object (Firestore doesn't accept undefined)
 * @param {object} obj - Object to clean
 * @returns {object} - Cleaned object
 */
function removeUndefined(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefined(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefined(value);
    }
  }
  return cleaned;
}

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
   * @param {object} options - Migration options
   * @param {boolean} options.keepV1Data - Keep V1 database after migration (for testing)
   * @returns {Promise<object>} - Migration status
   */
  async migrateAll(userId, onProgress = null, options = {}) {
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

        // Delete V1 database (unless keepV1Data flag is set for testing)
        if (!options.keepV1Data) {
          await this.deleteV1Database();
          console.log('V1 database deleted, migration complete');
        } else {
          console.warn(
            '⚠️ TESTING MODE: V1 database preserved for repeated testing'
          );
        }
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
    const rawMetadata = {
      ...asset.metadata,
      originalFilename: asset.id, // Use old ID as filename reference
      migrated: true,
      migratedAt: new Date().toISOString(),
      oldAssetId: asset.id
    };

    // Clean metadata to remove undefined values (Firestore doesn't accept undefined)
    const metadata = removeUndefined(rawMetadata);

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
   * Download all V1 IndexedDB images as a ZIP file
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<void>}
   */
  async downloadV1AsZip(onProgress = null) {
    try {
      console.log('Starting V1 gallery ZIP download...');

      // Initialize V1 service and get assets
      await galleryService.init();
      const assets = await galleryService.loadFromDB();

      if (assets.length === 0) {
        throw new Error('No images found in local gallery');
      }

      console.log(`Found ${assets.length} images to download`);

      // Dynamic import JSZip only when needed (keeps it out of core bundle)
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add each asset to the ZIP
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const blob = asset.imageData || asset.imageDataBlob;

        if (!blob) {
          console.warn(`Skipping asset ${asset.id}: no image data`);
          continue;
        }

        // Determine file extension based on type
        const isVideo = asset.type === 'video';
        const extension = isVideo ? 'mp4' : 'png';

        // Create filename from metadata or id
        const timestamp = asset.metadata?.timestamp
          ? new Date(asset.metadata.timestamp)
              .toISOString()
              .replace(/[:.]/g, '-')
              .slice(0, 19)
          : asset.id;
        const model = asset.metadata?.model || 'unknown';
        const filename = `${model}_${timestamp}.${extension}`;

        zip.file(filename, blob);

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: assets.length,
            percentage: ((i + 1) / assets.length) * 100
          });
        }
      }

      // Generate the ZIP file
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Trigger download
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `3dstreet-gallery-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log('ZIP download complete');
    } catch (error) {
      console.error('Error creating ZIP:', error);
      throw error;
    }
  }

  /**
   * Discard V1 data without migrating
   * Deletes local IndexedDB and marks user as migrated
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async discardV1Data(userId) {
    if (!userId) {
      throw new Error('User ID is required to discard V1 data');
    }

    console.log(`Discarding V1 data for user ${userId}...`);

    // Delete the V1 database
    await this.deleteV1Database();

    // Mark as migrated so the banner doesn't show again
    this.markAsMigrated(userId);

    console.log('V1 data discarded successfully');
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
