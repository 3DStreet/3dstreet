/**
 * useGallery Hook - React hook for managing gallery state
 * Uses V2 (Firestore + Firebase Storage) exclusively
 */

import { useState, useEffect, useCallback, useContext } from 'react';
import galleryServiceV2 from '../services/galleryServiceV2.js';
import galleryMigration from '../services/galleryMigration.js';
import { AuthContext } from '@shared/contexts';

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

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const userId = currentUser?.uid || null;

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
    if (!userId) {
      setItems([]);
      return;
    }

    try {
      const assets = await galleryServiceV2.getAssets(userId, {}, 200);

      // Convert to display format
      const displayItems = assets.map((asset) => {
        // Handle Firestore Timestamp objects
        let timestamp = asset.createdAt;
        if (timestamp?.toMillis) {
          timestamp = new Date(timestamp.toMillis()).toISOString();
        } else if (timestamp?.toDate) {
          timestamp = timestamp.toDate().toISOString();
        } else if (typeof timestamp !== 'string') {
          timestamp = new Date().toISOString();
        }

        return {
          id: asset.assetId,
          type: asset.category,
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
      setItems([]);
    }
  }, [userId]);

  /**
   * Initialize the gallery (V2 only)
   */
  useEffect(() => {
    const initGallery = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);

        // Initialize V2 service
        await galleryServiceV2.init();

        // Check if migration is needed
        const migrationNeeded =
          await galleryMigration.isMigrationNeeded(userId);
        setNeedsMigration(migrationNeeded);

        if (migrationNeeded) {
          console.log('V1→V2 migration needed for user');
          // UI can show migration prompt
        }

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
    const handleItemAdded = () => {
      reloadItems();
    };

    const handleAssetAdded = () => {
      reloadItems();
    };

    galleryServiceV2.events.addEventListener('itemAdded', handleItemAdded);
    galleryServiceV2.events.addEventListener('assetAdded', handleAssetAdded);

    return () => {
      galleryServiceV2.events.removeEventListener('itemAdded', handleItemAdded);
      galleryServiceV2.events.removeEventListener(
        'assetAdded',
        handleAssetAdded
      );
    };
  }, [reloadItems, userId]);

  /**
   * Add a new item to the gallery (V2)
   * @param {string} imageDataUri - Data URI of the image
   * @param {object} metadata - Image metadata
   * @param {string} type - Image type ('screenshot' | 'ai-render' | 'video')
   * @returns {Promise<string>} - Returns the new asset ID
   */
  const addItem = useCallback(
    async (imageDataUri, metadata, type = 'ai-render') => {
      if (!userId) {
        throw new Error('User must be logged in to add items to gallery');
      }

      try {
        // Map type to V2 structure
        const assetType = type === 'video' ? 'video' : 'image';
        const category = type === 'video' ? 'ai-render' : type;

        const assetId = await galleryServiceV2.addAsset(
          imageDataUri,
          metadata,
          assetType,
          category,
          userId
        );

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
    [userId, reloadItems]
  );

  /**
   * Remove an item from the gallery (V2 - soft delete)
   * @param {string} id - Asset ID to remove
   * @returns {Promise<boolean>}
   */
  const removeItem = useCallback(
    async (id) => {
      if (!userId) {
        throw new Error('User must be logged in to remove items');
      }

      try {
        await galleryServiceV2.deleteAsset(id, userId, false); // Soft delete

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
    [userId, items, page, pageSize]
  );

  /**
   * Clear all items from the gallery (V2)
   * @returns {Promise<void>}
   */
  const clearGallery = useCallback(async () => {
    if (!userId) {
      throw new Error('User must be logged in to clear gallery');
    }

    try {
      const assets = await galleryServiceV2.getAssets(userId, {}, 500);
      for (const asset of assets) {
        await galleryServiceV2.deleteAsset(asset.assetId, userId, true); // Hard delete
      }

      setItems([]);
      setPage(1);
    } catch (error) {
      console.error('Failed to clear gallery:', error);
      throw error;
    }
  }, [userId]);

  /**
   * Download an item
   * @param {object} item - Gallery item to download
   */
  const downloadItem = useCallback((item) => {
    const link = document.createElement('a');
    link.href = item.fullImageURL || item.storageUrl || item.objectURL;

    // Create filename
    const isVideo = item.type === 'video';
    const model =
      item.metadata?.model ||
      (item.type === 'screenshot' ? '3dstreet' : 'flux');
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

    link.download = `${model}-${timestamp}.${extension}`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    if (!userId) {
      throw new Error('User must be logged in to migrate');
    }

    try {
      setIsMigrating(true);
      setMigrationProgress(0);

      const status = await galleryMigration.migrateAll(userId, (progress) => {
        setMigrationProgress(progress.percentage);
      });

      console.log('Migration complete:', status);

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

  return {
    items,
    isLoading,
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize: changePageSize,
    addItem,
    removeItem,
    clearGallery,
    downloadItem,
    // Migration
    needsMigration,
    isMigrating,
    migrationProgress,
    runMigration
  };
};

export default useGallery;
