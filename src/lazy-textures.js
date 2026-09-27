/* global AFRAME, THREE */

// Lazy <a-assets> textures (#2009).
//
// <street-assets> used to inject every texture as <img src="...">, so a cold
// load downloaded ~6.6 MB of textures before the page's `load` event — most of
// them for surfaces the scene never uses. The injected images now carry
// `data-src` instead of `src`: nothing downloads until a material actually
// references the asset (`material="src: #seamless-road"` and friends keep
// working unchanged, including in saved scene JSON and legacy mixins).
//
// A-Frame's material system hands an <img> straight to three.js as a
// THREE.Source without waiting for it to load — <a-assets> used to guarantee
// the image was complete by blocking scene init on it. The hook installed by
// installLazyTextureSource() on the material system's prototype (before any
// scene initializes):
//   1. starts the download on first use (copies data-src → src), and
//   2. resolves the source only once the image has loaded, so three.js never
//      sees an incomplete image (it refuses to upload one and warns every
//      frame) and A-Frame's `materialtextureloaded` fires when the texture is
//      real. Until then the surface renders its flat base color.
// The material system's own sourceCache (keyed by element id) still dedupes
// across entities, so each texture downloads once per page. The hook also
// emits `texture-loading` / `texture-loaded` / `texture-error` on the scene
// element (detail: { id, src }) for the asset-load-status system.

/**
 * URL of an <a-assets> image whether it has started loading (`src`) or is
 * still lazy (`data-src`). Use this instead of `img.src` for asset images.
 * @param {Element|null} el
 * @returns {string|null}
 */
export function getAssetImageSrc(el) {
  if (!el || typeof el.getAttribute !== 'function') return null;
  return el.getAttribute('src') || el.getAttribute('data-src') || null;
}

/**
 * Start downloading a lazy asset image (no-op once it has a `src`).
 * @param {Element|null} el
 * @returns {Element|null} the same element, for chaining
 */
export function startAssetImageLoad(el) {
  if (!el || el.tagName !== 'IMG') return el;
  if (!el.getAttribute('src')) {
    const lazySrc = el.getAttribute('data-src');
    if (lazySrc) el.setAttribute('src', lazySrc);
  }
  return el;
}

/** True when the browser has finished decoding a non-broken image. */
export function isImageReady(el) {
  return !!el && el.complete === true && el.naturalWidth > 0;
}

/**
 * Resolve with the element once it has loaded; reject on a broken image.
 * @param {HTMLImageElement} el
 * @returns {Promise<HTMLImageElement>}
 */
export function waitForImage(el) {
  return new Promise((resolve, reject) => {
    if (isImageReady(el)) {
      resolve(el);
      return;
    }
    const src = el.getAttribute('src');
    if (el.complete && src) {
      // complete + no natural size: the fetch already failed.
      reject(new Error('Failed to load image: ' + src));
      return;
    }
    const cleanup = () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      resolve(el);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed to load image: ' + src));
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
  });
}

function notify(sceneEl, name, el) {
  if (!sceneEl || typeof sceneEl.emit !== 'function') return;
  sceneEl.emit(name, { id: el.id || null, src: el.getAttribute('src') }, false);
}

/**
 * Patch a material system class so `loadTextureSource(<img>)` starts lazy
 * images and waits for them to load. Idempotent. Exported with the class as a
 * parameter so it is unit-testable without A-Frame.
 * @param {Function} [MaterialSystem=AFRAME.systems.material]
 * @param {Function} [SourceCtor=THREE.Source]
 */
export function installLazyTextureSource(
  MaterialSystem = typeof AFRAME !== 'undefined'
    ? AFRAME.systems && AFRAME.systems.material
    : undefined,
  SourceCtor = typeof THREE !== 'undefined' ? THREE.Source : undefined
) {
  const proto = MaterialSystem && MaterialSystem.prototype;
  if (!proto || proto._lazyTexturesInstalled) return false;
  const original = proto.loadTextureSource;
  proto.loadTextureSource = function (src, cb) {
    if (!src || src.tagName !== 'IMG') {
      return original.call(this, src, cb);
    }
    startAssetImageLoad(src);
    if (isImageReady(src) || !src.getAttribute('src')) {
      // Already decoded (or nothing to load): A-Frame's own path is fine.
      return original.call(this, src, cb);
    }
    const hash = this.hash(src);
    const sourceCache = this.sourceCache;
    if (!sourceCache[hash]) {
      const sceneEl = this.el || this.sceneEl;
      notify(sceneEl, 'texture-loading', src);
      sourceCache[hash] = waitForImage(src).then(
        () => {
          notify(sceneEl, 'texture-loaded', src);
          return new SourceCtor(src);
        },
        (err) => {
          // Do not poison the cache: the next material referencing this
          // image gets a fresh attempt (and fresh tracker events).
          delete sourceCache[hash];
          notify(sceneEl, 'texture-error', src);
          throw err;
        }
      );
    }
    sourceCache[hash].then(cb, function () {
      cb(null);
    });
  };
  proto._lazyTexturesInstalled = true;
  return true;
}

