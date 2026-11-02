/* global AFRAME, THREE */
import { createSkyPlaceholderTexture } from '../sky-placeholder.js';
import {
  DEFAULT_UNLIT_SHADOW_STRENGTH,
  setUnlitShadowStrength
} from './flat-shadow.js';
import {
  MIN_SUN_ELEVATION,
  sunAnglesFromPosition,
  sunPositionFromAngles
} from '../tested/sun-direction.js';
import {
  pickShadowStep,
  shadowDepth,
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
    this.distance = 0;
    this.far = 0;
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

    // The sun's direction: from the light at rest toward the default target
    // at the world origin.
    const sun = lightEl.object3D.localToWorld(this.sun.copy(env.restLocal));
    if (sun.lengthSq() < 1e-6) return; // no direction yet
    const sunChanged = !sun.equals(this.lastSun);
    if (sunChanged) {
      this.lastSun.copy(sun);
      this.lightDir.copy(sun).negate().normalize();
    }

    // Apply the step on a change of step or sun, and again if a preset
    // change (setLights) reset the shadow camera through the light component.
    if (
      sunChanged ||
      this.step !== index ||
      shadowCam.right !== step.halfExtent ||
      shadowCam.far !== this.far
    ) {
      this.step = index;
      const depth = shadowDepth(step.halfExtent, -this.lightDir.y);
      this.distance = depth.distance;
      this.far = depth.far;
      shadowCam.left = shadowCam.bottom = -step.halfExtent;
      shadowCam.right = shadowCam.top = step.halfExtent;
      shadowCam.near = 0.5;
      shadowCam.far = depth.far;
      shadowCam.updateProjectionMatrix();
      light.shadow.autoUpdate = true;
      this.lastSnapped.set(NaN, NaN, NaN);
    }

    this.camDir.set(-e[8], -e[9], -e[10]).normalize();
    shadowFocus(this.camPos, this.camDir, step.reach, 0, this.focus);
    snapToShadowTexels(this.focus, this.lightDir, step.texelSize, this.snapped);
    if (this.snapped.equals(this.lastSnapped)) return;
    this.lastSnapped.copy(this.snapped);

    light.target.position.copy(this.snapped);
    light.target.updateMatrixWorld();
    // The light sits `distance` back along the sun from the focus. `sun` is
    // a scratch vector from here on.
    sun.copy(this.lightDir).multiplyScalar(-this.distance).add(this.snapped);
    light.position.copy(lightEl.object3D.worldToLocal(sun));
  }
});

// Lighting presets: ambient and sun intensity, the sky image (shown as the
// background unless `background` is `color`, and always the environment map
// that lights and reflects off PBR materials), and the sun's position above
// the origin. Presets without a sun of their own use the day sun: the light
// would otherwise sit at the origin with no direction (#2125).
const SKY_ROOT = '//assets.3dstreet.app/images/';
const DAY_SUN = [-40, 56, -43];
const PRESETS = {
  day: {
    ambient: 0.8,
    sun: 2.2,
    sky: 'skies/2048-polyhaven-wasteland_clouds_puresky.jpeg',
    sunAt: DAY_SUN
  },
  night: {
    ambient: 0.5,
    sun: 0.15,
    sky: 'AdobeStock_286725174-min.jpeg',
    sunAt: DAY_SUN
  },
  'sunny-morning': {
    ambient: 0.8,
    sun: 2.2,
    sky: 'skies/2048-polyhaven-qwantani_puresky-sdr.jpeg',
    sunAt: [-60, 56, -16]
  },
  'cloudy-afternoon': {
    ambient: 2,
    sun: 0.6,
    sky: 'skies/2048-mud_road_puresky-sdr.jpeg',
    sunAt: DAY_SUN
  },
  'sunny-afternoon': {
    ambient: 2,
    sun: 2.2,
    sky: 'skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg',
    sunAt: [60, 56, -16]
  },
  'sunny-noon': {
    ambient: 2,
    sun: 2.2,
    sky: 'skies/2048-kloppenheim_05_puresky-sdr.jpeg',
    sunAt: [5, 56, -16]
  },
  foggy: {
    ambient: 2,
    sun: 0.6,
    sky: 'skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg',
    sunAt: DAY_SUN,
    shadows: false
  },
  cloudy: {
    ambient: 2,
    sun: 0.6,
    sky: 'skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg',
    sunAt: DAY_SUN
  }
};
// How far from the origin a custom sun sits; only its direction matters.
const SUN_DISTANCE = 80;

/** The preset's own sun as { azimuth, elevation } (sun-direction.js). */
export function presetSunAngles(preset) {
  const [x, y, z] = (PRESETS[preset] || PRESETS.day).sunAt;
  return sunAnglesFromPosition(x, y, z);
}

