/* global AFRAME */

/**
 * Render one frame of the A-Frame scene, composite a watermark + logo
 * onto an offscreen 2D canvas, and either download the result or write
 * it into a target <img>.
 *
 * Replaces the legacy `screentock` A-Frame component, which existed
 * only so React could trigger a function via `setAttribute()`. It has
 * no entity-lifecycle state, so it lives here as a plain module.
 *
 * @param {Object} opts
 * @param {string} opts.type - 'png' | 'jpg' | 'img'
 * @param {string} [opts.filename='screenshot'] - used by png/jpg downloads
 * @param {HTMLImageElement} [opts.imgElement] - required for type === 'img'
 * @param {boolean} [opts.showLogo=true]
 * @param {boolean} [opts.showCommunityWatermark=true]
 * @returns {Promise<void>} resolves once the image has been written /
 *   download has been triggered. For 'img', resolves after the target
 *   <img> fires its `load` event.
 */
export function takeScreenshot(opts) {
  const {
    type,
    filename = 'screenshot',
    imgElement,
    showLogo = true,
    showCommunityWatermark = true
  } = opts || {};

  return new Promise((resolve, reject) => {
    try {
      const scene = AFRAME.scenes[0];
      const renderer = scene && scene.renderer;
      if (!renderer) {
        reject(new Error('takeScreenshot: no A-Frame renderer available'));
        return;
      }
      const inspector = AFRAME.INSPECTOR;
      const helpersVisible = inspector?.opened
        ? inspector.sceneHelpers.visible
        : null;

      // Hide editor gizmos / helpers so they don't appear in the output.
      if (inspector?.opened) inspector.sceneHelpers.visible = false;

      renderer.render(scene.object3D, scene.camera);

      const aframeCanvas = renderer.domElement;
      const out =
        document.querySelector('#screenshotCanvas') ||
        (() => {
          const c = document.createElement('canvas');
          c.id = 'screenshotCanvas';
          c.hidden = true;
          document.body.appendChild(c);
          return c;
        })();
      out.width = aframeCanvas.width;
      out.height = aframeCanvas.height;
      const ctx = out.getContext('2d');
      ctx.drawImage(aframeCanvas, 0, 0);

      if (showCommunityWatermark) {
        drawCommunityWatermark(ctx, out.width, out.height);
      }
      if (showLogo) {
        drawLogo(ctx);
      }

      // Restore editor helpers before the awaitable async step kicks in.
      if (inspector?.opened) inspector.sceneHelpers.visible = helpersVisible;

      if (type === 'img') {
        if (!imgElement) {
          reject(new Error('takeScreenshot: type=img requires imgElement'));
          return;
        }
        const onLoad = () => {
          imgElement.removeEventListener('load', onLoad);
          resolve();
        };
        imgElement.addEventListener('load', onLoad, { once: true });
        imgElement.src = out.toDataURL();
      } else if (type === 'png') {
        downloadDataUrl(`${filename}.png`, out.toDataURL('image/png'));
        resolve();
      } else if (type === 'jpg') {
        downloadDataUrl(`${filename}.jpg`, out.toDataURL('image/jpeg', 0.95));
        resolve();
      } else {
        reject(new Error(`takeScreenshot: unknown type "${type}"`));
      }
    } catch (err) {
      reject(err);
    }
  });
}

function drawCommunityWatermark(ctx, w, h) {
  const fontSize = 50;
  ctx.font = `${fontSize}px Helvetica`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ea9eff';
  ctx.fillText('Made with 3DStreet Free Community Edition', w / 2, h - 43);
}

function drawLogo(ctx) {
  const logo = document.querySelector('#screenshot-img');
  if (!logo) return;
  ctx.drawImage(logo, 0, 0, 135, 43, 40, 30, 270, 86);
}

function downloadDataUrl(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl.replace(
    /^data:image\/[^;]/,
    'data:application/octet-stream'
  );
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
