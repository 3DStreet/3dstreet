/**
 * useGallery Hook - React hook for managing gallery state
 */

import { useState, useEffect, useCallback } from 'react';
import galleryService from '../services/galleryService.js';

/**
 * Custom hook for gallery state management
 * @returns {Object} Gallery state and methods
 */
const useGallery = () => {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  /**
   * Reload items from database
   */
  const reloadItems = useCallback(async () => {
    try {
      const loadedItems = await galleryService.loadFromDB();
      setItems(loadedItems);
    } catch (error) {
      console.error('Failed to reload gallery items:', error);
    }
  }, []);

  /**
   * Initialize the gallery
   */
  useEffect(() => {
    const initGallery = async () => {
      try {
        setIsLoading(true);
        await galleryService.init();
        const loadedItems = await galleryService.loadFromDB();
        setItems(loadedItems);
      } catch (error) {
        console.error('Failed to initialize gallery:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initGallery();

    // Listen for external item additions (e.g., from vanilla JS)
    const handleItemAdded = () => {
      reloadItems();
    };

    galleryService.events.addEventListener('itemAdded', handleItemAdded);

    // Cleanup: remove event listener when component unmounts
    // Note: Object URL cleanup is handled by the service layer when items are removed
    return () => {
      galleryService.events.removeEventListener('itemAdded', handleItemAdded);
    };
  }, [reloadItems]);

  /**
   * Add a new item to the gallery
   * @param {string} imageDataUri - Data URI of the image
   * @param {object} metadata - Image metadata
   * @param {string} type - Image type ('screenshot' | 'ai-render')
   * @returns {Promise<string>} - Returns the new item ID
   */
  const addItem = useCallback(
    async (imageDataUri, metadata, type = 'ai-render') => {
      try {
        const itemId = await galleryService.addImage(
          imageDataUri,
          metadata,
          type
        );

        // Reload items from DB to get the new item with object URL
        const loadedItems = await galleryService.loadFromDB();
        setItems(loadedItems);

        // Enforce max images limit
        await galleryService.enforceMaxImagesLimit(loadedItems);

        // Jump to first page to show the new item
        setPage(1);

        return itemId;
      } catch (error) {
        console.error('Failed to add item to gallery:', error);
        throw error;
      }
    },
    []
  );

  /**
   * Remove an item from the gallery
   * @param {string} id - Item ID to remove
   * @returns {Promise<boolean>}
   */
  const removeItem = useCallback(
    async (id) => {
      try {
        // Find and revoke object URL
        const itemToRemove = items.find((item) => item.id === id);
        if (itemToRemove?.objectURL) {
          URL.revokeObjectURL(itemToRemove.objectURL);
        }

        await galleryService.removeImage(id);

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
   * Clear all items from the gallery
   * @returns {Promise<void>}
   */
  const clearGallery = useCallback(async () => {
    try {
      // Revoke all object URLs
      items.forEach((item) => {
        if (item.objectURL) {
          URL.revokeObjectURL(item.objectURL);
        }
      });

      await galleryService.clearGallery();
      setItems([]);
      setPage(1);
    } catch (error) {
      console.error('Failed to clear gallery:', error);
      throw error;
    }
  }, [items]);

  /**
   * Download an item
   * @param {object} item - Gallery item to download
   */
  const downloadItem = useCallback((item) => {
    const link = document.createElement('a');
    link.href = item.objectURL;

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
    downloadItem
  };
};

export default useGallery;
