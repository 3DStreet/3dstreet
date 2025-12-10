/**
 * Mount Gallery - Renders React gallery component for Bollard Buddy
 * Saves AR screenshots to cloud gallery when photos are captured
 */

import { createRoot } from 'react-dom/client';
import { Gallery, galleryServiceV2 } from '@shared/gallery';

// Use V2 (Firestore + Firebase Storage) exclusively
const galleryService = galleryServiceV2;

/**
 * Convert Blob to data URI
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>}
 */
const blobToDataUri = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

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
 * Save captured photo to gallery
 * @param {Blob} blob - The image blob from xrextras capture
 */
const saveToGallery = async (blob) => {
  const user = window.authState?.currentUser;

  if (!user) {
    console.log('User not signed in, skipping gallery save');
    return;
  }

  try {
    const dataUri = await blobToDataUri(blob);

    await galleryService.addAsset(
      dataUri,
      {
        model: 'Bollard Buddy',
        source: 'bollard-buddy',
        capturedAt: new Date().toISOString()
      },
      'image',
      'screenshot', // Using screenshot category for AR captures
      user.uid
    );

    showNotification('Photo saved to gallery!', 'success');
    console.log('Photo saved to gallery');
  } catch (error) {
    console.error('Failed to save to gallery:', error);
    showNotification('Failed to save photo', 'error');
  }
};

/**
 * Mount the React gallery component
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
      onNotification={(message, type) => showNotification(message, type)}
      // No generator-specific handlers needed for Bollard Buddy
      onCopyParams={null}
      onUseForInpaint={null}
      onUseForOutpaint={null}
      onUseForGenerator={null}
      onUseForVideo={null}
    />
  );

  // Listen for photo captures from xrextras and save to gallery
  window.addEventListener('mediarecorder-photocomplete', (event) => {
    const { blob } = event.detail;
    if (blob) {
      saveToGallery(blob);
    }
  });

  console.log('Gallery mounted');
};

export { galleryService };
export default mountGallery;