/**
 * Placeholder color of a lazy asset image while it downloads: a CSS hex from
 * its `data-placeholder`, or null when it has none or is a cutout
 * (`transparent`).
 * @param {Element|null} el
 * @returns {string|null}
 */
export function getAssetPlaceholderColor(el) {
  const value = el && el.getAttribute && el.getAttribute('data-placeholder');
  if (!value || value === 'transparent') return null;
  return value;
}

// --- Material placeholders -------------------------------------------------
//
// A surface whose texture is still downloading otherwise renders its bare
// material color — bright white for an asphalt lane — which reads as broken.
// While a material's `src` is a lazy image with a `data-placeholder`, the
// material is tinted with that average color (times its own color), or hidden
// when the placeholder is `transparent` (stencil / striping cutouts would
// render as solid quads). A-Frame emits `materialtextureloaded` on the entity
// once the real map lands; the placeholder is undone right then, which is
// also before batch-models clones the material (it waits on the same event).
// The tint is applied straight to the THREE material, never through
// setAttribute, so nothing about it is serialized.

function restorePlaceholder(component) {
  const { material, data } = component;
  if (!material) return;
  material.visible = data.visible !== false;
  if (material.color && data.color) material.color.set(data.color);
}

function paintPlaceholder(component, placeholder, ColorCtor) {
  const { material, data } = component;
  if (!material) return;
  if (placeholder === 'transparent') {
    material.visible = false;
    return;
  }
  if (!material.color) return;
  material.color.set(placeholder);
  if (data.color && ColorCtor) {
    material.color.multiply(new ColorCtor(data.color));
  }
}

/** Drop the placeholder listeners without touching the material. */
export function clearLazyPlaceholder(component) {
  const state = component._lazyPlaceholder;
  if (!state) return;
  component.el.removeEventListener('materialtextureloaded', state.onLoaded);
  component._lazyPlaceholder = null;
}

/**
 * Apply (or re-apply, after the component's own update reset the material)
 * the placeholder for a material component whose `src` is a pending lazy
 * image. No-op for ready images and non-asset sources.
 * @param {object} component A-Frame material component (el, data, material)
 * @param {Function} [ColorCtor=THREE.Color]
 */
export function applyLazyPlaceholder(
  component,
  ColorCtor = typeof THREE !== 'undefined' ? THREE.Color : undefined
) {
  const src = component.data && component.data.src;
  const img = src && src.tagName === 'IMG' ? src : null;
  const placeholder = img && img.getAttribute('data-placeholder');
  if (!img || !placeholder || isImageReady(img)) {
    clearLazyPlaceholder(component);
    return false;
  }
  const state = component._lazyPlaceholder;
  if (!state || state.img !== img) {
    clearLazyPlaceholder(component);
    const el = component.el;
    const next = { img, onLoaded: null };
    next.onLoaded = (event) => {
      if (event.target !== el) return;
      // A-Frame emits this for every map; only the placeholder's own image
      // landing ends the tint (a normal map arriving first must not).
      if (!isImageReady(img)) return;
      clearLazyPlaceholder(component);
      restorePlaceholder(component);
    };
    el.addEventListener('materialtextureloaded', next.onLoaded);
    component._lazyPlaceholder = next;
    // A broken image never yields materialtextureloaded. Watch the image
    // itself (not the scene's once-per-URL texture-error, which a later
    // material sharing an already-failed image never sees) and keep the
    // placeholder: a tint or nothing beats a bare white quad.
    waitForImage(img).then(null, () => {
      if (component._lazyPlaceholder === next) clearLazyPlaceholder(component);
    });
  }
  paintPlaceholder(component, placeholder, ColorCtor);
  return true;
}

/**
 * Patch A-Frame's material component so every update applies the pending
 * placeholder after A-Frame has written the authored color/visibility, and
 * removal drops the listeners. Idempotent; parameterized for tests.
 * @param {Function} [MaterialComponent=AFRAME.components.material.Component]
 */
export function installMaterialPlaceholders(
  MaterialComponent = typeof AFRAME !== 'undefined'
    ? AFRAME.components &&
      AFRAME.components.material &&
      AFRAME.components.material.Component
    : undefined
) {
  const proto = MaterialComponent && MaterialComponent.prototype;
  if (!proto || proto._lazyPlaceholdersInstalled) return false;
  const originalUpdate = proto.update;
  const originalRemove = proto.remove;
  proto.update = function (oldData) {
    originalUpdate.call(this, oldData);
    applyLazyPlaceholder(this);
  };
  proto.remove = function () {
    clearLazyPlaceholder(this);
    return originalRemove.call(this);
  };
  proto._lazyPlaceholdersInstalled = true;
  return true;
}

if (typeof AFRAME !== 'undefined') {
  installLazyTextureSource();
  installMaterialPlaceholders();
}
