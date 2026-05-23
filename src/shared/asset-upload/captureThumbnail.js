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
 *
 * The parent postMessages the GLB Blob (the bytes already in memory from
 * the upload) to the iframe, which creates its own blob URL and feeds it
 * to model-viewer. No network round-trip — the editor and generator flows
 * used to ask the iframe to re-download the cloud URL (10s of MB of
 * needless bandwidth) just to render one frame.
 */

import { assetsService, STORAGE_PATHS } from '@shared/assets';

const SCREENSHOT_PAGE = '/model-viewer-screenshot.html';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SIZE = 512;
const READY_TIMEOUT_MS = 5000;

/**
 * @param {Blob} glbBlob - GLB bytes in memory (original or optimized).
 * @param {object} [opts]
 * @param {number} [opts.width=512]
 * @param {number} [opts.height=512]
 * @param {number} [opts.timeout=30000] - ms before rejecting.
 * @returns {Promise<Blob>} JPEG thumbnail blob.
 */
export function captureGlbThumbnail(
  glbBlob,
  {
    width = DEFAULT_SIZE,
    height = DEFAULT_SIZE,
    timeout = DEFAULT_TIMEOUT_MS
  } = {}
) {
  return new Promise((resolve, reject) => {
    if (!(glbBlob instanceof Blob)) {
      reject(new Error('captureGlbThumbnail: expected Blob'));
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
    iframe.src = `${SCREENSHOT_PAGE}?w=${width}&h=${height}`;

    let settled = false;
    let blobPosted = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      clearTimeout(readyTimer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    const onMessage = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === '3dstreet:screenshot-ready') {
        // Iframe is wired up and listening — hand it the bytes.
        if (!blobPosted) {
          blobPosted = true;
          clearTimeout(readyTimer);
          iframe.contentWindow.postMessage(
            { type: '3dstreet:load-blob', blob: glbBlob },
            '*'
          );
        }
      } else if (data.type === '3dstreet:screenshot-blob' && !settled) {
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
    // If the iframe never announces readiness (script load failure, CSP
    // block) we'd otherwise wait the full capture timeout for nothing.
    const readyTimer = setTimeout(() => {
      if (!blobPosted && !settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            `thumbnail iframe never became ready (${READY_TIMEOUT_MS}ms)`
          )
        );
      }
    }, READY_TIMEOUT_MS);

    document.body.appendChild(iframe);
  });
}

/**
 * Upload an already-captured thumbnail blob to Storage at
 * `users/{ownerUid}/assets/meshes/{assetId}-thumb.jpg`, and write the
 * paths to the Firestore asset doc. The 'assetUpdated' event emitted by
 * updateAsset propagates the new thumbnailUrl to the gallery card and
 * the asset-upload cache automatically.
 *
 * Errors are swallowed (logged): the upload itself already succeeded,
 * missing thumbnail just means the gallery card keeps the placeholder.
 */
export async function uploadCapturedThumbnail(assetId, ownerUid, jpegBlob) {
  try {
    const thumbnailPath = STORAGE_PATHS.assetFile(
      ownerUid,
      'meshes',
      `${assetId}-thumb.jpg`
    );
    const thumbnailUrl = await assetsService.uploadToStorage(
      jpegBlob,
      thumbnailPath
    );
    await assetsService.updateAsset(assetId, ownerUid, {
      thumbnailPath,
      thumbnailUrl
    });
  } catch (err) {
    console.warn('[asset-upload] thumbnail upload failed', err);
  }
}
