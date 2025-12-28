/**
 * Gallery Constants
 * Centralized constants for asset types, categories, and storage paths
 */

/**
 * Maximum number of gallery items to load/display
 * @type {number}
 */
export const MAX_GALLERY_ITEMS = 200;

/**
 * Valid asset types for gallery items
 * @readonly
 * @enum {string}
 */
export const ASSET_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  SPLAT: 'splat',
  MESH: 'mesh',
  GEOJSON: 'geojson'
};

/**
 * Valid asset categories for gallery items
 * @readonly
 * @enum {string}
 */
export const ASSET_CATEGORIES = {
  AI_RENDER: 'ai-render',
  SCREENSHOT: 'screenshot',
  UPLOAD: 'upload',
  SPLAT_SOURCE: 'splat-source',
  SPLAT_OUTPUT: 'splat-output',
  PLACEMARK: 'placemark'
};

/**
 * Pluralization map for asset type folders in storage
 * Maps singular type to plural folder name
 * @readonly
 */
export const ASSET_TYPE_FOLDERS = {
  [ASSET_TYPES.IMAGE]: 'images',
  [ASSET_TYPES.VIDEO]: 'videos',
  [ASSET_TYPES.SPLAT]: 'splats',
  [ASSET_TYPES.MESH]: 'meshes',
  [ASSET_TYPES.GEOJSON]: 'geojsons'
};

/**
 * Storage path configuration
 * Matches the structure in public/storage.rules: users/{userId}/assets/{allPaths=**}
 */
export const STORAGE_PATHS = {
  /**
   * Base path pattern for user assets
   * @param {string} userId - The user ID
   * @returns {string} Base path for user's assets
   */
  userAssetsBase: (userId) => `users/${userId}/assets`,

  /**
   * Full path for an asset file
   * @param {string} userId - The user ID
   * @param {string} typeFolder - The pluralized type folder (e.g., 'images', 'videos')
   * @param {string} filename - The filename
   * @returns {string} Full storage path
   */
  assetFile: (userId, typeFolder, filename) =>
    `users/${userId}/assets/${typeFolder}/${filename}`
};

/**
 * Get the plural folder name for an asset type
 * @param {string} type - The asset type (e.g., 'image', 'video')
 * @returns {string} The plural folder name (e.g., 'images', 'videos')
 * @throws {Error} If the type is not recognized
 */
export function getTypeFolderName(type) {
  const folder = ASSET_TYPE_FOLDERS[type];
  if (!folder) {
    throw new Error(
      `Unknown asset type: ${type}. Valid types are: ${Object.values(ASSET_TYPES).join(', ')}`
    );
  }
  return folder;
}

/**
 * Validate a user ID for use in storage paths
 * Ensures the userId doesn't contain characters that could cause path traversal or other issues
 * @param {string} userId - The user ID to validate
 * @returns {boolean} True if valid
 * @throws {Error} If the userId is invalid
 */
export function validateUserIdForPath(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('User ID is required and must be a string');
  }

  // Check for empty or whitespace-only
  if (userId.trim().length === 0) {
    throw new Error('User ID cannot be empty');
  }

  // Check for path traversal attempts
  if (userId.includes('..') || userId.includes('/') || userId.includes('\\')) {
    throw new Error('User ID contains invalid characters');
  }

  // Firebase UIDs are typically alphanumeric with some special chars
  // This regex matches Firebase Auth UIDs
  const validUserIdPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validUserIdPattern.test(userId)) {
    throw new Error(
      'User ID contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed.'
    );
  }

  return true;
}
