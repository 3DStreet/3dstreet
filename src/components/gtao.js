/* global THREE, AFRAME */
/**
 * Ground Truth Ambient Occlusion Effect
 * Implementation for A-Frame
 * Based on the SSAO component and Three.js GTAO example
 * Original implementation by Rabbid76 (https://github.com/Rabbid76)
 */

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

AFRAME.registerComponent('gtao', {
  schema: {
    enabled: { type: 'boolean', default: true },
    output: {
      type: 'string',
      default: 'Default',
      oneOf: ['Default', 'Diffuse', 'AO', 'Denoise', 'Depth', 'Normal']
    },
    // GTAO parameters
    blendIntensity: { type: 'number', default: 1.0 },
    radius: { type: 'number', default: 0.25 },
    distanceExponent: { type: 'number', default: 1.0 },
    thickness: { type: 'number', default: 1.0 },
    scale: { type: 'number', default: 1.0 },
    samples: { type: 'number', default: 16 },
    distanceFallOff: { type: 'number', default: 1.0 },
    screenSpaceRadius: { type: 'boolean', default: false },
    // Denoising parameters
    lumaPhi: { type: 'number', default: 10.0 },
    depthPhi: { type: 'number', default: 2.0 },
    normalPhi: { type: 'number', default: 3.0 },
    denoiseRadius: { type: 'number', default: 4.0 },
    radiusExponent: { type: 'number', default: 1.0 },
    rings: { type: 'number', default: 2.0 },
    denoiseSamples: { type: 'number', default: 16 }
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

    // Create GTAO pass
    if (this.gtaoPass) {
      this.gtaoPass.dispose();
    }

    this.gtaoPass = new GTAOPass(
      this.scene,
      this.camera,
      resolution.width,
      resolution.height
    );

    // Set GTAO pass parameters
    this.gtaoPass.blendIntensity = this.data.blendIntensity;

    // Set GTAO material parameters
    const aoParameters = {
      radius: this.data.radius,
      distanceExponent: this.data.distanceExponent,
      thickness: this.data.thickness,
      scale: this.data.scale,
      samples: this.data.samples,
      distanceFallOff: this.data.distanceFallOff,
      screenSpaceRadius: this.data.screenSpaceRadius
    };
    this.gtaoPass.updateGtaoMaterial(aoParameters);

    // Set denoising parameters
    const pdParameters = {
      lumaPhi: this.data.lumaPhi,
      depthPhi: this.data.depthPhi,
      normalPhi: this.data.normalPhi,
      radius: this.data.denoiseRadius,
      radiusExponent: this.data.radiusExponent,
      rings: this.data.rings,
      samples: this.data.denoiseSamples
    };
    this.gtaoPass.updatePdMaterial(pdParameters);

    // Set output mode
    switch (this.data.output) {
      case 'Diffuse':
        this.gtaoPass.output = GTAOPass.OUTPUT.Diffuse;
        break;
      case 'AO':
        this.gtaoPass.output = GTAOPass.OUTPUT.AO;
        break;
      case 'Denoise':
        this.gtaoPass.output = GTAOPass.OUTPUT.Denoise;
        break;
      case 'Depth':
        this.gtaoPass.output = GTAOPass.OUTPUT.Depth;
        break;
      case 'Normal':
        this.gtaoPass.output = GTAOPass.OUTPUT.Normal;
        break;
      default:
        this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    }

    // Log the current output mode for debugging
    console.log(
      'GTAO output mode:',
      this.data.output,
      'GTAOPass.OUTPUT value:',
      this.gtaoPass.output
    );

    this.composer.addPass(this.gtaoPass);

    // Create output pass
    if (this.outputPass) {
      this.outputPass.dispose();
    }
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Set scene clip box if needed
    if (this.scene) {
      const box = new THREE.Box3().setFromObject(this.scene);
      this.gtaoPass.setSceneClipBox(box);
    }
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
    if (this.gtaoPass) {
      this.gtaoPass.dispose();
    }
    if (this.outputPass) {
      this.outputPass.dispose();
    }
  }
});
