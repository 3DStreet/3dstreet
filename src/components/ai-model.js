/* global AFRAME */

/**
 * Text to 3D AI component.
 * Source: https://glitch.com/edit/#!/aframe-ai-model-component?path=ai-model.js
 */
AFRAME.registerComponent('ai-model', {
  schema: {
    prompt: { type: 'string', default: 'robot' },
    apiURL: {
      default: 'https://ai-playground.supermedium.workers.dev/generate-object'
    },
    apiKey: { type: 'string', default: '' },
    src: { type: 'map' },
    seed: { default: 0 }
  },

  init: function () {
    console.log('ai-model component initialized');
    var self = this;
    this.setupLoader();
    this.el.addEventListener('model-loaded', function () {
      self.loading = false;
      self.dotsEl.object3D.visible = false;
    });
    if (!this.data.apiKey) {
      console.log('Cannot generate model. Missing API Key');
      return;
    }
    this.generateModel();
  },

  setupLoader: function () {
    var dotsEl = (this.dotsEl = document.createElement('a-entity'));
    var dot1El = (this.dot1El = document.createElement('a-entity'));
    var dot2El = (this.dot2El = document.createElement('a-entity'));
    var dot3El = (this.dot3El = document.createElement('a-entity'));

    dot1El.setAttribute('geometry', { primitive: 'sphere', radius: 0.02 });
    dot1El.setAttribute('material', { color: '#ff74b8', shader: 'flat' });
    dot1El.setAttribute('position', '-0.06 0 0');

    dot2El.setAttribute('geometry', { primitive: 'sphere', radius: 0.02 });
    dot2El.setAttribute('material', { color: '#ff74b8', shader: 'flat' });
    dot2El.setAttribute('position', '0 0 0');

    dot3El.setAttribute('geometry', { primitive: 'sphere', radius: 0.02 });
    dot3El.setAttribute('material', { color: '#ff74b8', shader: 'flat' });
    dot3El.setAttribute('position', '0.06 0 0');

    dotsEl.appendChild(dot1El);
    dotsEl.appendChild(dot2El);
    dotsEl.appendChild(dot3El);

    this.el.appendChild(dotsEl);

    this.loading = true;
  },

  tick: (function () {
    var cameraWorldPosition = new THREE.Vector3();
    return function (time) {
      var timeSecs;
      var camera;

      if (!this.loading) {
        return;
      }
      timeSecs = (time / 1000) % 4;
      this.dot1El.object3D.visible = timeSecs >= 1;
      this.dot2El.object3D.visible = timeSecs >= 2;
      this.dot3El.object3D.visible = timeSecs >= 3;

      camera = this.el.sceneEl.camera;
      camera.updateMatrixWorld();
      cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
      this.dotsEl.object3D.lookAt(cameraWorldPosition);
    };
  })(),

  generateModel: function () {
    var modelEl = (this.modelEl = document.createElement('a-entity'));
    var imgBase64 = this.data.src && this.convertImgToBase64(this.data.src);
    var requestData = {
      prompt: this.data.prompt,
      seed: this.data.seed
    };
    var headers = new Headers();
    if (imgBase64) {
      requestData.image = imgBase64;
    }

    headers.append('authorization', 'Bearer ' + this.data.apiKey);

    var requestOptions = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestData)
    };

    fetch(this.data.apiURL, requestOptions)
      .then(function (response) {
        if (!response.ok) {
          if (response.status === 401) {
            console.error('API Key not correct');
          }
          if (response.status === 402) {
            console.error('Not enough credits');
          }
          throw new Error('HTTP error! status: ' + response.status);
        }
        return response.json();
      })
      .then(function (response) {
        modelEl.setAttribute('obj-model', { obj: response.data.url });
      })
      .then(function (error) {
        if (error) {
          console.log('Request error ' + error);
        }
      });

    modelEl.setAttribute('rotation', '0 180 0');
    this.el.appendChild(modelEl);
  },

  convertImgToBase64: function (imgEl) {
    var header = 'data:image/png;base64,';
    var canvas = document.createElement('canvas');
    canvas.width = imgEl.width;
    canvas.height = imgEl.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    return canvas.toDataURL('image/png').replace(header, '');
  }
});
