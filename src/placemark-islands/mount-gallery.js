/**
 * Mount Gallery - Renders React gallery component for Placemark
 * Exposes bridge API for save/load of GeoJSON files
 */

import { createRoot } from 'react-dom/client';
import { Gallery, galleryServiceV2 } from '@shared/gallery';
import { ASSET_TYPES, ASSET_CATEGORIES } from '@shared/gallery/constants';

// Use V2 (Firestore + Firebase Storage) exclusively
const galleryService = galleryServiceV2;

/**
 * Show a toast notification
 * @param {string} message - The message to show
 * @param {string} type - 'success', 'error', or 'warning'
 */
const showNotification = (message, type = 'success') => {
  // Create toast element
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: ${type === 'error' ? 'rgba(220, 38, 38, 0.9)' : type === 'warning' ? 'rgba(217, 119, 6, 0.9)' : 'rgba(22, 163, 74, 0.9)'};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    z-index: 2000;
    backdrop-filter: blur(10px);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  // Remove after delay
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

/**
 * Save GeoJSON to gallery
 * @param {object} geojsonData - The GeoJSON FeatureCollection
 * @param {string} title - Title/name for the file
 * @param {object} metadata - Additional metadata
 * @returns {Promise<string>} - Asset ID
 */
const saveToGallery = async (
  geojsonData,
  title = 'Untitled',
  metadata = {}
) => {
  const user = window.authState?.currentUser;

  if (!user) {
    showNotification('Please sign in to save to gallery', 'warning');
    throw new Error('User not signed in');
  }

  try {
    // Convert GeoJSON to Blob
    const jsonString = JSON.stringify(geojsonData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/geo+json' });

    const assetId = await galleryService.addAsset(
      blob,
      {
        title,
        source: 'placemark-play',
        featureCount: geojsonData.features?.length || 0,
        ...metadata
      },
      ASSET_TYPES.GEOJSON,
      ASSET_CATEGORIES.PLACEMARK,
      user.uid
    );

    showNotification('Saved to gallery!', 'success');
    console.log('GeoJSON saved to gallery:', assetId);
    return assetId;
  } catch (error) {
    console.error('Failed to save to gallery:', error);
    showNotification('Failed to save', 'error');
    throw error;
  }
};

/**
 * Load GeoJSON from storage URL
 * @param {string} storageUrl - Firebase Storage URL
 * @returns {Promise<object>} - Parsed GeoJSON object
 */
const loadGeoJSON = async (storageUrl) => {
  try {
    const response = await fetch(storageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to load GeoJSON:', error);
    throw error;
  }
};

// Gallery open state
let isGalleryOpen = false;
let galleryRoot = null;
let reactRoot = null;

/**
 * Open the gallery modal
 */
const openGallery = () => {
  isGalleryOpen = true;
  if (galleryRoot) {
    galleryRoot.style.display = 'block';
    // Trigger re-render to update open state
    renderGallery();
  }
};

/**
 * Close the gallery modal
 */
const closeGallery = () => {
  isGalleryOpen = false;
  if (galleryRoot) {
    galleryRoot.style.display = 'none';
  }
};

/**
 * Handle file selection from gallery
 * @param {object} asset - The selected asset
 */
const handleFileSelect = async (asset) => {
  try {
    // Load the GeoJSON data from storage
    const geojsonData = await loadGeoJSON(asset.storageUrl);

    // Get metadata
    const metadata = {
      assetId: asset.id, // Gallery items use 'id' not 'assetId'
      title: asset.generationMetadata?.title || asset.filename || 'Untitled',
      ...asset.generationMetadata
    };

    // Call the callback if set - Placemark handles success/error notifications
    if (window.placemarkGallery?.onFileSelected) {
      window.placemarkGallery.onFileSelected(geojsonData, metadata);
    }

    // Close gallery after selection
    closeGallery();
  } catch (error) {
    // This error is for fetching from storage, not import errors
    console.error('Failed to load file from storage:', error);
    showNotification('Failed to load file', 'error');
  }
};

/**
 * Render the gallery component
 */
const renderGallery = () => {
  if (!reactRoot || !galleryRoot) return;

  reactRoot.render(
    <Gallery
      mode="modal"
      isOpen={isGalleryOpen}
      onClose={closeGallery}
      filterType={ASSET_TYPES.GEOJSON}
      onNotification={(message, type) => showNotification(message, type)}
      onItemClick={handleFileSelect}
      // Disable generator-specific handlers
      onCopyParams={null}
      onUseForInpaint={null}
      onUseForOutpaint={null}
      onUseForGenerator={null}
      onUseForVideo={null}
    />
  );
};

/**
 * Mount the React gallery component and expose bridge API
 */
export const mountGallery = async () => {
  // Create a new mount point for the gallery
  galleryRoot = document.createElement('div');
  galleryRoot.id = 'gallery-root';
  galleryRoot.style.display = 'none';
  document.body.appendChild(galleryRoot);

  // Mount the React gallery component
  reactRoot = createRoot(galleryRoot);
  renderGallery();

  // Expose bridge API to window for Placemark to use
  window.placemarkGallery = {
    /**
     * Save GeoJSON data to the user's gallery
     * @param {object} geojsonData - GeoJSON FeatureCollection
     * @param {string} title - Title for the file
     * @param {object} metadata - Additional metadata
     * @returns {Promise<string>} - Asset ID
     */
    save: saveToGallery,

    /**
     * Open the gallery modal filtered to GeoJSON files
     */
    open: openGallery,

    /**
     * Close the gallery modal
     */
    close: closeGallery,

    /**
     * Callback that Placemark sets to receive selected file data
     * @type {function(geojsonData: object, metadata: object): void}
     */
    onFileSelected: null,

    /**
     * Check if user is signed in
     * @returns {boolean}
     */
    isSignedIn: () => !!window.authState?.currentUser
  };

  console.log('Gallery mounted with placemarkGallery bridge API');
};

export { galleryService };
export default mountGallery;
