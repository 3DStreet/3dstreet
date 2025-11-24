/**
 * Mount Gallery - Renders React gallery component
 */

import { createRoot } from 'react-dom/client';
import { Gallery, galleryServiceV2 } from '@shared/gallery';
import FluxUI from './main.js';
import ModifyTab from './modify.js';
import InpaintTab from './inpaint.js';
import OutpaintTab from './outpaint.js';
import VideoTab from './video.js';

// Use V2 (Firestore + Firebase Storage) exclusively
const galleryService = galleryServiceV2;

/**
 * Helper to get Data URI from Blob or URL
 * @param {Blob|string} blobOrUrl - The blob or URL to convert
 * @returns {Promise<string>}
 */
const getBlobDataUri = async (blobOrUrl) => {
  // If it's already a data URI or blob URL, fetch it first
  if (typeof blobOrUrl === 'string') {
    const response = await fetch(blobOrUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // If it's a Blob, convert directly
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blobOrUrl);
  });
};

/**
 * Copy gallery item parameters to clipboard
 * @param {object} item - Gallery item
 */
const handleCopyParams = (item) => {
  if (!item.metadata) {
    FluxUI.showNotification('No parameters available for this image', 'error');
    return;
  }
  const params = JSON.stringify(item.metadata, null, 2);
  navigator.clipboard
    .writeText(params)
    .then(() =>
      FluxUI.showNotification('Parameters copied to clipboard!', 'success')
    )
    .catch((err) =>
      FluxUI.showNotification(
        'Failed to copy parameters: ' + err.message,
        'error'
      )
    );
};

/**
 * Copy gallery image to clipboard
 * @param {object} item - Gallery item
 */
const handleCopyImage = async (item) => {
  const imageUrl = item.storageUrl || item.objectURL;

  if (!imageUrl) {
    FluxUI.showNotification('Image URL is not available for copying.', 'error');
    return;
  }

  try {
    // Fetch the image as a blob
    const response = await fetch(imageUrl);
    const blob = await response.blob();

    const clipboardItem = new ClipboardItem({
      [blob.type || 'image/png']: blob
    });

    await navigator.clipboard.write([clipboardItem]);
    FluxUI.showNotification('Image copied to clipboard!', 'success');
  } catch (error) {
    console.error('Clipboard API error:', error);
    FluxUI.showNotification(
      'Failed to copy image. Your browser might not support this feature or requires secure context (HTTPS).',
      'error'
    );
  }
};

/**
 * Use image for inpainting
 * @param {object} item - Gallery item
 */
const handleUseForInpaint = async (item) => {
  if (InpaintTab && typeof InpaintTab.setInputImage === 'function') {
    try {
      const imageUrl = item.storageUrl || item.objectURL;
      const dataUri = await getBlobDataUri(imageUrl);
      const inpaintTabButton = document.querySelector(
        '.tab-button[data-tab="inpaint-tab"]'
      );
      if (inpaintTabButton) inpaintTabButton.click();
      InpaintTab.setInputImage(dataUri);
      FluxUI.showNotification('Image sent to Inpaint tab!', 'success');
    } catch (error) {
      console.error('Error sending to Inpaint:', error);
      FluxUI.showNotification('Failed to prepare image for Inpaint.', 'error');
    }
  } else {
    FluxUI.showNotification('Inpaint tab is not ready yet', 'warning');
  }
};

/**
 * Use image for outpainting
 * @param {object} item - Gallery item
 */
const handleUseForOutpaint = async (item) => {
  if (OutpaintTab && typeof OutpaintTab.setInputImage === 'function') {
    try {
      const imageUrl = item.storageUrl || item.objectURL;
      const dataUri = await getBlobDataUri(imageUrl);
      const outpaintTabButton = document.querySelector(
        '.tab-button[data-tab="outpaint-tab"]'
      );
      if (outpaintTabButton) outpaintTabButton.click();
      OutpaintTab.setInputImage(dataUri);
      FluxUI.showNotification('Image sent to Outpaint tab!', 'success');
    } catch (error) {
      console.error('Error sending to Outpaint:', error);
      FluxUI.showNotification('Failed to prepare image for Outpaint.', 'error');
    }
  } else {
    FluxUI.showNotification('Outpaint tab is not ready yet', 'warning');
  }
};

/**
 * Use image for Modify tab
 * @param {object} item - Gallery item
 */
const handleUseForGenerator = async (item) => {
  if (ModifyTab && typeof ModifyTab.setImagePrompt === 'function') {
    try {
      const imageUrl = item.storageUrl || item.objectURL;
      const dataUri = await getBlobDataUri(imageUrl);
      const modifyTabButton = document.querySelector(
        '.tab-button[data-tab="modify-tab"]'
      );
      if (modifyTabButton) modifyTabButton.click();
      ModifyTab.setImagePrompt(dataUri, `Gallery Image ${item.id}`);
      FluxUI.showNotification('Image sent to Modify tab!', 'success');
    } catch (error) {
      console.error('Error sending to Modify:', error);
      FluxUI.showNotification('Failed to prepare image for Modify.', 'error');
    }
  } else {
    FluxUI.showNotification('Modify tab is not ready yet', 'warning');
  }
};

/**
 * Use image for Video tab
 * @param {object} item - Gallery item
 */
const handleUseForVideo = async (item) => {
  if (VideoTab && typeof VideoTab.setInputImage === 'function') {
    try {
      const imageUrl = item.storageUrl || item.objectURL;
      const dataUri = await getBlobDataUri(imageUrl);
      const videoTabButton = document.querySelector(
        '.tab-button[data-tab="video-tab"]'
      );
      if (videoTabButton) videoTabButton.click();
      VideoTab.setInputImage(dataUri, `Gallery Image ${item.id}`);
      FluxUI.showNotification('Image sent to Video tab!', 'success');
    } catch (error) {
      console.error('Error sending to Video:', error);
      FluxUI.showNotification('Failed to prepare image for Video.', 'error');
    }
  } else {
    FluxUI.showNotification('Video tab is not ready yet', 'warning');
  }
};

/**
 * Mount the React gallery component
 * This replaces the vanilla JS gallery implementation
 */
export const mountGallery = async () => {
  // Create a new mount point for the gallery
  const galleryRoot = document.createElement('div');
  galleryRoot.id = 'gallery-root';
  document.body.appendChild(galleryRoot);

  // Mount the React gallery component (uses window.authState from mount-auth.js)
  const root = createRoot(galleryRoot);
  root.render(
    <Gallery
      mode="sidebar"
      onCopyParams={handleCopyParams}
      onCopyImage={handleCopyImage}
      onUseForInpaint={handleUseForInpaint}
      onUseForOutpaint={handleUseForOutpaint}
      onUseForGenerator={handleUseForGenerator}
      onUseForVideo={handleUseForVideo}
      onNotification={(message, type) => FluxUI.showNotification(message, type)}
    />
  );
};

/**
 * Expose gallery service for saving images
 */
export { galleryService };

export default mountGallery;
