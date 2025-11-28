/**
 * Debug utility to check V1 and V2 gallery data
 * Usage: Import and call in browser console or add to app temporarily
 */

import galleryService from '../services/galleryService.js';
import galleryServiceV2 from '../services/galleryServiceV2.js';
import galleryMigration from '../services/galleryMigration.js';
import updateCacheHeaders from './updateCacheHeaders.js';

/**
 * Check V1 data in IndexedDB
 */
export async function checkV1Data() {
  try {
    await galleryService.init();
    const v1Assets = await galleryService.loadFromDB();

    console.log('=== V1 Gallery Data ===');
    console.log(`Found ${v1Assets.length} assets in V1 IndexedDB`);

    if (v1Assets.length > 0) {
      console.log('First asset:', {
        id: v1Assets[0].id,
        type: v1Assets[0].type,
        metadata: v1Assets[0].metadata,
        hasBlob: !!v1Assets[0].imageData || !!v1Assets[0].imageDataBlob
      });
    }

    return v1Assets;
  } catch (error) {
    console.error('Error checking V1 data:', error);
    return [];
  }
}

/**
 * Check V2 data in Firestore
 */
export async function checkV2Data(userId) {
  try {
    if (!userId) {
      console.log('No userId provided - cannot check V2 data');
      return [];
    }

    await galleryServiceV2.init();
    const v2Assets = await galleryServiceV2.getAssets(userId, {}, 200);

    console.log('=== V2 Gallery Data ===');
    console.log(
      `Found ${v2Assets.length} assets in Firestore for user ${userId}`
    );

    if (v2Assets.length > 0) {
      console.log('First asset:', {
        assetId: v2Assets[0].assetId,
        type: v2Assets[0].type,
        category: v2Assets[0].category,
        storageUrl: v2Assets[0].storageUrl?.substring(0, 50) + '...'
      });
    }

    return v2Assets;
  } catch (error) {
    console.error('Error checking V2 data:', error);
    return [];
  }
}

/**
 * Check migration status
 */
export async function checkMigrationStatus(userId) {
  if (!userId) {
    console.log('No userId - cannot check migration status');
    return;
  }

  console.log('=== Migration Status ===');

  const hasMigrated = galleryMigration.hasMigrated(userId);
  console.log(`Has migrated: ${hasMigrated}`);

  const flagKey = galleryMigration.getMigrationFlagKey(userId);
  console.log(`Migration flag key: ${flagKey}`);
  console.log(`Flag value: ${localStorage.getItem(flagKey)}`);

  const needsMigration = await galleryMigration.isMigrationNeeded(userId);
  console.log(`Needs migration: ${needsMigration}`);
}

/**
 * Check V2 caching strategy
 * Note: V2 uses browser HTTP cache (via Cache-Control headers), not IndexedDB
 */
export function checkV2Cache() {
  console.log('=== V2 Caching Strategy ===');
  console.log('V2 uses browser HTTP cache, not IndexedDB.');
  console.log(
    'Images are cached via Cache-Control: public, max-age=31536000 (1 year)'
  );
  console.log(
    'To verify caching, check Network tab in DevTools for cached responses.'
  );
  return [];
}

/**
 * Full debug report
 */
export async function fullDebugReport(userId) {
  console.log('🔍 3DStreet Gallery Debug Report');
  console.log('================================\n');

  console.log(`User ID: ${userId || 'NOT LOGGED IN'}\n`);

  // Check V1
  const v1Assets = await checkV1Data();
  console.log('');

  // Check V2 if logged in
  if (userId) {
    // const v2Assets = await checkV2Data(userId); // caused linter error re: unused var
    // console.log('');

    await checkMigrationStatus(userId);
    console.log('');

    await checkV2Cache();
    console.log('');
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`V1 assets: ${v1Assets.length}`);

  if (userId) {
    const v2Assets = await galleryServiceV2
      .getAssets(userId, {}, 1)
      .catch(() => []);
    const needsMigration = await galleryMigration.isMigrationNeeded(userId);

    console.log(`V2 assets: ${v2Assets.length}`);
    console.log(`Migration needed: ${needsMigration}`);

    if (v1Assets.length > 0 && needsMigration) {
      console.log('\n⚠️ ACTION REQUIRED:');
      console.log('You have V1 data that needs to be migrated to V2.');
      console.log('Run: await migrateNow()');
    }
  } else {
    console.log('\n⚠️ NOT LOGGED IN:');
    console.log(
      'V2 requires authentication. Please log in to access your gallery.'
    );
  }
}

/**
 * Trigger migration manually
 * @param {string} userId - User ID
 * @param {object} options - Migration options
 * @param {boolean} options.keepV1Data - Keep V1 data for repeated testing
 */
export async function migrateNow(userId, options = {}) {
  if (!userId) {
    console.error('❌ Cannot migrate: No user ID provided');
    return;
  }

  console.log(`🚀 Starting migration for user ${userId}...`);
  if (options.keepV1Data) {
    console.log('⚠️ Testing mode: V1 data will be preserved');
  }

  try {
    const status = await galleryMigration.migrateAll(
      userId,
      (progress) => {
        console.log(
          `📊 Progress: ${progress.current}/${progress.total} (${progress.percentage.toFixed(1)}%)`
        );
      },
      options
    );

    console.log('\n✅ Migration complete!');
    console.log(`Migrated: ${status.migrated}`);
    console.log(`Failed: ${status.failed}`);

    if (status.errors && status.errors.length > 0) {
      console.log('\n❌ Errors:');
      status.errors.forEach((err) => {
        console.log(`  - Asset ${err.assetId}: ${err.error}`);
      });
    }

    // Check results
    console.log('\n📋 Verifying migration...');
    await fullDebugReport(userId);

    return status;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Reset migration flag (for testing repeated migrations)
 */
export function resetMigrationFlag(userId) {
  if (!userId) {
    console.error('❌ No user ID provided');
    return;
  }

  const flagKey = galleryMigration.getMigrationFlagKey(userId);
  localStorage.removeItem(flagKey);
  console.log(`✅ Migration flag cleared for user ${userId}`);
  console.log('Reload the page to see migration prompt again');
}

// Make functions available globally for console use (development only)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  window.debugGallery = {
    checkV1Data,
    checkV2Data,
    checkMigrationStatus,
    checkV2Cache,
    fullDebugReport,
    migrateNow,
    resetMigrationFlag,
    updateCacheHeaders
  };

  console.log('🔧 Gallery debug tools loaded. Available commands:');
  console.log('  - debugGallery.fullDebugReport(userId)');
  console.log('  - debugGallery.checkV1Data()');
  console.log('  - debugGallery.migrateNow(userId)');
  console.log(
    '  - debugGallery.migrateNow(userId, {keepV1Data: true}) // Testing mode'
  );
  console.log('  - debugGallery.resetMigrationFlag(userId)');
  console.log(
    '  - debugGallery.updateCacheHeaders(userId) // Fix cache headers on existing files'
  );
}

export default {
  checkV1Data,
  checkV2Data,
  checkMigrationStatus,
  checkV2Cache,
  fullDebugReport,
  migrateNow,
  resetMigrationFlag,
  updateCacheHeaders
};
