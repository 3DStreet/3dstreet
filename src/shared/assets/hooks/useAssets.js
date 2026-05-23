/**
 * useAssets Hook - React hook for managing gallery state
 */

import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import posthog from 'posthog-js';
import assetsService from '../services/assetsService.js';
import {
  ASSET_TYPES,
  ASSET_CATEGORIES,
  ASSETS_FETCH_BATCH_SIZE
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

const assetToDisplayItem = (asset) => {
  const timestamp = convertTimestamp(asset.createdAt);
  return {
    id: asset.assetId,
    type: asset.type,
    category: asset.category,
    // Editable display name (falls back to originalFilename for legacy docs
    // that predate the field).
    name: asset.name || asset.originalFilename,
    originalFilename: asset.originalFilename,
    size: asset.size,
    mimeType: asset.mimeType,
    userId: asset.userId,
    objectURL: asset.thumbnailUrl || asset.storageUrl,
    fullImageURL: asset.storageUrl,
    storageUrl: asset.storageUrl,
    optimizedSourceUrl: asset.optimizedSourceUrl,
    thumbnailUrl: asset.thumbnailUrl,
    metadata: {
      ...asset.generationMetadata,
      ...(asset.width &&
        !asset.generationMetadata?.width && { width: asset.width }),
      ...(asset.height &&
        !asset.generationMetadata?.height && { height: asset.height }),
      timestamp
    }
  };
};

/**
 * Custom hook for gallery state management
 * @returns {Object} Assets state and methods
 */
const useAssets = () => {
  // Try to use AuthContext first (editor), fall back to window.authState (generator)
  // useContext will return default value if not in a provider
  const authContext = useContext(AuthContext);
  const contextUser = authContext?.currentUser;

  const [currentUser, setCurrentUser] = useState(
    contextUser || window.authState?.currentUser
  );
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const userId = currentUser?.uid || null;

  // Cursor (QueryDocumentSnapshot) for Firestore startAfter
  const lastDocRef = useRef(null);
  // Guard against overlapping loadMore calls
  const isFetchingMoreRef = useRef(false);

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
   * Reload items from Firestore (reset cursor, fetch first page)
   */
  const reloadItems = useCallback(async () => {
    const currentAuthUser = auth.currentUser || window.authState?.currentUser;
    const currentUserId = currentAuthUser?.uid;

    if (!currentUserId) {
      return;
    }

    try {
      const {
        assets,
        lastDoc,
        hasMore: nextHasMore
      } = await assetsService.getAssetsPage(currentUserId, {
        pageSize: ASSETS_FETCH_BATCH_SIZE
      });

      setItems(assets.map(assetToDisplayItem));
      lastDocRef.current = lastDoc;
      setHasMore(nextHasMore);
    } catch (error) {
      console.error('Failed to reload gallery items:', error);
    }
  }, []);

  /**
   * Load the next batch of items from Firestore, appending to the list
   */
  const loadMore = useCallback(async () => {
    if (isFetchingMoreRef.current) return;
    const cursor = lastDocRef.current;
    if (!cursor) return;

    const currentAuthUser = auth.currentUser || window.authState?.currentUser;
    const currentUserId = currentAuthUser?.uid;
    if (!currentUserId) return;

    isFetchingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const {
        assets,
        lastDoc,
        hasMore: nextHasMore
      } = await assetsService.getAssetsPage(currentUserId, {
        pageSize: ASSETS_FETCH_BATCH_SIZE,
        cursor
      });

      if (assets.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const appended = assets
            .map(assetToDisplayItem)
            .filter((item) => !seen.has(item.id));
          return [...prev, ...appended];
        });
      }
      if (lastDoc) lastDocRef.current = lastDoc;
      setHasMore(nextHasMore);
    } catch (error) {
      console.error('Failed to load more gallery items:', error);
    } finally {
      isFetchingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, []);

  /**
   * Initialize the gallery (V2 only)
   */
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      setItems([]);
      lastDocRef.current = null;
      setHasMore(false);
      return;
    }

    const initAssets = async () => {
      try {
        setIsLoading(true);
        await assetsService.init();
        await reloadItems();
      } catch (error) {
        console.error('Failed to initialize gallery:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initAssets();

    // Optimistic insert when a new asset is added
    const handleAssetAdded = (event) => {
      const currentUserId = userIdRef.current;
      const eventUserId = event.detail?.userId;

      if (!currentUserId) return;
      if (eventUserId !== currentUserId) return;

      if (event.detail?.asset) {
        const displayItem = assetToDisplayItem(event.detail.asset);
        setItems((prevItems) => {
          if (prevItems.some((item) => item.id === displayItem.id)) {
            return prevItems;
          }
          return [displayItem, ...prevItems];
        });
      }
    };

    // Fallback reload for when optimistic updates fail
    const handleAssetAddedReload = (event) => {
      const currentUserId = userIdRef.current;
      const eventUserId = event.detail?.userId;

      if (!currentUserId) return;
      if (eventUserId !== currentUserId) return;

      reloadItems();
    };

    // Keep the list in sync when an asset is renamed / metadata-edited
    // from outside the panel (e.g. the mesh details modal, or the
    // post-upload thumbnail capture writing thumbnailUrl).
    const handleAssetUpdated = (event) => {
      const currentUserId = userIdRef.current;
      const { assetId, userId: eventUserId, updates } = event.detail || {};
      if (
        !currentUserId ||
        eventUserId !== currentUserId ||
        !assetId ||
        !updates
      ) {
        return;
      }
      setItems((prevItems) =>
        prevItems.map((item) => {
          if (item.id !== assetId) return item;
          const patched = { ...item, ...updates };
          // objectURL is derived from thumbnailUrl with storageUrl fallback;
          // re-derive when either side changes so the grid swaps to the
          // newly-captured thumbnail without a refetch.
          if (
            updates.thumbnailUrl !== undefined ||
            updates.storageUrl !== undefined
          ) {
            patched.objectURL =
              patched.thumbnailUrl || patched.storageUrl || item.objectURL;
          }
          return patched;
        })
      );
    };

    // Drop the row when an asset is deleted (soft or hard) from anywhere.
    const handleAssetDeleted = (event) => {
      const currentUserId = userIdRef.current;
      const { assetId, userId: eventUserId } = event.detail || {};
      if (!currentUserId || eventUserId !== currentUserId || !assetId) return;
      setItems((prevItems) => prevItems.filter((item) => item.id !== assetId));
    };

    assetsService.events.addEventListener('assetAdded', handleAssetAdded);
    assetsService.events.addEventListener(
      'assetAddedReload',
      handleAssetAddedReload
    );
    assetsService.events.addEventListener('assetUpdated', handleAssetUpdated);
    assetsService.events.addEventListener('assetDeleted', handleAssetDeleted);

    return () => {
      assetsService.events.removeEventListener('assetAdded', handleAssetAdded);
      assetsService.events.removeEventListener(
        'assetAddedReload',
        handleAssetAddedReload
      );
      assetsService.events.removeEventListener(
        'assetUpdated',
        handleAssetUpdated
      );
      assetsService.events.removeEventListener(
        'assetDeleted',
        handleAssetDeleted
      );
    };
  }, [userId, reloadItems]);

  // Window event listener for gallery refresh (works even when userId is null)
  // Fallback for the generator where EventTarget events may not fire cross-island
  useEffect(() => {
    const handleWindowRefresh = () => {
      reloadItems();
    };
    window.addEventListener('assets:refresh', handleWindowRefresh);
    return () => {
      window.removeEventListener('assets:refresh', handleWindowRefresh);
    };
  }, [reloadItems]);

  /**
   * Add a new item to the gallery
   */
  const addItem = useCallback(
    async (imageDataUri, metadata, type = ASSET_CATEGORIES.AI_RENDER) => {
      const currentUserId =
        auth.currentUser?.uid || window.authState?.currentUser?.uid;
      if (!currentUserId) {
        throw new Error('User must be logged in to add items to gallery');
      }

      try {
        const assetType =
          type === ASSET_TYPES.VIDEO ? ASSET_TYPES.VIDEO : ASSET_TYPES.IMAGE;
        const category =
          type === ASSET_TYPES.VIDEO ? ASSET_CATEGORIES.AI_RENDER : type;

        const assetId = await assetsService.addAsset(
          imageDataUri,
          metadata,
          assetType,
          category,
          currentUserId
        );

        posthog.capture('gallery_asset_added', {
          asset_type: assetType,
          category: category
        });

        setPage(1);

        return assetId;
      } catch (error) {
        console.error('Failed to add item to gallery:', error);
        throw error;
      }
    },
    []
  );

  /**
   * Remove an item from the gallery (soft delete). The Firestore doc is
   * marked deleted: true; the Storage object stays. Quota is decremented
   * immediately by the onAssetWritten trigger.
   */
  const removeItem = useCallback(
    async (id) => {
      const currentUserId =
        auth.currentUser?.uid || window.authState?.currentUser?.uid;
      if (!currentUserId) {
        throw new Error('User must be logged in to remove items');
      }

      const snapshot = items;
      const snapshotPage = page;
      const updatedItems = items.filter((item) => item.id !== id);
      setItems(updatedItems);
      const newTotalPages = Math.max(
        1,
        Math.ceil(updatedItems.length / pageSize)
      );
      if (page > newTotalPages) {
        setPage(newTotalPages);
      }

      try {
        await assetsService.deleteAsset(id, currentUserId, false);
        return true;
      } catch (error) {
        console.error('Failed to remove item from gallery:', error);
        setItems(snapshot);
        setPage(snapshotPage);
        throw error;
      }
    },
    [items, page, pageSize]
  );

  /**
   * Download an item
   */
  const downloadItem = useCallback(async (item) => {
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
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Failed to download, opening in new tab:', error);
      window.open(imageUrl, '_blank');
    }
  }, []);

  /**
   * Change page size
   */
  const changePageSize = useCallback(
    (newSize) => {
      const firstIndex = (page - 1) * pageSize;
      setPageSize(newSize);
      const newPage = Math.floor(firstIndex / newSize) + 1;
      const maxPage = Math.max(1, Math.ceil(items.length / newSize));
      setPage(Math.min(newPage, maxPage));
    },
    [page, pageSize, items.length]
  );

  // Check auth state from multiple sources for isLoggedIn
  const isLoggedIn = !!(
    userId ||
    auth.currentUser?.uid ||
    window.authState?.currentUser?.uid
  );

  return {
    items,
    isLoading,
    isLoadingMore,
    isLoggedIn,
    hasMore,
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize: changePageSize,
    addItem,
    removeItem,
    downloadItem,
    reloadItems,
    loadMore
  };
};

export default useAssets;
