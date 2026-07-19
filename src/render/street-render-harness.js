/* global AFRAME, THREE */
import useStore from '../store.js';

/**
 * street-render-harness — scene component for the headless render page
 * (render.html). Turns a managed-street JSON blob into a framed "beauty
 * shot": a 45°-offset pseudo-orthographic view (real perspective camera
 * with a narrow FOV, fit to the street's bounding box) with the
 * street-label cross-section bar visible at the street's near end.
 *
 * Driven by the renderStreet Cloud Function through puppeteer, but also
 * usable directly in a browser for debugging. Payload sources, first
 * match wins:
 *
 *   1. window.__STREET_RENDER_PAYLOAD__  (set via evaluateOnNewDocument)
 *   2. location hash  #managed-street-json:<uri-encoded JSON>
 *      (same scheme the main app's set-loader-from-hash understands)
 *   3. query param    ?data=<base64url of JSON>
 *
 * The payload is either a bare managed-street object ({name, length,
 * segments: [...]}) or { street: {...}, options: {...} }.
 *
 * Contract with the driver:
 *   window.__STREET_RENDER__ = {
 *     status: 'idle' | 'loading' | 'ready' | 'error',
 *     error:  string | null,
 *     meta:   { name, width, length, segments, timedOut },
 *     start(payload),          // manual start when status === 'idle'
 *     capture({type, quality}) // returns dataURL of the current frame
 *   }
 * Readiness is model-load quiescence, not a fixed delay: all street
 * segments loaded AND no model/texture activity for `quietMs`, capped at
 * `maxWaitMs` so a single stuck asset can't wedge the endpoint.
 */

const DEFAULT_OPTIONS = {
  // camera
  fov: 20, // narrow FOV ≈ pseudo-ortho
  azimuth: 45, // degrees around Y, 0 = looking down -Z (street axis)
  elevation: 30, // degrees above the horizon
  margin: 1.12, // extra space around the fitted street
  // scene
  environment: 'day', // street-environment preset
  labels: true,
  vehicles: true,
  ground: true,
  boundaries: true,
  units: null, // 'metric' | 'imperial' (null = store default)
  // readiness
  quietMs: 1500,
  maxWaitMs: 40000,
  // capture annotations
  title: null, // defaults to street name
  branding: true
};

