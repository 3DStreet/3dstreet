/* global AFRAME, THREE */
import { createSkyPlaceholderTexture } from '../sky-placeholder.js';
import {
  pickShadowStep,
  shadowFocus,
  shadowSettings,
  snapToShadowTexels
} from '../tested/shadow-follow.js';

const SHADOW_OFF_EXTENT = 0.01;

// Moves the sun's shadow box to wherever the active camera looks (#439):
// the light and its target shift together by a texel-snapped offset, so the
// sun direction never changes. The box grows with camera height in steps and
// switches off high up (shadow-follow.js). A system rather than a component
// tick because the editor pauses entities but keeps systems ticking;
// `sceneEl.camera` is the editor camera in edit/view and the rig camera in
// drive and WebXR.
AFRAME.registerSystem('street-environment', {
  init: function () {
    this.env = null;
    this.camPos = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.snapped = new THREE.Vector3();
    this.sun = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.lastSnapped = new THREE.Vector3(NaN, NaN, NaN);
    this.lastSun = new THREE.Vector3(NaN, NaN, NaN);
    this.step = 0;
  },

  tick: function () {
    const env = this.env;
    const camera = this.el.camera;
    if (!env || !camera) return;
    const lightEl = env.light2;
    const light = lightEl.getObject3D('light');
    if (!light || !light.castShadow || !light.target) return;

    // Where the light sits inside its entity with no follow offset. Re-read
    // if A-Frame rebuilt the light.
    if (env.followLight !== light) {
      env.followLight = light;
      env.restLocal.copy(light.position);
      this.lastSnapped.set(NaN, NaN, NaN);
    }

    const e = camera.matrixWorld.elements;
    this.camPos.set(e[12], e[13], e[14]);
    const steps = env.shadow.steps;
    const index = pickShadowStep(this.camPos.y, this.step, steps);
    const shadowCam = light.shadow.camera;
    if (index >= steps.length) {
      // Off: shrink the box to nothing (ground outside it reads as lit),
      // render that empty map once, then skip the shadow pass entirely.
      // Re-applied if a preset change (setLights) reset the shadow camera.
      if (this.step !== index || shadowCam.right !== SHADOW_OFF_EXTENT) {
        this.step = index;
        shadowCam.left = shadowCam.bottom = -SHADOW_OFF_EXTENT;
        shadowCam.right = shadowCam.top = SHADOW_OFF_EXTENT;
        shadowCam.updateProjectionMatrix();
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = true;
      }
      return;
    }
    const step = steps[index];
    // Apply the step on a change, and again if a preset change (setLights)
    // reset the shadow camera through the light component.
    if (
      this.step !== index ||
      shadowCam.right !== step.halfExtent ||
      shadowCam.far !== step.far
    ) {
      this.step = index;
      shadowCam.left = shadowCam.bottom = -step.halfExtent;
      shadowCam.right = shadowCam.top = step.halfExtent;
      shadowCam.near = 0.5;
      shadowCam.far = step.far;
      shadowCam.updateProjectionMatrix();
      light.shadow.autoUpdate = true;
      this.lastSnapped.set(NaN, NaN, NaN);
    }

    // The sun's direction: from the light at rest toward the default target
    // at the world origin.
    const sun = lightEl.object3D.localToWorld(this.sun.copy(env.restLocal));
    this.camDir.set(-e[8], -e[9], -e[10]).normalize();
    shadowFocus(this.camPos, this.camDir, step.reach, 0, this.focus);
    this.lightDir.copy(sun).negate().normalize();
    snapToShadowTexels(this.focus, this.lightDir, step.texelSize, this.snapped);

    if (this.snapped.equals(this.lastSnapped) && sun.equals(this.lastSun)) {
      return;
    }
    this.lastSnapped.copy(this.snapped);
    this.lastSun.copy(sun);

    light.target.position.copy(this.snapped);
    light.target.updateMatrixWorld();
    // The light sits `distance` back along the sun from the focus. `sun` is
    // a scratch vector from here on.
    sun.copy(this.lightDir).multiplyScalar(-step.distance).add(this.snapped);
    light.position.copy(lightEl.object3D.worldToLocal(sun));
  }
});

