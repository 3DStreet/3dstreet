/* global AFRAME */

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
  setEnvOption: function () {
    const sky = this.sky;
    const light1 = this.light1;
    const light2 = this.light2;
    const assetsPathRoot = '//assets.3dstreet.app/';

    sky.setAttribute('radius', 5000);
    sky.setAttribute('hide-on-enter-ar', '');

    if (this.data.preset === 'night') {
      light1.setAttribute('light', 'intensity', 0.5);
      light2.setAttribute('light', 'intensity', 0.15);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#444');
      sky.setAttribute('src', '#sky-night');
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'day') {
      // TODO: create a parent with children
      light1.setAttribute('light', 'intensity', 0.8);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', '#sky');
      sky.setAttribute('rotation', '0 20 0');
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '-40 56 -16');
    } else if (this.data.preset === 'sunny-morning') {
      light1.setAttribute('light', 'intensity', 0.8);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '-60 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy-afternoon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-mud_road_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-afternoon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '60 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-noon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '5 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloppenheim_05_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'foggy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity: 0.6; castShadow: false;');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else {
      // color
      sky.setAttribute('visible', false);
      this.scene.setAttribute('background', 'color', this.data.backgroundColor);
    }
  },
  init: function () {
    const el = this.el;
    this.scene = document.querySelector('a-scene');
    this.light1 = document.createElement('a-entity');
    const light1 = this.light1;
    light1.setAttribute('id', 'env-light1');
    light1.setAttribute('light', { type: 'ambient', color: '#FFF' });
    el.appendChild(light1);

    this.light2 = document.createElement('a-entity');
    const light2 = this.light2;
    light2.setAttribute('id', 'env-light2');
    light2.setAttribute('position', '-60 56 -16');
    light2.setAttribute(
      'light',
      'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
    );
    el.appendChild(light2);

    this.sky = document.createElement('a-sky');
    const sky = this.sky;
    sky.setAttribute('id', 'env-sky');
    sky.setAttribute('data-ignore-raycaster', '');
    el.appendChild(sky);
  },
  update: function (oldData) {
    this.setEnvOption();
  }
});
