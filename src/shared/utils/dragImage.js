/**
 * Suppress the browser's default drag ghost image for HTML5 drag-and-drop.
 *
 * We drag cards (Add Layer panel, Assets panel) into the 3D viewport and want a
 * 3D preview entity to follow the cursor instead of a floating card thumbnail.
 * The usual trick is `e.dataTransfer.setDragImage(transparentImg, 0, 0)`.
 *
 * The catch: WebKit/Safari only honors setDragImage() when the passed element
 * is actually rendered in the document. A detached `new Image()` (never
 * appended to the DOM) is silently ignored, and Safari then falls back to
 * dragging a ghost of the source card — which reads as "dragging an image out
 * of the page" and breaks the intended drop-to-place UX (see issue #1527).
 * Hiding the element with `display:none`/`visibility:hidden` also disqualifies
 * it, so we keep it rendered but invisible off-screen with `opacity:0`.
 */

// 1×1 transparent gif.
const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

let sharedEmptyDragImage = null;

/**
 * Returns a shared, DOM-attached transparent image suitable for passing to
 * `DataTransfer.setDragImage()` on all browsers including Safari. Lazily
 * created and appended off-screen on first use.
 *
 * @returns {HTMLImageElement}
 */
export function getEmptyDragImage() {
  if (sharedEmptyDragImage) return sharedEmptyDragImage;

  const img = new Image(1, 1);
  img.src = TRANSPARENT_GIF;
  img.setAttribute('aria-hidden', 'true');
  // Keep it genuinely rendered (Safari ignores display:none / visibility:hidden
  // / opacity:0 drag images) but harmless: it's a 1×1 fully-transparent pixel
  // pinned to the corner, so there's nothing to see and nothing to click.
  Object.assign(img.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    pointerEvents: 'none'
  });

  if (typeof document !== 'undefined') {
    const attach = () => {
      if (!img.isConnected && document.body) {
        document.body.appendChild(img);
      }
    };
    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    }
  }

  sharedEmptyDragImage = img;
  return img;
}