AFRAME.registerComponent('street-render-harness', {
  init: function () {
    this.streetEl = null;
    this.options = { ...DEFAULT_OPTIONS };
    this.lastActivity = Date.now();
    this.startTime = null;
    this.timedOut = false;

    this.onAssetActivity = this.onAssetActivity.bind(this);
    // model-loaded / materialtextureloaded bubble up from every entity the
    // generated components spawn — treat any of them as "still loading".
    this.el.addEventListener('model-loaded', this.onAssetActivity);
    this.el.addEventListener('materialtextureloaded', this.onAssetActivity);
    this.el.addEventListener('object3dset', this.onAssetActivity);

    // Event quiescence alone is not enough: a multi-megabyte GLB fetch emits
    // nothing until it completes, so the scene looks "quiet" while models are
    // still in flight. Every three.js loader A-Frame uses (GLTF, textures,
    // a-asset-items, draco) funnels through THREE.DefaultLoadingManager —
    // busy between onStart and onLoad means loads are pending.
    this.loaderBusy = false;
    const manager = THREE.DefaultLoadingManager;
    const prev = {
      onStart: manager.onStart,
      onProgress: manager.onProgress,
      onLoad: manager.onLoad,
      onError: manager.onError
    };
    manager.onStart = (...args) => {
      this.loaderBusy = true;
      this.onAssetActivity();
      if (prev.onStart) prev.onStart(...args);
    };
    manager.onProgress = (...args) => {
      this.onAssetActivity();
      if (prev.onProgress) prev.onProgress(...args);
    };
    manager.onLoad = (...args) => {
      this.loaderBusy = false;
      this.onAssetActivity();
      if (prev.onLoad) prev.onLoad(...args);
    };
    manager.onError = (url) => {
      console.warn('[street-render-harness] asset failed:', url);
      this.onAssetActivity();
      if (prev.onError) prev.onError(url);
    };

    const api = {
      status: 'idle',
      error: null,
      meta: null,
      start: (payload) => this.start(payload),
      capture: (opts) => this.capture(opts)
    };
    window.__STREET_RENDER__ = api;

    const payload = readPayload();
    if (payload) {
      // Defer one tick so the scene and a-assets finish attaching first.
      setTimeout(() => this.start(payload), 0);
    }
  },

  onAssetActivity: function () {
    this.lastActivity = Date.now();
  },

  start: function (payload) {
    const api = window.__STREET_RENDER__;
    if (api.status === 'loading' || api.status === 'ready') {
      console.warn('[street-render-harness] already started, ignoring');
      return;
    }
    try {
      const street = payload.street || payload;
      if (
        !street ||
        !Array.isArray(street.segments) ||
        !street.segments.length
      ) {
        throw new Error(
          'payload must be a managed-street JSON with a segments array'
        );
      }
      this.options = { ...DEFAULT_OPTIONS, ...(payload.options || {}) };
      this.street = street;
      api.status = 'loading';

      if (this.options.units) {
        useStore.setState({ unitsPreference: this.options.units });
      }

      const envEl = document.querySelector('#environment');
      if (envEl) {
        envEl.setAttribute('street-environment', {
          preset: this.options.environment
        });
      }

      const streetEl = document.createElement('a-entity');
      streetEl.setAttribute('id', 'render-street');
      // Object-form setAttribute keeps the JSON string out of the style
      // parser (';' and ':' inside sourceValue would break string parsing).
      // synchronize:true is what makes managed-street parse the blob.
      streetEl.setAttribute('managed-street', {
        sourceType: 'json-blob',
        sourceValue: JSON.stringify(street),
        synchronize: true,
        showVehicles: this.options.vehicles !== false,
        showGround: this.options.ground !== false,
        showBoundaries: this.options.boundaries !== false
      });
      streetEl.setAttribute('street-align', 'width: center; length: start');
      this.el.appendChild(streetEl);
      this.streetEl = streetEl;

      streetEl.addEventListener(
        'loaded',
        () => {
          if (this.options.labels === false) {
            // managed-street auto-attaches street-label in init; disable it.
            streetEl.setAttribute('street-label', 'enabled', false);
          } else {
            // Push the label bar out from the street's start face so the
            // ground slab doesn't clip it at the 45° camera angle.
            streetEl.setAttribute('street-label', 'zOffset', 4);
          }
        },
        { once: true }
      );

      this.startTime = Date.now();
      this.lastActivity = Date.now();
      this.pollInterval = setInterval(() => this.checkReady(), 300);
    } catch (err) {
      console.error('[street-render-harness]', err);
      api.status = 'error';
      api.error = String(err && err.message ? err.message : err);
    }
  },

  checkReady: function () {
    const now = Date.now();
    const elapsed = now - this.startTime;
    const quiet = now - this.lastActivity;
    const segmentEls = this.streetEl.querySelectorAll('[street-segment]');
    const allLoaded =
      segmentEls.length >= this.street.segments.length &&
      Array.from(segmentEls).every((el) => el.hasLoaded);

    // minimum settle time gives generated clones a chance to spawn before
    // the quiet window can possibly elapse
    const settled =
      allLoaded &&
      !this.loaderBusy &&
      elapsed > 2500 &&
      quiet >= this.options.quietMs;
    const overTime = elapsed >= this.options.maxWaitMs;

    if (!settled && !overTime) return;

    clearInterval(this.pollInterval);
    this.timedOut = overTime && !settled;
    if (this.timedOut) {
      console.warn(
        '[street-render-harness] maxWaitMs reached, capturing anyway'
      );
    }

    this.frameCamera();

    // let the freshly framed camera render a couple of frames (texture
    // uploads happen on first render) before declaring ready
    let frames = 0;
    const scene = this.el;
    const onFrame = () => {
      if (++frames < 3) {
        requestAnimationFrame(onFrame);
        return;
      }
      const api = window.__STREET_RENDER__;
      api.meta = {
        name: this.street.name || 'Untitled Street',
        length: this.streetEl.getAttribute('managed-street').length,
        width: this.streetEl.components['managed-street'].actualWidth,
        segments: this.street.segments.length,
        timedOut: this.timedOut
      };
      api.status = 'ready';
      // secondary signal for waitFor drivers that poll the title
      document.title = '3dstreet-render:ready';
      scene.emit('street-render-ready', api.meta);
    };
    requestAnimationFrame(onFrame);
  },

  /**
   * Position the perspective camera at (azimuth, elevation) from the
   * street's center and pull back until every corner of the street's
   * bounding box (labels included — they're children of the street
   * entity) fits inside both the vertical and horizontal FOV.
   */
  frameCamera: function () {
    const opts = this.options;
    const camEl = document.querySelector('#renderCamera');
    const canvas = this.el.renderer.domElement;
    const aspect = canvas.width / canvas.height || 16 / 9;

    this.streetEl.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.streetEl.object3D);
    if (box.isEmpty()) {
      console.warn('[street-render-harness] empty bounding box');
      box.setFromCenterAndSize(
        new THREE.Vector3(0, 0, -30),
        new THREE.Vector3(20, 5, 60)
      );
    }
    const center = box.getCenter(new THREE.Vector3());

    const vFov = THREE.MathUtils.degToRad(opts.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    // Auto-pick the viewing side unless the caller set an explicit azimuth:
    // shoot from the side with the lower edge segment so a tall boundary
    // (brownstones etc.) backdrops the street instead of occluding it.
    // Segment DOM order runs left→right across +X, so the last segment sits
    // on the +X side — where a positive azimuth places the camera.
    let azimuthDeg = opts.azimuth;
    if (opts.azimuth === DEFAULT_OPTIONS.azimuth && opts.autoSide !== false) {
      const segEls = this.streetEl.querySelectorAll('[street-segment]');
      if (segEls.length >= 2) {
        const heightOf = (el) => {
          const b = new THREE.Box3().setFromObject(el.object3D);
          return b.isEmpty() ? 0 : b.max.y - b.min.y;
        };
        const leftH = heightOf(segEls[0]);
        const rightH = heightOf(segEls[segEls.length - 1]);
        if (rightH > leftH + 2) {
          azimuthDeg = -Math.abs(azimuthDeg);
        }
      }
    }
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const elev = THREE.MathUtils.degToRad(opts.elevation);

    // direction from street center toward the camera; +Z faces the street
    // start where street-label hangs its cross-section bar
    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      Math.cos(az) * Math.cos(elev)
    );

    // camera basis for the corner-fit: forward looks at the center
    const forward = dir.clone().negate();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);

    const corners = [];
    for (let xi = 0; xi < 2; xi++) {
      for (let yi = 0; yi < 2; yi++) {
        for (let zi = 0; zi < 2; zi++) {
          corners.push(
            new THREE.Vector3(
              xi ? box.max.x : box.min.x,
              yi ? box.max.y : box.min.y,
              zi ? box.max.z : box.min.z
            )
          );
        }
      }
    }

    const tanH = Math.tan(hFov / 2);
    const tanV = Math.tan(vFov / 2);
    let dist = 0;
    corners.forEach((corner) => {
      const o = corner.sub(center); // corner offset from center (mutates copy)
      const alongForward = o.dot(forward);
      const needed =
        alongForward +
        Math.max(Math.abs(o.dot(right)) / tanH, Math.abs(o.dot(up)) / tanV);
      dist = Math.max(dist, needed);
    });
    dist *= opts.margin;

    const camPos = center.clone().add(dir.clone().multiplyScalar(dist));
    camEl.setAttribute('camera', {
      fov: opts.fov,
      near: Math.max(0.1, dist / 100),
      far: dist * 20
    });
    camEl.object3D.position.copy(camPos);
    // The entity's object3D is a Group (the THREE camera is its child), so
    // Object3D.lookAt would face the group's +Z at the target — backwards
    // for the child camera, which looks down -Z. Matrix4.lookAt builds the
    // camera-convention orientation.
    camEl.object3D.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(camPos, center, new THREE.Vector3(0, 1, 0))
    );
  },

  /**
   * Render one frame and return it as a dataURL, with optional title and
   * branding annotations composited on a 2D canvas (same approach as the
   * screentock component — reading the WebGL canvas right after an
   * explicit render avoids needing preserveDrawingBuffer).
   */
  capture: function (captureOpts) {
    const { type = 'png', quality = 0.92 } = captureOpts || {};
    const sceneEl = this.el;
    sceneEl.renderer.render(sceneEl.object3D, sceneEl.camera);
    const glCanvas = sceneEl.renderer.domElement;

    const out = document.createElement('canvas');
    out.width = glCanvas.width;
    out.height = glCanvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(glCanvas, 0, 0);

    const scale = out.width / 1200; // annotation sizes tuned at 1200px wide
    const title =
      this.options.title !== null
        ? this.options.title
        : (this.street && this.street.name) || '';
    if (title) {
      ctx.font = `600 ${Math.round(28 * scale)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 6 * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(title, 24 * scale, 20 * scale);
      ctx.shadowBlur = 0;
    }
    if (this.options.branding !== false) {
      ctx.font = `${Math.round(16 * scale)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 4 * scale;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(
        'made with 3DStreet · 3dstreet.app',
        out.width - 20 * scale,
        out.height - 14 * scale
      );
      ctx.shadowBlur = 0;
    }

    return type === 'jpg' || type === 'jpeg'
      ? out.toDataURL('image/jpeg', quality)
      : out.toDataURL('image/png');
  },

  remove: function () {
    clearInterval(this.pollInterval);
    this.el.removeEventListener('model-loaded', this.onAssetActivity);
    this.el.removeEventListener('materialtextureloaded', this.onAssetActivity);
    this.el.removeEventListener('object3dset', this.onAssetActivity);
  }
});

function readPayload() {
  if (window.__STREET_RENDER_PAYLOAD__) {
    return window.__STREET_RENDER_PAYLOAD__;
  }
  const hash = window.location.hash || '';
  const hashPrefix = '#managed-street-json:';
  if (hash.startsWith(hashPrefix)) {
    try {
      return JSON.parse(decodeURIComponent(hash.substring(hashPrefix.length)));
    } catch (err) {
      console.error('[street-render-harness] bad hash payload:', err);
    }
  }
  const data = new URLSearchParams(window.location.search).get('data');
  if (data) {
    try {
      const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(window.atob(b64))));
    } catch (err) {
      console.error('[street-render-harness] bad ?data payload:', err);
    }
  }
  return null;
}
