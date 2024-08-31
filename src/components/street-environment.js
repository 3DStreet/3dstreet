/* global AFRAME, THREE */

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
    backgroundColor: { type: 'color', default: '#FFF' }
  },

  init: function () {
    this.el.sceneEl.renderer.outputEncoding = THREE.sRGBEncoding;
    this.textureLoader = new THREE.TextureLoader();
    this.light1 =
      this.el.sceneEl.querySelector('#env-light1') ||
      this.createLight('env-light1', { type: 'ambient', color: '#FFF' });
    this.light2 =
      this.el.sceneEl.querySelector('#env-light2') ||
      this.createLight('env-light2', { type: 'directional', castShadow: true });
    this.setEnvOption();
  },

  update: function (oldData) {
    this.setEnvOption();
  },

  setEnvOption: function () {
    const assetsPathRoot = '//assets.3dstreet.app/';
    const scene = this.el.sceneEl.object3D;

    switch (this.data.preset) {
      case 'night':
        this.setLights(0.5, 0.15);
        this.setBackground(
          `${assetsPathRoot}images/AdobeStock_286725174-min.jpeg`
        );
        break;
      case 'day':
        this.setLights(0.8, 2.2);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-polyhaven-wasteland_clouds_puresky.jpeg`
        );
        this.light2.setAttribute('position', '40 56 16');
        break;
      case 'sunny-morning':
        this.setLights(0.8, 2.2);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg`
        );
        this.light2.setAttribute('position', '-60 56 -16');
        break;
      case 'cloudy-afternoon':
        this.setLights(2, 0.6);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-mud_road_puresky-sdr.jpeg`
        );
        break;
      case 'sunny-afternoon':
        this.setLights(2, 2.2);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg`
        );
        this.light2.setAttribute('position', '60 56 -16');
        break;
      case 'sunny-noon':
        this.setLights(2, 2.2);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-kloppenheim_05_puresky-sdr.jpeg`
        );
        this.light2.setAttribute('position', '5 56 -16');
        break;
      case 'foggy':
        this.setLights(2, 0.6);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg`
        );
        this.light2.setAttribute('light', 'castShadow', false);
        break;
      case 'cloudy':
        this.setLights(2, 0.6);
        this.setBackground(
          `${assetsPathRoot}images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg`
        );
        break;
      default: // 'color'
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

  setBackground: function (imagePath) {
    const scene = this.el.sceneEl.object3D;
    this.textureLoader.load(imagePath, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.encoding = THREE.sRGBEncoding;
      scene.background = texture;
      scene.environment = texture;
    });
  },

  createLight: function (id, attributes) {
    const light = document.createElement('a-entity');
    light.setAttribute('id', id);
    light.setAttribute('light', attributes);
    this.el.appendChild(light);
    return light;
  }
});
