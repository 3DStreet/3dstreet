/* global THREE */
/**
 * Screen Space Ambient Occlusion Effect
 * Implementation for A-Frame
 * Based on the bloom component and Three.js SSAO example
 */

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

AFRAME.registerComponent('ssao', {
  schema: {
    enabled: { type: 'boolean', default: true },
    output: {
      type: 'string',
      default: 'Default',
      oneOf: ['Default', 'SSAO', 'Blur', 'Depth', 'Normal']
    },
    kernelRadius: { type: 'number', default: 16 },
    minDistance: { type: 'number', default: 0.005 },
    maxDistance: { type: 'number', default: 0.1 }
  },
  events: {
    rendererresize: function () {
      this.renderer.getSize(this.size);
      this.composer.setSize(this.size.width, this.size.height);
    }
  },
  init: function () {
    this.size = new THREE.Vector2();
    this.scene = this.el.object3D;
    this.renderer = this.el.renderer;
    this.camera = this.el.camera;
    this.originalRender = this.el.renderer.render;
    this.bind();
  },
  update: function (oldData) {
    if (oldData.enabled === false && this.data.enabled === true) {
      this.bind();
    }

    if (oldData.enabled === true && this.data.enabled === false) {
      this.el.renderer.render = this.originalRender;
    }

    if (this.composer) {
      this.composer.dispose();
    }

    // Create composer with multisampling to avoid aliasing
    var resolution = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    var renderTarget = new THREE.WebGLRenderTarget(
      resolution.width,
      resolution.height,
      {
        type: THREE.HalfFloatType,
        samples: 8,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        depthTexture: new THREE.DepthTexture()
      }
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);

    // Create render pass
    var renderScene = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderScene);

    // Create SSAO pass
    if (this.ssaoPass) {
      this.ssaoPass.dispose();
    }

    this.ssaoPass = new SSAOPass(
      this.scene,
      this.camera,
      resolution.width,
      resolution.height
    );

    // Set SSAO pass parameters
    this.ssaoPass.kernelRadius = this.data.kernelRadius;
    this.ssaoPass.minDistance = this.data.minDistance;
    this.ssaoPass.maxDistance = this.data.maxDistance;

    // Set output mode
    switch (this.data.output) {
      case 'SSAO':
        this.ssaoPass.output = SSAOPass.OUTPUT.SSAO;
        break;
      case 'Blur':
        this.ssaoPass.output = SSAOPass.OUTPUT.Blur;
        break;
      case 'Depth':
        this.ssaoPass.output = SSAOPass.OUTPUT.Depth;
        break;
      case 'Normal':
        this.ssaoPass.output = SSAOPass.OUTPUT.Normal;
        break;
      default:
        this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    }

    // Log the current output mode for debugging
    console.log(
      'SSAO output mode:',
      this.data.output,
      'SSAOPass.OUTPUT value:',
      this.ssaoPass.output
    );

    this.composer.addPass(this.ssaoPass);

    // Create output pass
    if (this.outputPass) {
      this.outputPass.dispose();
    }
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  },

  bind: function () {
    var self = this;
    var isInsideComposerRender = false;

    this.el.renderer.render = function () {
      if (isInsideComposerRender) {
        self.originalRender.apply(this, arguments);
      } else {
        isInsideComposerRender = true;
        self.composer.render(self.el.sceneEl.delta / 1000);
        isInsideComposerRender = false;
      }
    };
  },

  remove: function () {
    this.el.renderer.render = this.originalRender;
    if (this.composer) {
      this.composer.dispose();
    }
    if (this.ssaoPass) {
      this.ssaoPass.dispose();
    }
    if (this.outputPass) {
      this.outputPass.dispose();
    }
  }
});
