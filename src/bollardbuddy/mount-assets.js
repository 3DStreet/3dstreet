/**
 * Mount Assets - Renders the shared <Assets> sidebar for Bollard Buddy.
 * Also saves AR screenshots to the cloud asset library when photos are captured.
 */

import { createRoot } from 'react-dom/client';
import { Assets, assetsService } from '@shared/assets';
import { signInWithGoogle } from '@shared/auth/api/auth';
import { auth } from '@shared/services/firebase';

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

    await assetsService.addAsset(
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

const handleSignIn = () =>
  signInWithGoogle(auth, undefined, (type, message) =>
    showNotification(message, type)
  );

/**
 * Mount the React Assets sidebar.
 */
export const mountAssets = async () => {
  const assetsRoot = document.createElement('div');
  assetsRoot.id = 'assets-root';
  document.body.appendChild(assetsRoot);

  // Mount the React component (uses window.authState from mount-auth.js)
  const root = createRoot(assetsRoot);
  root.render(
    <Assets
      mode="sidebar"
      onNotification={(message, type) => showNotification(message, type)}
      onSignIn={handleSignIn}
    />
  );

  // Listen for photo captures from xrextras and save to gallery
  window.addEventListener('mediarecorder-photocomplete', (event) => {
    const { blob } = event.detail;
    if (blob) {
      saveToGallery(blob);
    }
  });

  console.log('Assets sidebar mounted');
};

export { assetsService };
export default mountAssets;
