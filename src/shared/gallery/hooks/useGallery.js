/**
 * useGallery Hook - React hook for managing gallery state
 * Uses V2 (Firestore + Firebase Storage) exclusively
 */

import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import posthog from 'posthog-js';
import galleryServiceV2 from '../services/galleryServiceV2.js';
import galleryMigration from '../services/galleryMigration.js';
import {
  ASSET_TYPES,
  ASSET_CATEGORIES,
  MAX_GALLERY_ITEMS
} from '../constants.js';
import { AuthContext } from '@shared/contexts';
import { auth } from '@shared/services/firebase.js';

/**
 * Convert Firestore timestamp to ISO string
 * Handles various timestamp formats from Firestore consistently
 * @param {Object|Date|string|null} ts - Firestore Timestamp, Date, or ISO string
 * @returns {string} ISO 8601 timestamp string
 */
const convertTimestamp = (ts) => {
  if (!ts) return new Date().toISOString();
  if (ts.toDate) return ts.toDate().toISOString(); // Firestore Timestamp
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string') return ts;
  return new Date().toISOString(); // Fallback
};

/**
 * Custom hook for gallery state management
 * @returns {Object} Gallery state and methods
 */
const useGallery = () => {
  // Try to use AuthContext first (editor), fall back to window.authState (generator)
  // useContext will return default value if not in a provider
  const authContext = useContext(AuthContext);
  const contextUser = authContext?.currentUser;

  const [currentUser, setCurrentUser] = useState(
    contextUser || window.authState?.currentUser
  );
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const userId = currentUser?.uid || null;

  // Use ref to always get current userId in event handlers
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Listen for auth state changes from both AuthContext (editor) and window.authState (generator)
  useEffect(() => {
    // For generator: listen to window event
    const handleAuthChange = (event) => {
      setCurrentUser(event.detail.user);
    };

    window.addEventListener('authStateChanged', handleAuthChange);

    // For editor: update when contextUser changes
    if (contextUser !== currentUser) {
      setCurrentUser(contextUser);
    }

    return () => {
      window.removeEventListener('authStateChanged', handleAuthChange);
    };
  }, [contextUser, currentUser]);

  /**
   * Reload items from Firestore
   */
  const reloadItems = useCallback(async () => {
    // Get the current user directly from Firebase auth or window.authState
    const currentAuthUser = auth.currentUser || window.authState?.currentUser;
    const currentUserId = currentAuthUser?.uid;

    if (!currentUserId) {
      return; // Don't clear items, just skip reload
    }

    try {
      const assets = await galleryServiceV2.getAssets(
        currentUserId,
        {},
        MAX_GALLERY_ITEMS
      );

      // Convert to display format
      const displayItems = assets.map((asset) => {
        const timestamp = convertTimestamp(asset.createdAt);

        return {
          id: asset.assetId,
          type: asset.type, // Media type (image, video)
          objectURL: asset.thumbnailUrl || asset.storageUrl, // Thumbnail for grid
          fullImageURL: asset.storageUrl, // Full image for modal
          storageUrl: asset.storageUrl,
          thumbnailUrl: asset.thumbnailUrl,
          metadata: {
            ...asset.generationMetadata,
            timestamp
          }
        };
      });

      setItems(displayItems);
    } catch (error) {
      console.error('Failed to reload gallery items:', error);
      // Don't clear items on error
    }
  }, []); // No dependencies - always get fresh auth state

  /**
   * Initialize the gallery (V2 only)
   */
  useEffect(() => {
    // Early return if no userId - don't attach event listeners with null userId
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const initGallery = async () => {
      try {
        setIsLoading(true);

        // Initialize V2 service
        await galleryServiceV2.init();

        // Check if migration is needed
        const migrationNeeded =
          await galleryMigration.isMigrationNeeded(userId);
        setNeedsMigration(migrationNeeded);

        // UI will show migration prompt if migrationNeeded is true

        // Load items from Firestore
        await reloadItems();
      } catch (error) {
        console.error('Failed to initialize gallery:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initGallery();

    // Listen for external item additions
    // Use function that reads current userId from ref
    const handleAssetAdded = (event) => {
      const currentUserId = userIdRef.current;
      const eventUserId = event.detail?.userId;

      if (!currentUserId) {
        return;
      }

      // Filter: only process events for this user's gallery
      if (eventUserId !== currentUserId) {
        return;
      }

      // Optimistic update: if asset data is provided, add it immediately
      if (event.detail?.asset) {
        const asset = event.detail.asset;
        const timestamp = convertTimestamp(asset.createdAt);

        const displayItem = {
          id: asset.assetId,
          type: asset.type, // Media type (image, video)
          objectURL: asset.thumbnailUrl || asset.storageUrl,
          fullImageURL: asset.storageUrl,
          storageUrl: asset.storageUrl,
          thumbnailUrl: asset.thumbnailUrl,
          metadata: {
            ...asset.generationMetadata,
            timestamp
          }
        };

        // Add to beginning of items array
        setItems((prevItems) => [displayItem, ...prevItems]);
      }
    };

    // Fallback reload handler for when optimistic updates fail
    const handleAssetAddedReload = (event) => {
      const currentUserId = userIdRef.current;
      const eventUserId = event.detail?.userId;

      if (!currentUserId) {
        return;
      }

      // Filter: only process events for this user's gallery
      if (eventUserId !== currentUserId) {
        return;
      }

      reloadItems();
    };

    galleryServiceV2.events.addEventListener('assetAdded', handleAssetAdded);
    galleryServiceV2.events.addEventListener(
      'assetAddedReload',
      handleAssetAddedReload
    );

    return () => {
      galleryServiceV2.events.removeEventListener(
        'assetAdded',
        handleAssetAdded
      );
      galleryServiceV2.events.removeEventListener(
        'assetAddedReload',
        handleAssetAddedReload
      );
    };
  }, [userId, reloadItems]); // Include reloadItems since handleAssetAddedReload uses it

  // Simple window event listener for gallery refresh (works even when userId is null)
  // This is a fallback for the generator where EventTarget events may not work
  useEffect(() => {
    const handleWindowRefresh = () => {
      reloadItems();
    };
    window.addEventListener('gallery:refresh', handleWindowRefresh);
    return () => {
      window.removeEventListener('gallery:refresh', handleWindowRefresh);
    };
  }, [reloadItems]);

  /**
   * Add a new item to the gallery (V2)
   * @param {string} imageDataUri - Data URI of the image
   * @param {object} metadata - Image metadata
   * @param {string} type - Image type (use ASSET_CATEGORIES constants)
   * @returns {Promise<string>} - Returns the new asset ID
   */
  const addItem = useCallback(
    async (imageDataUri, metadata, type = ASSET_CATEGORIES.AI_RENDER) => {
      // Get userId directly from Firebase auth (handles generator timing issues)
      const currentUserId =
        auth.currentUser?.uid || window.authState?.currentUser?.uid;
      if (!currentUserId) {
        throw new Error('User must be logged in to add items to gallery');
      }

      try {
        // Map type to V2 structure
        const assetType =
          type === ASSET_TYPES.VIDEO ? ASSET_TYPES.VIDEO : ASSET_TYPES.IMAGE;
        const category =
          type === ASSET_TYPES.VIDEO ? ASSET_CATEGORIES.AI_RENDER : type;

        const assetId = await galleryServiceV2.addAsset(
          imageDataUri,
          metadata,
          assetType,
          category,
          currentUserId
        );

        // Track asset added to cloud gallery
        posthog.capture('gallery_asset_added', {
          asset_type: assetType,
          category: category
        });

        // Reload items from Firestore
        await reloadItems();

        // Jump to first page to show the new item
        setPage(1);

        return assetId;
      } catch (error) {
        console.error('Failed to add item to gallery:', error);
        throw error;
      }
    },
    [reloadItems]
  );

  /**
   * Remove an item from the gallery (V2 - soft delete)
   * @param {string} id - Asset ID to remove
   * @returns {Promise<boolean>}
   */
  const removeItem = useCallback(
    async (id) => {
      // Get userId directly from Firebase auth (handles generator timing issues)
      const currentUserId =
        auth.currentUser?.uid || window.authState?.currentUser?.uid;
      if (!currentUserId) {
        throw new Error('User must be logged in to remove items');
      }

      try {
        await galleryServiceV2.deleteAsset(id, currentUserId, false); // Soft delete

        // Update local state
        const updatedItems = items.filter((item) => item.id !== id);
        setItems(updatedItems);

        // Adjust page if necessary
        const newTotalPages = Math.max(
          1,
          Math.ceil(updatedItems.length / pageSize)
        );
        if (page > newTotalPages) {
          setPage(newTotalPages);
        }

        return true;
      } catch (error) {
        console.error('Failed to remove item from gallery:', error);
        throw error;
      }
    },
    [items, page, pageSize]
  );

  /**
   * Download V1 local images as a ZIP file
   * @returns {Promise<void>}
   */
  const downloadV1AsZip = useCallback(async () => {
    try {
      setIsDownloadingZip(true);
      setZipProgress(0);

      await galleryMigration.downloadV1AsZip((progress) => {
        setZipProgress(progress.percentage);
      });
    } catch (error) {
      console.error('Failed to download V1 as ZIP:', error);
      throw error;
    } finally {
      setIsDownloadingZip(false);
      setZipProgress(0);
    }
  }, []);

  /**
   * Discard V1 local data without migrating
   * @returns {Promise<void>}
   */
  const discardV1Data = useCallback(async () => {
    // Get userId directly from Firebase auth (handles generator timing issues)
    const currentUserId =
      auth.currentUser?.uid || window.authState?.currentUser?.uid;
    if (!currentUserId) {
      throw new Error('User must be logged in to discard V1 data');
    }

    try {
      await galleryMigration.discardV1Data(currentUserId);
      setNeedsMigration(false);
    } catch (error) {
      console.error('Failed to discard V1 data:', error);
      throw error;
    }
  }, []);

  /**
   * Download an item
   * For cross-origin URLs (Firebase Storage), fetches blob first then downloads
   * @param {object} item - Gallery item to download
   */
  const downloadItem = useCallback(async (item) => {
    // Create filename
    const isVideo = item.type === ASSET_TYPES.VIDEO;
    const model = item.metadata?.model || '3dstreet';
    const timestamp = item.metadata?.timestamp
      ? new Date(item.metadata.timestamp)
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19)
      : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    let extension;
    if (isVideo) {
      extension = 'mp4';
    } else {
      const format = item.metadata?.output_format || 'png';
      extension = format === 'jpeg' ? 'jpg' : 'png';
    }

    const filename = `${model}-${timestamp}.${extension}`;
    const imageUrl = item.fullImageURL || item.storageUrl || item.objectURL;

    try {
      // Fetch as blob to enable download for cross-origin URLs
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up blob URL
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Failed to download, opening in new tab:', error);
      // Fallback: open in new tab if fetch fails
      window.open(imageUrl, '_blank');
    }
  }, []);

  /**
   * Change page size
   * @param {number} newSize - New page size
   */
  const changePageSize = useCallback(
    (newSize) => {
      // Recompute page to keep first item visible when possible
      const firstIndex = (page - 1) * pageSize;
      setPageSize(newSize);
      const newPage = Math.floor(firstIndex / newSize) + 1;
      const maxPage = Math.max(1, Math.ceil(items.length / newSize));
      setPage(Math.min(newPage, maxPage));
    },
    [page, pageSize, items.length]
  );

  /**
   * Run V1 to V2 migration
   * @returns {Promise<object>}
   */
  const runMigration = useCallback(async () => {
    // Check multiple sources for user ID to handle timing issues
    // where auth.currentUser is set but React state hasn't updated yet
    const effectiveUserId =
      userId || auth.currentUser?.uid || window.authState?.currentUser?.uid;

    if (!effectiveUserId) {
      throw new Error('User must be logged in to migrate');
    }

    try {
      setIsMigrating(true);
      setMigrationProgress(0);

      // Track migration started
      posthog.capture('gallery_migration_started');

      const status = await galleryMigration.migrateAll(
        effectiveUserId,
        (progress) => {
          setMigrationProgress(progress.percentage);
        }
      );

      // Track migration completed
      posthog.capture('gallery_migration_completed', {
        migrated_count: status.migrated,
        failed_count: status.failed,
        total_count: status.total,
        skipped_count: status.skipped
      });

      // Reload items after migration
      await reloadItems();

      setNeedsMigration(false);

      // Emit success event
      galleryServiceV2.events.dispatchEvent(
        new CustomEvent('migrationComplete', { detail: { status } })
      );

      return status;
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    } finally {
      setIsMigrating(false);
      setMigrationProgress(0);
    }
  }, [userId, reloadItems]);

  // Check auth state from multiple sources for isLoggedIn
  // This handles the generator case where auth.currentUser may be set before state updates
  const isLoggedIn = !!(
    userId ||
    auth.currentUser?.uid ||
    window.authState?.currentUser?.uid
  );

  return {
    items,
    isLoading,
    isLoggedIn,
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize: changePageSize,
    addItem,
    removeItem,
    downloadItem,
    reloadItems,
    // Migration
    needsMigration,
    isMigrating,
    migrationProgress,
    runMigration,
    // V1 data management
    downloadV1AsZip,
    discardV1Data,
    isDownloadingZip,
    zipProgress
  };
};

export default useGallery;
