/* global AFRAME, THREE */
import { createSkyPlaceholderTexture } from '../sky-placeholder.js';

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
        this.disposeSceneTexture();
        scene.background = new THREE.Color(this.data.backgroundColor);
        scene.environment = null;
    }
  },

  setLights: function (intensity1, intensity2) {
    this.light1.setAttribute('light', 'intensity', intensity1);
    this.light2.setAttribute(
      'light',
      `intensity: ${intensity2}; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048`
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

  setBackground: function (imagePath) {
    const scene = this.el.sceneEl.object3D;
    const preset = this.data.preset;
    // Already showing this sky, or already downloading it: nothing to do.
    if (
      this.pendingBackground === imagePath ||
      (scene.background?.isTexture &&
        scene.background.userData.skySrc === imagePath)
    ) {
      return;
    }
    this.showSkyPlaceholder(preset);
    this.pendingBackground = imagePath;
    this.notifySky('texture-loading', preset, imagePath);
    this.textureLoader.load(
      imagePath,
      (texture) => {
        if (this.pendingBackground === imagePath) {
          this.pendingBackground = null;
        }
        this.notifySky('texture-loaded', preset, imagePath);
        // If we changed to color preset in the meantime or we switched to an other image, ignore this texture
        if (
          this.data?.preset === 'color' ||
          imagePath !== this.backgroundImage ||
          this.el.parentNode === null
        ) {
          texture.dispose();
        } else {
          this.disposeSceneTexture();
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.userData.skySrc = imagePath;
          scene.background = texture;
          scene.environment = texture;
        }
      },
      undefined,
      () => {
        // Keep the placeholder: a gradient beats a black sky.
        if (this.pendingBackground === imagePath) {
          this.pendingBackground = null;
        }
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
    this.light1.remove();
    this.light2.remove();
  }
});