// Sky presets download an equirect JPEG from the assets CDN. Until it lands
// the scene shows a generated gradient placeholder for the preset
// (src/sky-placeholder.js) instead of the renderer's black clear color, and
// the download is reported to the asset-load-status system as a texture keyed
// `sky:<preset>` so the panel load sheen tracks it (#2009).
//
// Background and lighting are separate (#2118): a solid colour background
// replaces only what the camera sees behind the scene; the preset's sky still
// lights it.
AFRAME.registerComponent('street-environment', {
  schema: {
    preset: {
      type: 'string',
      default: 'day',
      oneOf: Object.keys(PRESETS)
    },
    background: {
      type: 'string',
      default: 'sky',
      oneOf: ['sky', 'color']
    },
    backgroundColor: {
      type: 'color',
      default: '#808080',
      if: { background: ['color'] }
    },
    // Off: the preset's sun. On: the sun dial's azimuth (degrees clockwise
    // from north, +X) and elevation (degrees above the horizon).
    sunCustom: { type: 'boolean', default: false },
    sunAzimuth: { type: 'number', default: 0, if: { sunCustom: [true] } },
    sunElevation: { type: 'number', default: 45, if: { sunCustom: [true] } },
    // How much a full shadow darkens photographic (unlit) surfaces: placed
    // images and 3D Tiles (flat-shadow.js).
    shadowStrength: {
      type: 'number',
      default: DEFAULT_UNLIT_SHADOW_STRENGTH,
      min: 0,
      max: 1
    }
  },

  init: function () {
    this.system.env = this;
    this.followLight = null;
    this.restLocal = new THREE.Vector3();
    this.skyTexture = null;
    this.backgroundColor = new THREE.Color();
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

  update: function () {
    // Before #2118 `color` was a preset that also turned off the sky's
    // lighting. It is now a background over the day preset.
    if (this.data.preset === 'color') {
      this.el.setAttribute('street-environment', {
        preset: 'day',
        background: 'color'
      });
      return;
    }
    this.setEnvOption();
    this.el.setAttribute('data-no-transform', '');
  },

  setEnvOption: function () {
    const data = this.data;
    const preset = PRESETS[data.preset] || PRESETS.day;
    this.setLights(preset.ambient, preset.sun, preset.shadows !== false);
    this.applySun();
    setUnlitShadowStrength(data.shadowStrength);
    this.setSky(SKY_ROOT + preset.sky);
    this.applyBackground();
  },

  /** Point the sun as the data says: custom angles, or the preset's sun. */
  applySun: function () {
    const data = this.data;
    if (data.sunCustom) {
      this.setSun(data.sunAzimuth, data.sunElevation);
    } else {
      const [x, y, z] = (PRESETS[data.preset] || PRESETS.day).sunAt;
      this.light2.setAttribute('position', { x, y, z });
    }
  },

  /**
   * Point the sun from `azimuth`/`elevation` without touching the component's
   * data: the sun dial previews a drag through this and commits on release.
   */
  setSun: function (azimuth, elevation) {
    const clamped = Math.min(90, Math.max(MIN_SUN_ELEVATION, elevation));
    const { x, y, z } = sunPositionFromAngles(azimuth, clamped, SUN_DISTANCE);
    this.light2.setAttribute('position', { x, y, z });
  },

  /** The sun the scene is showing, as { azimuth, elevation }. */
  getSunAngles: function () {
    if (this.data.sunCustom) {
      return {
        azimuth: this.data.sunAzimuth,
        elevation: this.data.sunElevation
      };
    }
    return presetSunAngles(this.data.preset);
  },

  setLights: function (ambient, sun, castShadow) {
    const { mapSize, steps } = this.shadow;
    const h = steps[0].halfExtent;
    this.light1.setAttribute('light', 'intensity', ambient);
    this.light2.setAttribute(
      'light',
      `intensity: ${sun}; castShadow: ${castShadow}; shadowCameraBottom: ${-h}; shadowCameraLeft: ${-h}; shadowCameraRight: ${h}; shadowCameraTop: ${h}; shadowMapHeight: ${mapSize}; shadowMapWidth: ${mapSize}`
    );
  },

  /** Show the sky texture, or the solid colour when `background` is color. */
  applyBackground: function () {
    const scene = this.el.sceneEl.object3D;
    if (this.data.background === 'color') {
      scene.background = this.backgroundColor.set(this.data.backgroundColor);
    } else {
      scene.background = this.skyTexture;
    }
  },

  /** Make `texture` the sky (environment, and background unless colour). */
  useSkyTexture: function (texture) {
    if (this.skyTexture && this.skyTexture !== texture) {
      this.skyTexture.dispose();
    }
    this.skyTexture = texture;
    this.el.sceneEl.object3D.environment = texture;
    this.applyBackground();
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

  setSky: function (imagePath) {
    const preset = this.data.preset;
    // Already downloading this sky: nothing to do.
    if (this.pendingSky === imagePath) return;
    // Already showing it (the placeholder has no skySrc, so it never matches).
    if (this.skyTexture?.userData.skySrc === imagePath) {
      this.pendingSky = null;
      return;
    }
    this.useSkyTexture(createSkyPlaceholderTexture(preset));
    this.pendingSky = imagePath;
    this.notifySky('texture-loading', preset, imagePath);
    this.loadSkyTexture(imagePath).then(
      (texture) => {
        // Only the download the component still wants gets applied. A
        // shared load can hand the same texture to two callbacks: whichever
        // runs first applies it; the other must not dispose it.
        if (this.pendingSky !== imagePath || this.el.parentNode === null) {
          if (this.skyTexture !== texture) texture.dispose();
          return;
        }
        this.pendingSky = null;
        this.notifySky('texture-loaded', preset, imagePath);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData.skySrc = imagePath;
        this.useSkyTexture(texture);
      },
      () => {
        // Keep the placeholder: a gradient beats a black sky.
        if (this.pendingSky !== imagePath) return;
        this.pendingSky = null;
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
