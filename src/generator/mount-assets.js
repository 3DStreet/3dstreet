/**
 * Mount Assets - Renders the shared <Assets> sidebar into the generator.
 */

import { createRoot } from 'react-dom/client';
import { Assets, assetsService } from '@shared/assets';
import { signInWithGoogle } from '@shared/auth/api/auth';
import { auth } from '@shared/services/firebase';
import posthog from 'posthog-js';
import FluxUI from './main.js';
import ModifyTab from './modify.js';
import ImageTab from './image-tab.js';
import VideoTab from './video.js';

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
 * Use image for Modify tab
 * @param {object} item - Gallery item
 */
const handleUseForGenerator = async (item) => {
  if (ModifyTab && typeof ModifyTab.setImagePrompt === 'function') {
    try {
      const imageUrl = item.storageUrl || item.objectURL;
      const dataUri = await getBlobDataUri(imageUrl);
      // Modify now lives inside the Image tab as a mode: activate the Image
      // tab, then switch it to Modify before setting the source image.
      const imageTabButton = document.querySelector(
        '.tab-button[data-tab="image-tab"]'
      );
      if (imageTabButton) imageTabButton.click();
      ImageTab.setMode('modify');
      ModifyTab.setImagePrompt(dataUri, `Gallery Image ${item.id}`);
      FluxUI.showNotification('Image sent to Modify!', 'success');
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

const handleSignIn = () =>
  signInWithGoogle(
    auth,
    (eventName, properties) => posthog.capture(eventName, properties),
    (type, message) => FluxUI.showNotification(message, type)
  );

/**
 * Mount the React Assets sidebar (replaces the vanilla JS gallery).
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
      onUseForGenerator={handleUseForGenerator}
      onUseForVideo={handleUseForVideo}
      onNotification={(message, type) => FluxUI.showNotification(message, type)}
      onSignIn={handleSignIn}
    />
  );
};

// Re-export so vanilla JS callers can still import via this module.
export { assetsService };

export default mountAssets;
