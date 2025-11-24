/**
 * Utility to update cache-control headers on existing Firebase Storage files
 * Run this once to fix existing assets
 */

import { ref, listAll, updateMetadata } from 'firebase/storage';
import { storage } from '@shared/services/firebase';

/**
 * Update cache headers for all files in a storage path
 * @param {string} userId - User ID
 * @returns {Promise<object>} - Results
 */
export async function updateCacheHeaders(userId) {
  const results = {
    updated: 0,
    failed: 0,
    errors: []
  };

  try {
    console.log(`Updating cache headers for user ${userId}...`);

    // List all files in user's assets folder
    const assetsRef = ref(storage, `users/${userId}/assets`);
    const listResult = await listAll(assetsRef);

    // Process images folder
    if (listResult.prefixes.length > 0) {
      for (const folderRef of listResult.prefixes) {
        console.log(`Processing folder: ${folderRef.name}`);
        const folderList = await listAll(folderRef);

        for (const fileRef of folderList.items) {
          try {
            // Update metadata with cache control
            await updateMetadata(fileRef, {
              cacheControl: 'public, max-age=31536000',
              contentType: fileRef.name.endsWith('.jpg')
                ? 'image/jpeg'
                : 'image/png'
            });

            results.updated++;
            console.log(`✓ Updated: ${fileRef.fullPath}`);
          } catch (error) {
            results.failed++;
            results.errors.push({
              file: fileRef.fullPath,
              error: error.message
            });
            console.error(`✗ Failed: ${fileRef.fullPath}`, error.message);
          }
        }
      }
    }

    console.log('\n=== Update Complete ===');
    console.log(`Updated: ${results.updated}`);
    console.log(`Failed: ${results.failed}`);

    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.forEach((err) => {
        console.log(`  - ${err.file}: ${err.error}`);
      });
    }

    return results;
  } catch (error) {
    console.error('Error updating cache headers:', error);
    throw error;
  }
}

// Make available globally for console use
if (typeof window !== 'undefined') {
  window.updateCacheHeaders = updateCacheHeaders;
  console.log('🔧 Cache header updater loaded. Usage:');
  console.log('  await updateCacheHeaders("YOUR_USER_ID")');
}

export default updateCacheHeaders;
