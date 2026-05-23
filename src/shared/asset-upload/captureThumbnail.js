/**
 * Client-side GLB thumbnail capture.
 *
 * Mirrors what @shopify/screenshot-glb does server-side: load the GLB into
 * <model-viewer> in an isolated browser context, wait for the model to
 * settle, then capture a JPEG from its WebGL canvas via toBlob().
 *
 * The "isolated browser context" is an off-screen iframe pointing at
 * /model-viewer-screenshot.html. Hosting it in its own document keeps
 * model-viewer's bundled THREE away from A-Frame's window.THREE.
 */

import { assetsService, STORAGE_PATHS } from '@shared/assets';

const SCREENSHOT_PAGE = '/model-viewer-screenshot.html';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SIZE = 512;

/**
 * @param {string} glbUrl - Public/tokenized URL the iframe can fetch.
 * @param {object} [opts]
 * @param {number} [opts.width=512]
 * @param {number} [opts.height=512]
 * @param {number} [opts.timeout=30000] - ms before rejecting.
 * @returns {Promise<Blob>} JPEG thumbnail blob.
 */
export function captureGlbThumbnail(
  glbUrl,
  {
    width = DEFAULT_SIZE,
    height = DEFAULT_SIZE,
    timeout = DEFAULT_TIMEOUT_MS
  } = {}
) {
  return new Promise((resolve, reject) => {
    if (!glbUrl) {
      reject(new Error('captureGlbThumbnail: missing glbUrl'));
      return;
    }

    const iframe = document.createElement('iframe');
    // Keep the iframe on-screen so the browser doesn't pause its render
    // loop (Chrome freezes iframes positioned outside the viewport, which
    // means model-viewer never produces a frame and `poster-dismissed`
    // never fires). Hide it via opacity instead of moving it off-screen.
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-1';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src =
      `${SCREENSHOT_PAGE}?src=${encodeURIComponent(glbUrl)}` +
      `&w=${width}&h=${height}`;

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    const onMessage = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === '3dstreet:screenshot-blob' && !settled) {
        settled = true;
        cleanup();
        resolve(data.blob);
      } else if (data.type === '3dstreet:screenshot-error' && !settled) {
        settled = true;
        cleanup();
        reject(new Error(data.error || 'screenshot failed'));
      }
    };

    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`thumbnail capture timeout (${timeout}ms)`));
      }
    }, timeout);

    document.body.appendChild(iframe);
  });
}

/**
 * Capture a thumbnail for an uploaded GLB asset, upload it to Storage at
 * `users/{ownerUid}/assets/meshes/{assetId}-thumb.jpg`, and write the
 * paths to the Firestore asset doc. The 'assetUpdated' event emitted by
 * updateAsset propagates the new thumbnailUrl to the gallery card and
 * the asset-upload cache automatically.
 *
 * Errors are swallowed (logged): the upload itself already succeeded,
 * missing thumbnail just means the gallery card keeps the placeholder.
 */
export async function captureAndUploadThumbnail(assetId, ownerUid, glbUrl) {
  try {
    const blob = await captureGlbThumbnail(glbUrl);
    const thumbnailPath = STORAGE_PATHS.assetFile(
      ownerUid,
      'meshes',
      `${assetId}-thumb.jpg`
    );
    const thumbnailUrl = await assetsService.uploadToStorage(
      blob,
      thumbnailPath
    );
    await assetsService.updateAsset(assetId, ownerUid, {
      thumbnailPath,
      thumbnailUrl
    });
  } catch (err) {
    console.warn('[asset-upload] thumbnail capture failed', err);
  }
}