// Sky presets download an equirect JPEG from the assets CDN. Until it lands
// the scene shows a generated gradient placeholder for the preset
// (src/sky-placeholder.js) instead of the renderer's black clear color, and
// the download is reported to the asset-load-status system as a texture keyed
// `sky:<preset>` so the panel load sheen tracks it (#2009).
AFRAME.registerComponent('street-environment', {
  schema: {
    preset: {
      type: 'string',
      default: 'day',
      oneOf: [
        'day',
        'night',
        'color',
        'sunny-morning',
        'cloudy-afternoon',
        'sunny-afternoon',
        'sunny-noon',
        'foggy',
        'cloudy'
      ]
    },
    backgroundColor: {
      type: 'color',
      default: '#808080',
      if: { preset: ['color'] }
    }
  },

  init: function () {
    this.system.env = this;
    this.followLight = null;
    this.restLocal = new THREE.Vector3();
    // Bigger shadow map on desktop, chosen once (see shadow-follow.js).
    this.shadow = shadowSettings({
      mobile: AFRAME.utils.device.isMobile(),
      maxTextureSize: this.el.sceneEl.renderer?.capabilities.maxTextureSize
    });
    this.textureLoader = new THREE.TextureLoader();
    this.light1 = this.createLight('env-light1', {
      type: 'ambient',
      color: '#FFF'
    });
    this.light1.setAttribute('data-layer-name', 'Ambient Light');
    this.light2 = this.createLight('env-light2', {
      type: 'directional',
      castShadow: true
    });
    this.light2.setAttribute(
      'data-layer-name',
      'Directional Light • Shadow Caster'
    );
  },

  update: function (oldData) {
    this.setEnvOption();
    this.el.setAttribute('data-no-transform', '');
  },

  setEnvOption: function () {
    const assetsPathRoot = '//assets.3dstreet.app/';
    const scene = this.el.sceneEl.object3D;

    switch (this.data.preset) {
      case 'night':
        this.setLights(0.5, 0.15);
        this.backgroundImage = `${assetsPathRoot}images/AdobeStock_286725174-min.jpeg`;
        this.setBackground(this.backgroundImage);
        break;
      case 'day':
        this.setLights(0.8, 2.2);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-polyhaven-wasteland_clouds_puresky.jpeg`;
        this.setBackground(this.backgroundImage);
        this.light2.setAttribute('position', '-40 56 -43');
        break;
      case 'sunny-morning':
        this.setLights(0.8, 2.2);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        this.light2.setAttribute('position', '-60 56 -16');
        break;
      case 'cloudy-afternoon':
        this.setLights(2, 0.6);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-mud_road_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        break;
      case 'sunny-afternoon':
        this.setLights(2, 2.2);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        this.light2.setAttribute('position', '60 56 -16');
        break;
      case 'sunny-noon':
        this.setLights(2, 2.2);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-kloppenheim_05_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        this.light2.setAttribute('position', '5 56 -16');
        break;
      case 'foggy':
        this.setLights(2, 0.6);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        this.light2.setAttribute('light', 'castShadow', false);
        break;
      case 'cloudy':
        this.setLights(2, 0.6);
        this.backgroundImage = `${assetsPathRoot}images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg`;
        this.setBackground(this.backgroundImage);
        break;
      default: // 'color'
        this.setLights(0.8, 2.2);
        this.backgroundImage = null;
        // An in-flight sky download is no longer wanted; its callback
        // checks this and lets go of the texture.
        this.pendingBackground = null;
        this.disposeSceneTexture();
        scene.background = new THREE.Color(this.data.backgroundColor);
        scene.environment = null;
    }
  },

  setLights: function (intensity1, intensity2) {
    const { mapSize, steps } = this.shadow;
    const h = steps[0].halfExtent;
    this.light1.setAttribute('light', 'intensity', intensity1);
    this.light2.setAttribute(
      'light',
      `intensity: ${intensity2}; castShadow: true; shadowCameraBottom: ${-h}; shadowCameraLeft: ${-h}; shadowCameraRight: ${h}; shadowCameraTop: ${h}; shadowCameraFar: ${steps[0].far}; shadowMapHeight: ${mapSize}; shadowMapWidth: ${mapSize}`
    );
  },

  /** Dispose the scene's current texture background (real or placeholder). */
  disposeSceneTexture: function () {
    const scene = this.el.sceneEl.object3D;
    if (scene.background?.isTexture) {
      scene.background.dispose();
    }
    scene.background = null;
    scene.environment = null;
  },

  /** Show the preset's gradient placeholder as background and environment. */
  showSkyPlaceholder: function (preset) {
    const scene = this.el.sceneEl.object3D;
    this.disposeSceneTexture();
    const placeholder = createSkyPlaceholderTexture(preset);
    scene.background = placeholder;
    scene.environment = placeholder;
  },

  notifySky: function (name, preset, imagePath) {
    this.el.sceneEl.emit(name, { id: 'sky:' + preset, src: imagePath }, false);
  },

  /**
   * Download a sky image once even when presets flip back and forth while
   * it is in flight: one promise per path, shared by every caller.
   */
  loadSkyTexture: function (imagePath) {
    if (!this.skyLoads) this.skyLoads = new Map();
    let load = this.skyLoads.get(imagePath);
    if (!load) {
      load = new Promise((resolve, reject) => {
        this.textureLoader.load(imagePath, resolve, undefined, reject);
      }).finally(() => this.skyLoads.delete(imagePath));
      this.skyLoads.set(imagePath, load);
    }
    return load;
  },

  setBackground: function (imagePath) {
    const scene = this.el.sceneEl.object3D;
    const preset = this.data.preset;
    // Already downloading this sky: nothing to do.
    if (this.pendingBackground === imagePath) return;
    // Already showing it (the placeholder has no skySrc, so it never matches).
    if (
      scene.background?.isTexture &&
      scene.background.userData.skySrc === imagePath
    ) {
      this.pendingBackground = null;
      return;
    }
    this.showSkyPlaceholder(preset);
    this.pendingBackground = imagePath;
    this.notifySky('texture-loading', preset, imagePath);
    this.loadSkyTexture(imagePath).then(
      (texture) => {
        // Only the download the component still wants gets applied. A
        // shared load can hand the same texture to two callbacks: whichever
        // runs first applies it; the other must not dispose it.
        if (
          this.pendingBackground !== imagePath ||
          this.el.parentNode === null
        ) {
          if (scene.background !== texture) texture.dispose();
          return;
        }
        this.pendingBackground = null;
        this.notifySky('texture-loaded', preset, imagePath);
        this.disposeSceneTexture();
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData.skySrc = imagePath;
        scene.background = texture;
        scene.environment = texture;
      },
      () => {
        // Keep the placeholder: a gradient beats a black sky.
        if (this.pendingBackground !== imagePath) return;
        this.pendingBackground = null;
        this.notifySky('texture-error', preset, imagePath);
      }
    );
  },

  createLight: function (id, attributes) {
    const light = document.createElement('a-entity');
    light.setAttribute('id', id);
    light.setAttribute('light', attributes);
    this.el.appendChild(light);
    return light;
  },

  remove() {
    if (this.system.env === this) this.system.env = null;
    this.light1.remove();
    this.light2.remove();
  }
});
