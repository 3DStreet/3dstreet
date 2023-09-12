//////////////////////////////
// Copy Shader			        //
//////////////////////////////
/**
 * Full-screen textured quad shader
 */

const CopyShader = {

	name: 'CopyShader',

	uniforms: {

		'tDiffuse': { value: null },
		'opacity': { value: 1.0 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );
			gl_FragColor.a *= opacity;


		}`

};

//////////////////////////////
// Pass       			        //
//////////////////////////////
const BufferGeometry = THREE.BufferGeometry;
const Float32BufferAttribute = THREE.Float32BufferAttribute;
const OrthographicCamera = THREE.OrthographicCamera;
const Mesh = THREE.Mesh;

class Pass {

	constructor() {

		this.isPass = true;

		// if set to true, the pass is processed by the composer
		this.enabled = true;

		// if set to true, the pass indicates to swap read and write buffer after rendering
		this.needsSwap = true;

		// if set to true, the pass clears its buffer before rendering
		this.clear = false;

		// if set to true, the result of the pass is rendered to screen. This is set automatically by EffectComposer.
		this.renderToScreen = false;

	}

	setSize( /* width, height */ ) {}

	render( /* renderer, writeBuffer, readBuffer, deltaTime, maskActive */ ) {

		console.error( 'THREE.Pass: .render() must be implemented in derived pass.' );

	}

	dispose() {}

}

// Helper for passes that need to fill the viewport with a single quad.

const _camera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

// https://github.com/mrdoob/three.js/pull/21358

const _geometry = new BufferGeometry();
_geometry.setAttribute( 'position', new Float32BufferAttribute( [ - 1, 3, 0, - 1, - 1, 0, 3, - 1, 0 ], 3 ) );
_geometry.setAttribute( 'uv', new Float32BufferAttribute( [ 0, 2, 0, 0, 2, 0 ], 2 ) );

class FullScreenQuad {

	constructor( material ) {

		this._mesh = new Mesh( _geometry, material );

	}

	dispose() {

		this._mesh.geometry.dispose();

	}

	render( renderer ) {

		// Disable XR projection for fullscreen effects
		// https://github.com/mrdoob/three.js/pull/18846
		const xrEnabled = renderer.xr.enabled;

		renderer.xr.enabled = false;
		renderer.render( this._mesh, _camera );
		renderer.xr.enabled = xrEnabled;

	}

	get material() {

		return this._mesh.material;

	}

	set material( value ) {

		this._mesh.material = value;

	}

}

//////////////////////////////
// Shader Pass			        //
//////////////////////////////
const ShaderMaterial = THREE.ShaderMaterial;
const UniformsUtils = THREE.UniformsUtils;

class ShaderPass extends Pass {

	constructor( shader, textureID ) {

		super();

		this.textureID = ( textureID !== undefined ) ? textureID : 'tDiffuse';

		if ( shader instanceof ShaderMaterial ) {

			this.uniforms = shader.uniforms;

			this.material = shader;

		} else if ( shader ) {

			this.uniforms = UniformsUtils.clone( shader.uniforms );

			this.material = new ShaderMaterial( {

				name: ( shader.name !== undefined ) ? shader.name : 'unspecified',
				defines: Object.assign( {}, shader.defines ),
				uniforms: this.uniforms,
				vertexShader: shader.vertexShader,
				fragmentShader: shader.fragmentShader

			} );

		}

		this.fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		if ( this.uniforms[ this.textureID ] ) {

			this.uniforms[ this.textureID ].value = readBuffer.texture;

		}

		this.fsQuad.material = this.material;

		if ( this.renderToScreen ) {

			renderer.setRenderTarget( null );
			this.fsQuad.render( renderer );

		} else {

			renderer.setRenderTarget( writeBuffer );
			// TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600
			if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
			this.fsQuad.render( renderer );

		}

	}

	dispose() {

		this.material.dispose();

		this.fsQuad.dispose();

	}

}

//////////////////////////////
// Mask Pass  			        //
//////////////////////////////
class MaskPass extends Pass {

	constructor( scene, camera ) {

		super();

		this.scene = scene;
		this.camera = camera;

		this.clear = true;
		this.needsSwap = false;

		this.inverse = false;

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		const context = renderer.getContext();
		const state = renderer.state;

		// don't update color or depth

		state.buffers.color.setMask( false );
		state.buffers.depth.setMask( false );

		// lock buffers

		state.buffers.color.setLocked( true );
		state.buffers.depth.setLocked( true );

		// set up stencil

		let writeValue, clearValue;

		if ( this.inverse ) {

			writeValue = 0;
			clearValue = 1;

		} else {

			writeValue = 1;
			clearValue = 0;

		}

		state.buffers.stencil.setTest( true );
		state.buffers.stencil.setOp( context.REPLACE, context.REPLACE, context.REPLACE );
		state.buffers.stencil.setFunc( context.ALWAYS, writeValue, 0xffffffff );
		state.buffers.stencil.setClear( clearValue );
		state.buffers.stencil.setLocked( true );

		// draw into the stencil buffer

		renderer.setRenderTarget( readBuffer );
		if ( this.clear ) renderer.clear();
		renderer.render( this.scene, this.camera );

		renderer.setRenderTarget( writeBuffer );
		if ( this.clear ) renderer.clear();
		renderer.render( this.scene, this.camera );

		// unlock color and depth buffer for subsequent rendering

		state.buffers.color.setLocked( false );
		state.buffers.depth.setLocked( false );

		// only render where stencil is set to 1

		state.buffers.stencil.setLocked( false );
		state.buffers.stencil.setFunc( context.EQUAL, 1, 0xffffffff ); // draw if == 1
		state.buffers.stencil.setOp( context.KEEP, context.KEEP, context.KEEP );
		state.buffers.stencil.setLocked( true );

	}

}

class ClearMaskPass extends Pass {

	constructor() {

		super();

		this.needsSwap = false;

	}

	render( renderer /*, writeBuffer, readBuffer, deltaTime, maskActive */ ) {

		renderer.state.buffers.stencil.setLocked( false );
		renderer.state.buffers.stencil.setTest( false );

	}

}


//////////////////////////////
// Effect Composer          //
//////////////////////////////
const Clock = THREE.Clock;
const HalfFloatType = THREE.HalfFloatType;
const Vector2 = THREE.Vector2;
const WebGLRenderTarget = THREE.WebGLRenderTarget;

const size = /* @__PURE__ */ new Vector2();

class EffectComposer {

	constructor( renderer, renderTarget ) {

		this.renderer = renderer;

		this._pixelRatio = renderer.getPixelRatio();

		if ( renderTarget === undefined ) {

			renderer.getSize( size );
			this._width = size.width;
			this._height = size.height;

			renderTarget = new WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType } );
			renderTarget.texture.name = 'EffectComposer.rt1';

		} else {

			this._width = renderTarget.width;
			this._height = renderTarget.height;

		}

		this.renderTarget1 = renderTarget;
		this.renderTarget2 = renderTarget.clone();
		this.renderTarget2.texture.name = 'EffectComposer.rt2';

		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;

		this.renderToScreen = true;

		this.passes = [];

		this.copyPass = new ShaderPass( CopyShader );

		this.clock = new Clock();

		this.onSessionStateChange = this.onSessionStateChange.bind( this );
		this.renderer.xr.addEventListener( 'sessionstart', this.onSessionStateChange );
		this.renderer.xr.addEventListener( 'sessionend', this.onSessionStateChange );

	}

	onSessionStateChange() {

		this.renderer.getSize( size );
		this._width = size.width;
		this._height = size.height;

		this._pixelRatio = this.renderer.xr.isPresenting ? 1 : this.renderer.getPixelRatio();

		this.setSize( this._width, this._height );

	}

	swapBuffers() {

		const tmp = this.readBuffer;
		this.readBuffer = this.writeBuffer;
		this.writeBuffer = tmp;

	}

	addPass( pass ) {

		this.passes.push( pass );
		pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

	}

	insertPass( pass, index ) {

		this.passes.splice( index, 0, pass );
		pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

	}

	removePass( pass ) {

		const index = this.passes.indexOf( pass );

		if ( index !== - 1 ) {

			this.passes.splice( index, 1 );

		}

	}

	isLastEnabledPass( passIndex ) {

		for ( let i = passIndex + 1; i < this.passes.length; i ++ ) {

			if ( this.passes[ i ].enabled ) {

				return false;

			}

		}

		return true;

	}

	render( deltaTime ) {

		// deltaTime value is in seconds

		if ( deltaTime === undefined ) {

			deltaTime = this.clock.getDelta();

		}

		const currentRenderTarget = this.renderer.getRenderTarget();

		let maskActive = false;

		for ( let i = 0, il = this.passes.length; i < il; i ++ ) {

			const pass = this.passes[ i ];

			if ( pass.enabled === false ) continue;

			pass.renderToScreen = ( this.renderToScreen && this.isLastEnabledPass( i ) );
			pass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive );

			if ( pass.needsSwap ) {

				if ( maskActive ) {

					const context = this.renderer.getContext();
					const stencil = this.renderer.state.buffers.stencil;

					//context.stencilFunc( context.NOTEQUAL, 1, 0xffffffff );
					stencil.setFunc( context.NOTEQUAL, 1, 0xffffffff );

					this.copyPass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime );

					//context.stencilFunc( context.EQUAL, 1, 0xffffffff );
					stencil.setFunc( context.EQUAL, 1, 0xffffffff );

				}

				this.swapBuffers();

			}

			if ( MaskPass !== undefined ) {

				if ( pass instanceof MaskPass ) {

					maskActive = true;

				} else if ( pass instanceof ClearMaskPass ) {

					maskActive = false;

				}

			}

		}

		this.renderer.setRenderTarget( currentRenderTarget );

	}

	reset( renderTarget ) {

		if ( renderTarget === undefined ) {

			this.renderer.getSize( size );
			this._pixelRatio = this.renderer.getPixelRatio();
			this._width = size.width;
			this._height = size.height;

			renderTarget = this.renderTarget1.clone();
			renderTarget.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		this.renderTarget1.dispose();
		this.renderTarget2.dispose();
		this.renderTarget1 = renderTarget;
		this.renderTarget2 = renderTarget.clone();

		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;

		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;

		this.renderTarget1.setSize( effectiveWidth, effectiveHeight );
		this.renderTarget2.setSize( effectiveWidth, effectiveHeight );

		for ( let i = 0; i < this.passes.length; i ++ ) {

			this.passes[ i ].setSize( effectiveWidth, effectiveHeight );

		}

	}

	setPixelRatio( pixelRatio ) {

		this._pixelRatio = pixelRatio;

		this.setSize( this._width, this._height );

	}

	dispose() {

		this.renderTarget1.dispose();
		this.renderTarget2.dispose();

		this.copyPass.dispose();

		this.renderer.xr.removeEventListener( 'sessionstart', this.onSessionStateChange );
		this.renderer.xr.removeEventListener( 'sessionend', this.onSessionStateChange );

	}

}
//////////////////////////////
// Render Pass 			        //
//////////////////////////////
const Color = THREE.Color;
class RenderPass extends Pass {

	constructor( scene, camera, overrideMaterial, clearColor, clearAlpha ) {

		super();

		this.scene = scene;
		this.camera = camera;

		this.overrideMaterial = overrideMaterial;

		this.clearColor = clearColor;
		this.clearAlpha = ( clearAlpha !== undefined ) ? clearAlpha : 0;

		this.clear = true;
		this.clearDepth = false;
		this.needsSwap = false;
		this._oldClearColor = new Color();

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		const oldAutoClear = renderer.autoClear;
		renderer.autoClear = false;

		let oldClearAlpha, oldOverrideMaterial;

		if ( this.overrideMaterial !== undefined ) {

			oldOverrideMaterial = this.scene.overrideMaterial;

			this.scene.overrideMaterial = this.overrideMaterial;

		}

		if ( this.clearColor ) {

			renderer.getClearColor( this._oldClearColor );
			oldClearAlpha = renderer.getClearAlpha();

			renderer.setClearColor( this.clearColor, this.clearAlpha );

		}

		if ( this.clearDepth ) {

			renderer.clearDepth();

		}

		renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );

		// TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600
		if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
		renderer.render( this.scene, this.camera );

		if ( this.clearColor ) {

			renderer.setClearColor( this._oldClearColor, oldClearAlpha );

		}

		if ( this.overrideMaterial !== undefined ) {

			this.scene.overrideMaterial = oldOverrideMaterial;

		}

		renderer.autoClear = oldAutoClear;

	}

}
////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////

// INDIVIDUAL EFFECTS (SHADERS AND PASSES)

//////////////////////////////
// 1. PENCIL EFFECT         //
//////////////////////////////

// Pencil Lines Material Shader
const vertexShader = `
  varying vec2 vUv;
  void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
  `;
// Define the fragment shader
const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D uNormals;
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  varying vec2 vUv;
  // The MIT License
  // Copyright © 2013 Inigo Quilez
  // Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  // https://www.youtube.com/c/InigoQuilez
  // https://iquilezles.org
  vec2 grad( ivec2 z )  // replace this anything that returns a random vector
  {
      // 2D to 1D  (feel free to replace by some other)
      int n = z.x+z.y*11111;
      // Hugo Elias hash (feel free to replace by another one)
      n = (n<<13)^n;
      n = (n*(n*n*15731+789221)+1376312589)>>16;
      // Perlin style vectors
      n &= 7;
      vec2 gr = vec2(n&1,n>>1)*2.0-1.0;
      return ( n>=6 ) ? vec2(0.0,gr.x) : 
             ( n>=4 ) ? vec2(gr.x,0.0) :
                                gr;                            
  }
  
  float noise( in vec2 p ) {
      ivec2 i = ivec2(floor( p ));
       vec2 f =       fract( p );
      
      vec2 u = f*f*(3.0-2.0*f); // feel free to replace by a quintic smoothstep instead
  
      return mix( mix( dot( grad( i+ivec2(0,0) ), f-vec2(0.0,0.0) ), 
                       dot( grad( i+ivec2(1,0) ), f-vec2(1.0,0.0) ), u.x),
                  mix( dot( grad( i+ivec2(0,1) ), f-vec2(0.0,1.0) ), 
                       dot( grad( i+ivec2(1,1) ), f-vec2(1.0,1.0) ), u.x), u.y);
  }
  
  float valueAtPoint(sampler2D image, vec2 coord, vec2 texel, vec2 point) {
      vec3 luma = vec3(0.299, 0.587, 0.114);
  
      return dot(texture2D(image, coord + texel * point).xyz, luma);
  }
  
  float diffuseValue(int x, int y) {
      // float cutoff = 40.0;
      // float offset =  0.5 / cutoff;
      // float noiseValue = clamp(texture(uTexture, vUv).r, 0.0, cutoff) / cutoff - offset;

      float noiseValue = 0.0;
      return valueAtPoint(tDiffuse, vUv + noiseValue, vec2(1.0 / uResolution.x, 1.0 / uResolution.y), vec2(x, y)) * 0.6;
  }
  
  float normalValue(int x, int y) {
      // float cutoff = 50.0;
      // float offset = 0.5 / cutoff;
      // float noiseValue = clamp(texture(uTexture, vUv).r, 0.0, cutoff) / cutoff - offset;
      float noiseValue = 0.0;

      return valueAtPoint(uNormals, vUv + noiseValue, vec2(1.0 / uResolution.x, 1.0 / uResolution.y), vec2(x, y)) * 0.3;
  }
  
  float getValue(int x, int y) {
      float noiseValue = 0.0;

      return diffuseValue(x, y) + normalValue(x, y) * noiseValue;
  }
  float combinedSobelValue() {
      // kernel definition (in glsl matrices are filled in column-major order)
      const mat3 Gx = mat3(-1, -2, -1, 0, 0, 0, 1, 2, 1);// x direction kernel
      const mat3 Gy = mat3(-1, 0, 1, -2, 0, 2, -1, 0, 1);// y direction kernel
  
      // fetch the 3x3 neighbourhood of a fragment
  
      // first column
      float tx0y0 = getValue(-1, -1);
      float tx0y1 = getValue(-1, 0);
      float tx0y2 = getValue(-1, 1);
  
      // second column
      float tx1y0 = getValue(0, -1);
      float tx1y1 = getValue(0, 0);
      float tx1y2 = getValue(0, 1);
  
      // third column
      float tx2y0 = getValue(1, -1);
      float tx2y1 = getValue(1, 0);
      float tx2y2 = getValue(1, 1);
  
      // gradient value in x direction
      float valueGx = Gx[0][0] * tx0y0 + Gx[1][0] * tx1y0 + Gx[2][0] * tx2y0 +
      Gx[0][1] * tx0y1 + Gx[1][1] * tx1y1 + Gx[2][1] * tx2y1 +
      Gx[0][2] * tx0y2 + Gx[1][2] * tx1y2 + Gx[2][2] * tx2y2;
  
      // gradient value in y direction
      float valueGy = Gy[0][0] * tx0y0 + Gy[1][0] * tx1y0 + Gy[2][0] * tx2y0 +
      Gy[0][1] * tx0y1 + Gy[1][1] * tx1y1 + Gy[2][1] * tx2y1 +
      Gy[0][2] * tx0y2 + Gy[1][2] * tx1y2 + Gy[2][2] * tx2y2;
  
      // magnitude of the total gradient
      float G = (valueGx * valueGx) + (valueGy * valueGy);
      return clamp(G, 0.0, 1.0);
  }
  void main() {
      float sobelValue = combinedSobelValue();
      sobelValue = smoothstep(0.01, 0.03, sobelValue);
  
      vec4 lineColor = vec4(0.32, 0.12, 0.2, 1.0);
  
      if (sobelValue > 0.1) {
          gl_FragColor = lineColor;
      } else {
          gl_FragColor = vec4(1.0);
      }
  }`;

class PencilLinesMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        uNormals: { value: null },
        uTexture: { value: null },
        uResolution: {
          value: new THREE.Vector2(1, 1),
        },
      },
      fragmentShader,
      vertexShader,
    });
  }
}

class PencilLinesPass extends Pass {
  constructor({ width, height, scene, camera }) {
    super();

    this.scene = scene;
    this.camera = camera;

    this.material = new PencilLinesMaterial();
    this.fsQuad = new FullScreenQuad(this.material);

    const normalBuffer = new THREE.WebGLRenderTarget(width, height);

    normalBuffer.texture.format = THREE.RGBAFormat;
    normalBuffer.texture.type = THREE.HalfFloatType;
    normalBuffer.texture.minFilter = THREE.NearestFilter;
    normalBuffer.texture.magFilter = THREE.NearestFilter;
    normalBuffer.texture.generateMipmaps = false;
    normalBuffer.stencilBuffer = false;
    this.normalBuffer = normalBuffer;

    this.normalMaterial = new THREE.MeshNormalMaterial();

    this.material.uniforms.uResolution.value = new THREE.Vector2(width, height);
    // .png
    const loader = new THREE.TextureLoader();
    loader.load(
      `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAIABJREFUeF5t3cmLRVfVxuG69n3/tyj2YoOo4MCBCCJ22EYNKopCVFAQEVQQNKOAUx05cyI4FERw6FCnGqOxTWLU+vgd6rm8OV8KilP33H12s5p3vWvtfW9dvvrVr94+9alPvXnKU55y8/SnP/24/u9//zt+u9/v0572tJtnPetZx/tdn/GMZ9w885nPPF7f3t7eXC6X4/rYY4/dPP744zf/+c9/jt9e//vf/77573//e9z3XtdHH330pp+eM4Z5eKZxutc4/f2CF7zgmEv39FkftTde865tP93TZ3P517/+dfPXv/715m9/+9sxl/qqn+7/85//PO71fD+9Vz/9WvuLX/zi6/qf/exnH/Oq/36szzj1Wd+tU9+1qX199ix5m3/9JP9+G7/3n/Oc5xyyJnfz6nVy73W/9d26GotMWkt977h05bnLV77yldtdcG/00+SbrEFMuMk0qdo10TWAnkno3WvQBjeJBNP7vX7kkUcO46hd7evHAhuvdp5tLEogbG0ZgWvCrj8G0zo8k2Aa9y9/+cthBD3DaJsLY+UAO6fGe+5zn3vz/Oc//7gSXn83Vn33fGMzhH/84x83f//734971tLaW1/PJMfGoBCyYQRdGzdDs96ea+zu9Ww/1kqujWVd5FzfxnJNLs3h8sUvfvFWx66E1uSgAC/toRRSR91rsJ00z2vhPKOJLBL0Xsrql7UTOKOqPcPkgS2kH3Nofgm+nwRQf7yKp9RffaWMvDIvyQBqm7IYm37qs/n1fOOk5K4pn0JSABnUPmXz+OTReMa0DmtuPoyIQZB3z3aPkiAgJ6C0xm9c62ZMraH71sXoG3sdujYM8fK5z33utheEyggohuKbHMjTgUnwCAYhhKwwupeQeAkDYGAW0Ri1BdEm2n1G1cIZZ2M01xbI0q2hkNF7Kb/fFJXy//SnP109FmpROqHWB+Uzhuc973mHEWQMYBfkC28gF5LVf22EgfpPoby4duRlTYsMjQNphI5kBXmtWagTdiBvcmaEwhu0ORDgnnvuOTjAwmyvW2gNNuaa4ApbiKgtSGoBiwA4Aa8zqYTG0BgRL+D9KQJMUs4+B+Y9Zz4JOYV1P6Uzgq6FgRQClRJMa1oE5Kk8PYWlCDGZ0WVUu57WyouhWWMar/nhFsu5QPrKkLzXEDlkYzB+xtB7eMw6X/OrPZ0wuEO2H//4x2/Bb0o8Q/16fZ3zekbA8pDCFrcCALGMQFziMSbP0CiZ8EA5XtH7C5Xgs3nmab1OWXhK42YA/TY2FCgU8IzmyHDAbuMvCRSHM6r6BrOUj0w2N7/Nvb8bs9813A19EE0o7T3GuCR0PZ83ayt0db9xcbENA4ug1zD/iU984pb3iesN6l6D9itesfAlcCbLCAhTG4RLbHTFFw7ouGPeq2AWXv/9UNQKmdCEjkUyZIgCCkGIoHAkPoJX6IcACwWb+XgP+cRFMgaOsYYs3GUA5iuMCoGyruQu7BlTxiG7ITcZVPdXH9AkObfOxm3djAKqHqHm05/+9MEBWGE3Wf85DBA8rxZ/NjWBCK4WXf8Y8gqKZy8hshhzqn8WX7+YrvfXa6VP+gB9IcCf//znQyAhBaUQysbX1i3LWcPgNfUpK+oektv9jM38EC/oxxGgbK+NQ15r0MhmYyGgDMS6GBL59Fp4kmk1n9brNQc9DPnee++93YktpDYBA4JorDplgm8kEvwyop1MbREuxMhrhgEJeLvw4zWBeZ73NE6wTIgImDjZ2EFhRvDwww9fWbq4vDk3Y3IPt9H3xtJic/cpvXlmYLiFOkTjL7JReu2MI1xAPXGfDKSiZCtEQhp6EvtlTFLclTm0OWoJZwMAt71JwK4GpzjIcY7Xm4f33gpNfUB+DDKXWEKDXawFIYSsurk1HpjcjKD3CD9l94uQ5bVIaUKEdojvOSUWHhlXz9S/MEDA2DfF7FrcYwxIHoMgR4UfYzaOLM161RLIwzgMQHjofmvNMKHtOvyRBoLBtcaFcrBkouBm4xnLbUIJUyqjzZPxgEUEwgTrFkZIjK2xQZncfectXfQcwYiFkb9+GQDDwnsW8hkVZm0cSsYfmrMqKIN3xVvIgxKgIzkjcxQMeaArY+BcixB4GRmvgntO3YOBNVdyuXz+85//f6XgOlySspZIQZtKXBnlXYEBYiyv4DniL9gXGsTVhEwpvIwxrBGBd/Osn43L+Arl1T6PV/ZlAGeiSfCt+YUvfOG14ENo+uH5YN56KBJPWgVCI9XPlQ8DxA/2yig4V4YpPOMZvScsy5KSR+8LS8vDhIHLfffdd2QBoE9JUycIHu9n0QjgQuN6Pc9nHOAPM1Ue3UxB/MUFsNkV3Nk4WgglJwQevJyD123KtpVAwti42rxDMqEBxGc4+u7vFfoi4tYDyHZRgOExckhAzjKBDcW8v1RUSsgAhRX9rmNBbEYK8Y/5fPOb3zwMAMRSLMvaSW8MwxVYp/coba2btzYwT7IBsrETERJ/eXd9qSCux4rxGH19bYqz81WhU8vgwThJbTMeRRMhZFNb+xnNs/7UNBhhc5OS1UY1U0zfEHow8FP2xVnUC+pLPYOTyggYBkXjPtbRVZ2jNnRMB2oCl+9+97sHRWX9vcFiocAukMUtW14yWFv5Ks/lodIh/VEKZZjHUaK8S2cYUm0oR1GG1dd/BE+IAMMbb5GjnR8vFb/rT7pEQClleUHzMm8IgNAuX/F3c9l0joFCq0UdRJjHqgOc0WiJKqNZgqd6iWNtMW/DQM9c7r///tslU7x1S7A1JHw5OSEvZEELBOgY4G5zRUxe8tVYIF3qtIIT+xlibUDjhgvGAeKhEsMj5N7HqJVheVt9qxKq2y8K1Ic4TfEMZ8MQI+5KhhE2Sjlvp2vfPIQl4YDnqgHIBNYAem8dgRNsSFjDxAus//KDH/zgMABkJYWCOmQObC/BqT1YYYUtsvuMSDjA2t1XFmXpXTHqZfveZ1C91ievNF7CU+0iVM/pu+cJkeAYVYKzU1g//fYjLNmRlIX03G5xp6xeN6ZfRoCw8eQMQg2BcQop1rh8SjXWHLzWH0eBYByrNSHXGzqXcF6+//3vH4WgGkrfQOMqhTGwHB7ddQlMf19TjNPe/sbyjb0bAhBAc1hPggTLkNf6F77N19oIQmghhA1P6vtqBT1DmFCl1zIJqGjOG38ZX1eKy5jOe/ycR3kcahrPOjioUvdRxLkLk0IuOXIoqIpvqHA2xpVnfec73zlKwWIS8rDp07k+APaFDosAeZQm3oDI9UT912YNYHNacZjRETSD4/0JubZIWfPyTMLh5cLXKqq/IZNw1dyUjPVprNoWIrbka71IIKPkzcsBKHB3FetbvF5kldYyCkawB3KWTCKEStG756KvNZrj2W9961sHCUTYEpJYZDJgE+SzPkqsc4PXFwV1RWxqK9SAVc+fLRe0SjlZ63oawwH3CKa0jGAQIHm5MNZzDN/ae4YBJrzKxjaQFu5DCDzgzFkgDmNq/M4PqNypWipdbzYFpptjMiJHa6zvJaT9zdvNAxnkPLI67XAgRa7L17/+9VtQQXmEIMY4lsTzETCEw8QpwcTFa9bdON3zfpPK2Hr+nCLuXoN5SbGWPBI45NK/iiBB9rqxvA8lcI7uN6bnbB278ngZAM4h9RTLhRFKk7bx2j1403qc7mHkDJazSe8YKQ9erkHJ6yCcRyhqHfRlu/wY+wtf+MJBAnuzQXknKwRfiiJNWswBnzpeMgJVTATMgmHGwlIRmEUMi8cplh0v88YNeDTvZjgMGSrIj80Rn1ljyvPVF4L8/rafwPu71/yRX7UKRiWsGp9yeWFGERmU0zslJOQyog2hMgNzXoPX3rowfoR15SgruXzyk5889gL6YQBL+JZ0SGGEgIUmjF08Q6DyCIpg1Sa0SMOIlidY+CrKglW1GIx42xj1QUAYMxRjVOeahPERSf1j510d/gwNGIE00nqNS9m8UgjAl5BBp4zs9kHXNXZ1BuuCAr3u7/rmlMI2I2tdsi4oQm9HpvGxj33syAJ2ouIM+IICmLPXG6N5IUGK6wtFDpZsGZa3il0MqatqIc/moWBtq3tg0FV2wrscrLQ2pWjIY3fxHN8TcvfMZQ2BkXSlJAZKkYQuBU12shjHzGpbedexc6ETanIKoTq9iOkbHvWrgFQ/m64yoHX4y4c+9KHjSBhSlQfVwZ5DQxgghPfWAMANj8dAhYVNZ7xH2YzGghc99j1IsOQRj7A46+i+sAW55N61UW3E+J0YzrP3HL8qI7RqPWsQNpjUAep7axS7fkzc+81LGGhuHWI1R6Sac65DMYDmycDUGihfnWORTFv3DgT48Ic/fLvxRKqx59EpPqFtSgN+Ui5GCpLjFbxM7MUrkD5CI1xESn69jNbk9Q8NutrAYsgMhDE354S7BRDkqzn6wMieFVCZs5Mm/7cmpFVYsCZsfIkw+fBQ4YCMm1uZwiJCbRBKxrCpeWtuvjhBuhFOjM0p1okgB8O6fPCDHzxCAEu1cWHLkecqaEhfbJIsy5aPI0Py0e4jHZsFbO6e58m1VR6XGPY3KOxvfW/owD9kELUTW53F54WKM7V1ari/nR6GCOCdQTC2ZLaHSmQ4UIrcrFs4VYyRDQT9lF9bR8bPGc9yJKS02N79+m599YVIai80u0JIRnX5wAc+cK0D8H5GAI5azBYS1oKRHUqmHIJrIIvGM2xlUmpCb8K4Qc8KEzydgXpvrRoZgg5i3GYy6x31hRs05qZ4QkBzcpqY5zE2KWD9yBS6isfQCnJu3Kes/cCJvxlsbTKErtAZSipTbxrKcOhLFiKkMkpyoof6PkKAGyuwPWKFScs9pSlSQtCaUOXoUkuLkv4tRNp32MU4YCnFWktGtBAywoEcnmnM3ado/gl0S6HYeH1mAJRb384OOk1sp7F+W98WgYS6RbsNqRvvOViQ33z85rmQgrOt0ygqIXSN6bf5iPu8nzwofrmVDOJQfhXgj370owcJpBgebeLilwoWwVoMixYKWD/BIFxIiXTNgvMuxZbe2xND69GUn5IRIp4pttp0kgFIiaBTHoJgLtNmdM21Ph966KGbBx988DAMguaB0seUIeVcg2RYawTJKCXXXtyHSD7AgpTiLRTVnM6pq11PMX51tEW2zSKERzK56rHPBejAYJAAhFE+Nq0dIwBXYBq0I0yMavf5jSHNsqgUQJEyCveEhTWG7tWv1DDj2PUgoIxiUYNHq/v3Xt5eCdgnfoQlCLFMmoEyKukqCOaJDBDJI6/NAKDoFoFwGYWmxmvtzjeuEVszIr2xnhwRRilqbS6f+cxnDgRAWloMK+K9GOaWKyFGE94DJKAeF6AQ1TBGxdspM6Xbzt1aAEKJvSJj8nGFGMa36R8IpAgCdF94IVChaAs9BLl1AwxaXg7VKH4RqPd4nSwqOfp8YUbR38Jp753T8iVwQlBzULW1DsUgNZRDwXfnMc6hF2pePvWpTx0IUGd+aiytA18mKEa5Ij49fzYkBE6IUbGS4iz0pmiEioIWSVZpjjmr2q2iE9aSVx6v0LN5NaSBLMs/CBpK8HbKWIOEMozQehkETrIFNuf6oKs5C6X6qu+tQVBu1y2rMzphDFKZ/4b5/jbuUQpeA+D9EKFBgiowtm2bJFTQfi14FaNt7/Mqea6K3p5eBWXnaphnFGhWMYRAIfrAGTrwIW1K+c7KSy/VHzaNBe8Qi7e1BgdAOMEqXAw3l/VwwifLPTMoBOz6l8xJtZFtCu61YhwjXafeVH/rOkcpmOeuF0v11hBYzjlc8OxFADBmgshRbaUjkIDnMwBCk1snTOmf8ABdwLrUj8d4P2HUD+bu+ealosdbhCPxHuGrr3Na2jjQRZ+MH78RGlbBW4za0EC2SCBOA5XNcbMifyN4ZL3G170NKYzVXI8swANNdD1ZbBdLKLGrStpa/y6u+w1CeTyP929WsPX1/taGEjeWITIUIN3cNMzflC63Xza9KKQPgswgQTB0Wi4iHRYGQDSId81o+9vGj3R6C1VQgNEg2t3Hn3oPB1kDNt+tECYfaANFMP5z1nCQ1uoAPBc7RNi8ZuldhQKEQ8igmJQOjqR6a6kbFnofPIvRvX/+5C52LXdVxeOh4HCNB6HrytMp3XMMSx3A+0468b76V9gCpQlV+ld/PFiFlHxqt1/wQLFgWmxurJ6JG2wYtWYGAAl4da+XSEMQmQN9CZVQh6NfSgMtyiLE9UUEsUec3ULFwi+ln2EQEcLIFzkUcOobwUPWWC0o4yEbI/tbvs6gbNKU1vn6FkpMocZkPARtDoyYYrpmKJCtK6OljN0noQjxFrkTl3e85iX2K1jhEzgPLrLOqM2GQXLvSn8M2dgyiMNI+oIIytj4cC5MgDvs04RBvPss+lpouCOKUEbclx5JUywwoSrACE1IWhN2sqZF6LN2YnQCUzdQz1djAOf4xJareX8CFnqaq9/Ws1mNkAD+FXm27KveD2kYCq6lv9YOtoWMzTYW2Xg8fsGzG6O56JsB4lx5fLJjuNc0sC+J6qZiwaYh4N0CDCoGskBMnaWBGX0xLLCEqDEeCFK/zcNpHEpm9ebTc1uUsngxUTUx6K+o41sy6m+LTPL4UOfMqjcWLyKeCeKma7y3dXheEcwcxXBzFd60s61rzcjg7oFsOEp2uNmiqlBUf34gQnO4pq6dCbT4JmGB4IKHit07iMXveyC+ie9ieDMj0I53QwSwuuVV4UMY6lm7Zi1EttCcGZA6vi+HUs9XSOK5XpMBo5bZUCQm3/t2AZeQNrdivXp8zwmp5ITUgXUG3WtZF0OAAEtGl/MIeQphnuN8vUY+z3wAPzkc+9vf/vb14+Egtc6b3JK0JUasuDa8f0MApFieoG8xaoVyJlvCAOtOcAQq9jMw/SBH9hWc7PGdALvTaBsVJNe/94Uw1xRqy1bmAmEIe9n/Ggz+0vtS32Rju5uRgW1jZmzQCvyTc2P2vEMriLlQxbObh281O2d2Oc8VgX74wx8eIYCCwS6y08O2IE3cYsAXli9r4LELf0hcz2w7SKCv+lYWblykE6RBEu15oZicciv4OM69VUPcwNYt5KIUSNL95qjvPibuo+LLEZINwSOA7m2qZ5z6xEPE4E0DOY64bUNNyounqGtwRE6Fl3XfCSNxHxpBqSuS/+QnP7mVR4ImcUesBpO+YpUBgLQlkct+N0XcyXZfPALbKZT1piDf4nU2AN7C4zFaxSQGYNewfrwnDCTA5TfWt+SPDFJGtXpbtowaujVvcMtoNquhfAi4skLoONtyJCEQN8OPui6ZlS0lFzK1/b0njnuu/jPU3ZO4/PznPz9CAK+jqBqJkw3oO3YRJ6kHgrhZgbMElKofUG8ySzjFpYSyOXzjWJDMghHgDxSI7CGRhQHpYPNujbUV56HIWWG7JgbthBThydd3TrVJfsmq8YxzRj/zl7FAXWNR9hZ4pOrS3OUwEFeWZK42nLovHZVFaXP5zW9+c5DAJm1blFU3kQZ0OsZRpNozBOmRLdmFfXBN8eIV70M6l7iAuT3cgY8IHcZcA7WNCzYhQVkAgse4IBdjX8JFad5rTAc4ELU9MNu9+rOr15z6NrI9sCmkyCb2wKYiEkQjM3Pq2U1XbYAh6+oJ0kjzAPXd308npyfc4DDe3/72t0cp2LdoKaOy7BaXMH1MiiexyNoJCQaSVoFvBrBp3JItGcB6ANIDipE+8VBaVN8QQ+zPkDPaXjsTD42wZ68ZOa9HDBufwoWAVaAwxrt7Xbt+fA9RcxTjoR2O0HXrCtZp3RCx+8mz9eAq0LcrA1Q/cDZQBoDEgv7aZ9AZwmE8v//9749ScJP1HbpSixr1t49N75cONhnQkgJakC1NNXgsvsUzhrOlY/EryE2hGE3jNZ9+MkIkr9eN0xww/pSuAqgt8lk/vQf+Cf5ca0DufIjzRS960fXolSKZcEIO3dc/o1zvl69vsaZ75C1rYFzNoZ8lttowVDyNATpxlAwdOMFjIrLW073D8R588MHrZwN99KnJQ4D+DtIcnFRVw1gtmveCJrBFAATO26ECyD3HQfFL/zymdgwxb8b+G2+/Bk44g1i1k45t3UBayat6vXvze3QbwglzwqBQRmHJKHk1h/pLGTyu1wwZQmzYwda713jNu370Z+5bplcNRFQVpHi6lFA6KzM4kPuhhx66poFNaD8YIf6HAEEQgVM+yyUk3sibwCrmS2A8QTuCU8ps4eB0U0bGV3/CDKK3Z/d2A6g+Nx5L4zDv9UBhyZh7hDthglUIhSdk/P0tLJlLSgP9rZFyoYsvqlQ7IFd5e+0ZOMRTb0HmMhSZQv2Qnb+XtPrbs0cIeOSRR47NIJ7ioESTF0d90TKhg2VMNwNgVcgLmNvUrvYWAAEIg/FsqrIGBFnWo+uLwQo7WDJjYzS8xDjSsvpYbkJhXROincet1TvNi4+oZaQkikpx5NX7MpnWwRgUnxSSmqNUkDHI+ZcvmFfKxmGQwXTxspe97HoKWgWzts1DhnatyD766KPHt4Txqr5KHemIE4B/hzW28rRKblJbpNl4h7kyGBaogGHyhMMD609FTMqUYOXIGPKe4ZPryxxAKOMDtymB5xh/0yneL5fGFcRWRoCYtcb+Bv/Sz8bgeYyJZ1OyeL5GyWAVlOT7yFzj+xc66gkKVwv1DqA2h3gM49Pf5bHHHrt+Q0hKdiI2r+94tH+xAoqQkDqKVOgQbIHWhXX5t5QHOantsn0GlCA2NsvvKd6GTu0XufobwVOcYSSb64NiyEdwCGrz45VI02YjYivU8/Gw1uLsQbJkjAlfWpacpKVbuWOEm+/7W70DOupLOooI6iO59EFTYStZqBEUWhnMwccyADFL+gTG8v5+ebCJ1EEdghcsWAyVPtW+X7DbOBZtl4rwGQJC1TNgT1hS4PExMsQQN2meeMXGW8pbI0hI5kZwCJqQYI15lGyl+fGq5ifkNSfFNBkAjtTa8v4UwgCENxlSbfpdmaXg+l/S6nMEW5iCvhyDwTVX0F8bH0HjiEd4fvzxx299lbpUylVevRUrdQK1ebFx0x1VJ5ZOUeoFWyzCCQhAeokjSPvyps3zCQv5gkyNjcUrTlGePQ3ETxpH4UJAwjIPCs84xE0CtyHDeGUeDAC/6NpcfEBVRsR4hACcwDxSWO/hM/txsuUmGSiD4lCMtytnsDu7BPhAgKC+eC/O4wDSLSVJjJMVuyJMCUs5VHyXAUjzVtj6gyxYtcpgffUcxRWeMHxcQF3cOAmj0KQg0n0IQWE9sxlLXrUoIATxnoTIUDdONxekk4w2/dw6Ps7AcSgBL6qf5mccGQcu1X3pnT6ai9TPva2rSFs5oBCCxx2G/PDDDx8GUKzH/LewwrN4xBKYHaxBWDj4RuYIVwm097sndj1ZjZ73Eoz/+uVK8RCJweU1kZ1+pZL1bwt4SWTjq3cIHYo8ve5v7+MbWDfDUj9AAmUrKd8RMlU62ZLMCE9ioBBSe8YGfZqLlJtXy1p8MnhTUmcmkM0Nuwj3UQhS6SveFw4oRPwRy5RPl5Eug2e1yJ30qEktHCN43hfrFWvE59ph+PuRaEhlXkJOghXrEohQsCiBzDZHx7fqLyGBSIoQhhaizbX3KF3chojnzABXMp4QsAUgY0KfrS4ixzy4tTF4JHwLQ7sOSONg6iLfQTJ/97vf3e6/VfPfJ1myNAzEssYWK4cHU9uGl5tA13P1CgFqjGWynqV8J3AUTpDSnpNfS2XrB9kRq/GIRSyVNnwA9Bp76wdCALKM7AqRvE79fgtCnMY+Aq9n/DIPCtX37h2Qr8wmpLUbKaRqI3tJLkixswpdZQCQ8NgNrKEFS1+kNglkK00WwqrBmSumzUCQE3Da/S12IDwpk2IJx7wc7rTTtwRQisMA/INHtQaC8bnDBCzNg0zNB9eAFpSrOJPgZB/1kUywbjGVA5ABCJfLt651mtrVRm0B0iBy0kCoYL6tMZ4DVRnV8osUvEYh+6qtdPlYz69+9atbxEX9Xt5N4OKjev+WFFk4S27gPfIkhjaZc9q4O4/KzhsP61NG4tO66ueE1IKwbSFAyiWe935j9dt8fBdPCmMQ3XeMTDEnOVBK6+RRYqpiDYiW9WD3yFdzFjrMEeI1BzEfgiwPqS+G0DO71y89hQxdpaYci+JbB4Jug6z1HgYgvm75FMkRHylVemGbkUVLhTZG8pBV/lavCNJYDnIyDJ7uZC+Bs3gp6BK1/s5DtoADxRiNSpkY3PwoazOgiLGQsOujUHBtPr3OSIQVZLhnZQwUjkxDj5TuF7PHtXCm5KLGYo3FdiEI4siies/5P6Rb2tx84nyXX//61wcH2PRFY4WNrQN4z5kzsYqnSPc2fZNLs17wvExa6dQZPojS2BmAok3vY8AJjBH0PkjMyBAuNQfK5gkyEkITS3l/8sgAwDdCiBshk2C9NTEMioc6W3KGQoii+TfP+mpeZTBSUKEVIRdmMPwtwtWm+/VNP1BCnaV593fri/BffvnLXx4GgAPIyRGnriC0NiwYEux+gCoeEiTvlrr0jGJGEyWg+hd28ADQV18KKwgMIfAYHiJGiqmKJTzc/Aha/UKIA8uM0CaYGKxOQfkbwijQHOvD/sMaAISUwSjimCP5qGMkO8hCXlg+PibdZsQ9aw9DJmRe+si5c6zLL37xiyeQQNbbRC2gewykjppAQkTmQHwTBTGEWDuebycKAjCU+ldDR8LwER4IoSCQ9JPgIBFjkxcr29YOVPIq0L0hgHfYgxemhAjxWHbUVT/QDw9S2du0tveSTT/kAkUQZCnbS17ykoPtK5gVIhWEassg1fk55+4ByAAgV/LFq44Q8LOf/ewJXxYtzlK+1Cvlbnw/pzdYvvSCByBZ8nKExYQQTePKPniXUEKocmj1bHEYFKqV8wLVs5SPIIF/8Veax8j39DADqM2OKVTs+zgU9OIMu0OJD1CkLIZzUH7ybENHKKMHu4vQbOsBrWsJOqTYYTehAAAct0lEQVRg+OonjW2z7/LTn/70QABMGunZjZeUxOOla9I8dQEw2fOUX9smlfLlrsqueTwvVwTBNRp770ETZVPkkOeyfFuldsvWGHoPdDMWxC4B4SDIrtoEIkZRvBmUUjaIXYhvnNol7GXy5I3DINQKPUv0kh8+VF+KZcLgElFIcD7CLkT6zKW0+ggBfS4AMcCWeaUDDWK/9IR3glLCkncSolMpTSzW6gADL6h/ECrl4/GUrCytJkBpGYtCEujEMXiCOKg2IAyYrzTQXsMydQKWYag28iYhIFlYh3DFYTB92RAiCTWk1eaHEC6H4eFLOhmOrAaHyTgdYF1ek0FB5ubi+w+PNPDHP/7xgQDivBi4J2w2hxVra8eqE8JaIgNg2Qovdtko1QZKC0I6GRfPagxopERNUUhQbeXSC6FOzihR10a2whggFmMH83J5lbUt4NQHcoorQQQGLGWrPx5M8V2TIwO1R6BWz4Abk1zxizV2NRBomQEwDoUx8hTCfVayDOcw1B/96Ee3Fq/UifWvUJZ0sS4pVs/1Y8JYLwKiQiXWrnGZNAYulcIxWpzDnrIFhsCDWhyvobAtie7+vUIMWMQ96nsLOtLOZdi7OQTyOcKSK/KRelEC/mIsoSqvhQI2sIQ3xJq3K6fLZPQFfcnCWDIolUvh9ErSH3jggWsh6GwAHgKVCWUZr8oVSMUDWGsLZPX1wSoROv3hE0JK42LGwpFilYmbE+NaD10ozTAYQ30myEUOxJCAwTTmLbXEM5ZAehZ6gmlwq4jG43nzOgieEkdSoVTnWOJKwer51rBZippG82n+zY8DSbOhqXL1pQ+H9qYPUGyOKzSwZEJn4cqM4LpJYtby4p6RroChxrA4Ft6Eq28zkiaf4ro6458xsGgGwgjFagSPYTAARaL1EN7LYEEqtOt9rHprCJs2Iom4TNdgthRLKIQszcW6hZoU+tKXvvRauWz+yUGqTX5SbqS711DIfL0HcTzrn0fnPDbYcKrL9773vWsdALTyNhbOACi4dixw2T9hLE+gUNBust0XH+u//uTw0ILVI2muYp4QxOiEE2iAuRO8eUGcZfC8cw3yTNKwcIQQ/DYfsqlN8uurZhlA70nnIAjiXV8OsKinlP758kjy3ZCAyyDO6zRC2qbLSux75E8GdhiAM/+7KdTfig3L1sEdq07ImzKJTZRkAYSNXXftORUxi1Kd48kWCboY0lbepLAUvzxgwwuewsDOkNnYUIrAGWVQrRgkVDmAilBKJSEqBJXWMRwpKeSRvTT2psz7hVGNwUi3oIXUKqBJoSFj8vJRNec7l7dc+r+BKbicsE7sxm35ElzwtNrwdpYGksQ7QuYlC69Y/0LYGtKWjntefWA/57ckjpExoq4ImzRqkae/eRvv0e6cJaSErSa23n7qI2H3k1fLbJKlYpYsh2Eybsi03oq9G6/9AN9JsFVXxm79jILxNaZK41YQCwP2NqTSPXN8Q0gPqMHbB29BywdasHzWexkMrwJxPFtMFPOaDMslZHVuFbSeWQTgabWvzRaIjGN8HABZ422yCcizCk5xPIsRmaN5SCHVQLbWURuGRT7mSHbrKJFiLF8IFT427KV4SGB8xBDBI1fOKAuBBDI5nGmLaULvcR6gfxypmIEgtBhooEMP7XssTcGHMBVxMGtWS+BNGlPvGdkHzxSzKa37YIv1LrHUl3CyylwPx/CRWeMIBQwOwUwJ0sYlYbwPpyATexvqJlCUkaqHCJPGQdbqJ0Nr3K4ZgjlCoV0bpSpKUbYsxOcJ1SZ2P+eKPt/4xjeO7wdw7JqXMwBkodcJ45xXEsIKU4GIdddm0zXKE89bVG1xCTVsKY738Q4KdOXVvENM5v1LEqWC7kEMnAKk9tqWqzq91Io3yixwJUimIsj7KVZYqj2DwjuUfHsvA+j+kthSRKghBNkfqH9hXL0/PQb5vh+5ufQe3TTOkW5/7WtfOz4c6jsAkDc1AHn4wv5uHfMapAN5YtUtRI1+47yYyUsSan/zZkUjMZeXUtRmAI1ln4ByFsoZSoIiPChlvosUij/rjctbIJ3t5sbsfcUj3qVvjkDxkE1s34MbPVtfQktzUSm0ZnPZymjKLfMo1re2DKLT3sjz7l0sMl++9KUvHQhQA19CIJ6Bkt0bsMW5dXPxlgfyDFBHKVi0FEjBx2IJaL2TF2/enyAWcaAVBTfeGiQvRyhlHxAFKsg8EMReY/9i/zJ6vIeiVenMo9eLApACXzFP30BCDvTBQNYg6xMfQUQd7vC5zpDh/E8v8LUMA+oc4917773Hv40Tv8ByE9/4rxjDAIQG5IXH8wZKOnswb5UBEN6SMSiE6IjDagWNAVXqp7naYVODZzj6Ff+3ukkRQpKiEbQB/eYIgh03w9y7349duEWrNTpzoWiZR/3t0a7WQj7LT+xtMMbeU7MpxaN0eT9uBSkYI0c8HLB/GAEOCUfa1aKkFbZ4vVZtkvadSdmeQ+cRm0JtcYknNjGETxVuvTNPALtrYCCXEeMOKyjoxMAZCP6wKRoySuG9t+Vln/KBDtqZGw6yW7l4Afg3n+a6EK90a0eRkeIEW02sT+mf/X2bPd6TitKt0Holgf53cBNhKWsAu08OOrWjrI2tiA7GL/5ujAbxGO1CN7bPy1u4sqmCCYGvdzNi1TpepthirmC4a/0IT1s9VAFlJJsKZthKtRnAejG2X982wnAWEGw+jFRoM9/6EF5lT4sYiCEFqzvk9aGA19BbRgIpk2V9QPDL+973vut/DgXPGDlFY5YtVkqxRiI14ynLVkHvxsIWLX7uwteQei7BN2aLEZ8pg/KW1ZuTRVsHdHLl7bIT4QRxbGx9UKrzDM7k7zN4Ac4DqsV4yMYLZRrCp3XLwKSZZNf6yfhM0p27jO1D6fRVn7KSxu85IUHR7qgDvOc97zm+IWShl/WAVKwfHCGFwkCdU77iCKJh4uuJyB7StF5BSaASWjAAPAAxQiTPSkdkVwj1zThVC1OWFKv3GKQ6fq+lhIoz+3UxkEOI8IFMVclNL60TucYtzui7a+apdECe9kWc8qFgNQFEW2bSWDbTGFzPXt797ndfDYAHSdEIlWVtjJZeiJcWbPIYbNZs0toiNpvu1J43CwPiJLjeT/QIH9qucK2D5wghPL9nET4pmLjdHAgPam3M1x4iSHN5vY0daCJE6F8+fpRh78rKFIMXif/IWn3YyMFhaqPkrHy/60U+a7+yYkjXEPCud73rOBLGUpSEDaQjlUDZwZYcERTQtQUbGzPI1pmdb3yTupkDS5UL2yPQB6je+ZuvvLe2YimoRiC7plBpIiOm+J7reXv2UrDa+XAJXuIQqrOPy09WPrul/WS8ZdGXEfFqaR4HVdhZEo9s9owQKP7LLBz0qc3lbW972/W7gjVgSecJJgyGgajwGGSPxQsFZ4a8mYDii1iY0Hrfpg8EqB1oXQIoRrZQ88J6QX9tIA8GvVVJPIOSFFkYjrRW6ifUOe62mzc+9dR1ax/m2T3wL3wyCBAudOEeNuJqn1x8ervnUqTQXXthC4L1Xr9COUTH4w4Df/3rX38NAQiGFMHD7pskj4MKBmT1WxDpns8BiOOgnpCRMfEfWcHYVcC2AESoPdsCEdglgu7hHDwdkaR889UOgi1nkOIJHdDDsa6+mcsZfkaBF1ASZCEvm3BnpyJvCOdIXB6/e/qMqHaQT6Ym7DW20z+4HkQ5MrNXv/rV1/8XAHI1XDjh/QtRmwkgSzx0c3tESI1/473YuDETdDFEnKE2PuuGkPJwkEcQ4mL3jSGF8lkBiCA0mAOWvLUCNQixniGoFvYhjtbXr0/3MDRIR/AMIVnaW4G2ClpIsBq/Tyn51lCKBu9erwPQ48qzfqHQQaBf+cpXHgaARLXoc1YASjbmJOBND5f0qYyJ6SAeH5DC4Qxes3yKQIqEArC4BZcVJgRBdLb2IGugFFU798+lY2i2JO7MRaynPu3W+YoaX8nWWnyhA6MUpvApB0cYLyPgvf6buQ07cmf0W+mzPSws4lib5UH2g2y+5jWvOT4ezgC2QAFmMcY9zdu9XgsD4BPjhAA8dcujFMjKjcPjhAb3sWFz3NPGFraWTwj6l4kIRypv4rvzd0hfcxaWVBO3KljI2HTPvLtfdtAZv451LVqYgxy9OYJ4Bu4sBgXJGKru+bo+X+DBSJL/OZRATqG6tYj/OBjEOBBAjCAAaRfocqKUwj3suWW52D7v1gdDSEig172Ey/BAOlIp9URQpXD1wcgIbMkOy7d46MGLVSwx+yVqPHs5C5ngI+BeLg/lmlfhICPYTEF43T0La2wc4SEjaF1QzMYOxftHWIsme1xueQGusWFSRqTAdnnVq151fE/gllAVNxRzes9/8CBkVS0Me4soyBtr62rjRC6uPeTgaWIa5W5VDCwzqjO8LRPeXBr6LNybz9YYoBeDXqOh6DUAGQEESLjdYwCFAaGm92Qm5KJ/JC4j2PDla/H2289Tdtu8OeMW5M6bdLIzYVS4WMc6HD4EYH2sCsPlmU3c4YM9C4AkUoyF8WzsnLARJ+0RNDthPJlRQSTehcz1WhxFKN3bUIB81gYB3IoipcrlhRbGKIRAG/OAYvpdQlqbikFlBfs9BY1hP2BJJuNsTPKHuPuPOhTjMooMYNPDzSIQPIjpNX4EaZWjL694xSuOvQB5pdTHZk4NFWZ8ZTyDATEEsAJBcHoeK4YsBL/5uTjPq0FyY/ReyqlPBBFB2lLrxsLmAsGag9JvV+/xXCROxU9B6MxNZDpQi4zWCHsPEfQRdevGV2QyZK2/3s/DWwfil+zV+xnE/vuerScwEmk2lFYvUBVE2A/ZvfzlLz+2g3vTgcazp0pX9tg4iAVfCJVDEL3P05EuBrKIoWAC1sGoYtTZCxEcaVNC8yxYRBYJVpaxBziWaLZeSoNGPUux2tbvFrYUlMAsg6ovtYA1Kgak/nBOUZV8U3hK/uMf/3gonxe337//CQViQM7QobZ00rygidCN3Kp9HAYAPvdMuXjJ01KIAg2+gL2CFdUy/ajdL6msX0SEJ+4JIoQFF+DFwktCkvZs+roEEIsX0yltryCyflX1fDyLwoWN+tF/81NHYFDY9hLFlFwmoFC0xScOUF9b9Ol+46TIP/zhD9dvald1zcAzAEaBAwh7vuRKv2o20sYlnVDp4AApBGRL60AluJerqgZ65pw68ZoEfEYSBEobZIuHrvJ5tUnz/J5dZYt/DLX2izhiLPTpfRAPEpunTR5l3DMy4TvqAj7Zu3IQ0jLo5pABONlrj4AHImlSVjWL5JsB5P1O9oB2e/2MZsN2+kEWt0/6gqiqqYz7qAQunGKLJrg1dZ5BGAY6x8Bl+psm8ZDlCohd18YiYN4rfVIzNzZDRaywbIa3hR4IBaqRUvdtMpk35JKBiKnWssWhnmlMsbg26gFlAb7mpTH2q1saewm1On7Qn4c70dt6VQsx/caDYPrAFXAIqAEFGA0UZKSX1772tYcBYIk6XkKC/SYIBY1l22LO2QPE0a6bLi7kr4fySOEH7C+ZsaCd5zJeHpbAK8rY3GHYXSHTZgc8oquzgIwPcjFKtQ7ZAmepvZJxBpjyU7qvdGMAHEm1rjlROnbfl3cj3biX+I5rQEJnA3zbm/bWzPtxj3Rtnpc3vOENRxZQYwtJoXJSxR4KdO39ZezrAQo9Jrpp3BKzc5wXTnpuT9RSuvIz42O4BIP8IXW+bk0mI1woAtmbkEnYvIFKuArBWbuwxEDJgfcbP8Xv17o2n9Bl09vmvps8av37iV5ZwJk7IX/pSKFI2EAcGRmus8Z7rPuNb3zj8R9DVPcYAgUr/66R9OBZCIgQeMTepYg4BSEzMqlQfVIkVDhbsLKndI/BIoMUlwJ8tq6/16AJUe0e/2h9vsIG9C+pI7gNTe4JgY6Jdb9xqwbu1784eVR785JiZ9z71S32/lf+zfGav9+dc2g9GZBvUkUShQuGIPaTLT1d3vzmN18RYDcQlknyNMIDiSmX0pqcMALKkTywzIPETc/yMIpiNOaTEHg3a4c4DFWKVl95+PlgBhgE27yVkhnschbZBCTTljz2WWHD3BOwEABuFZDsEaijMILSvIo8Gw6gFh7COBFmHMAZCmQQ84cSFG7TC8m9vOlNbzoMwGSWEIrtm3uDZx3VfkNBr5u0FE+6sTuD0AMxERYwamViDBbZxPQtmvKROaXZ/UgXjzFPYxMAhfNiKEJgjXlOKw9IuTtogjhCtq0KZhRgX5URweQwXTe99pX9PJnT0UXzWpSWniN/yDLkWH2scddPBnl5y1vecq0E1jE2fS5vSlPEc2xSPEvpvIuQ9dEVIWQsiJDFLGE0h/pBdIQYWYmQJQtANO3U8TbhisC3+EIg1rBkj9dDL2kpYihsdh/0X4srd/Cs+qi+YJOJ8VCutbRW34tcCJAVqRtAHiiAC+3GkYyh9ziQtXuu65VoMwCC1ukVIu4OLi7pa/Fr8WoISBGPSTBiJg8kQPETulhk902e1e/O126jagcehRyCR/YoC9KZP6MRurR3H6IwAnNeZ6ituoP6AjkQtC/J7Cq0QlwezQjrGxH0Ma41vp6jSDWaMwqsc3CczZR63gd3Lm9961uPzSDWsqyfl1P+5sFL5nisGC/m8QzPUxgDYRRye2kmo7BYOb8KIE/Y+Ah1xPYD3u6MFzJZJyM8I9buVVAeGSwiUtbyDvsdkI0s7DOoCIJkeT9yLexxJung2YHIClpTsKrgOgvD3hDT843lmN71UOimWiwcQ0bWeIj4oaxLsCZrgIU8yNIV/LDsTVXAPuPY2G2xm7EsJO/4m4JCiM0qwKLYvwUSZwTMc0MahBKyoISQ0/08tx/1BoUn6Sa0bT5+GB9OoNwOGXftzdn7MiB9nsv09S8sOA0MKXvv4ADrcRS1rBgDp9D1/rXITZvO6R7hs8prLXqOoIFDSEG5m2GAcwcrGMjyDILlVZ63ti0mQZ3mzluFkLx2c/36M572tW1s6dXGd/yDLIQQMkCCe2aRRgq3BJXHQz9OCUlUDFUA9bmIA913DUcdYEkXoS/T5U2gnSWfs4OdMAXrR2aQEEC62sBCdX1aBM/F8jH6FIj8CS84C0GBYJkFaG0ee7IJy1cJtHvnxM9Cv3luhiPUkJE51u/yHWFjHeDwwLvq6lnZ5i9MaSf9FWoYBPaPI3W/uXddxTv+h0wfpWBWa/INSnCstPfykATVotcr1/qfzMNZvgUjJIyD8IwLQrvf+JshdI8nn421/rB8hrBX28W4BGEueVRCPn/h8qKK0CVldBVOMmyx3ZUndoUavSdsLb+iB/019tYXzuGRsdmFZRTdFxq0YSjqBJfXve51txRkQJMC714ve17Ste83WQoVH3mwUALG6//s3SbPKI3jygAoX59rVM3nTBRVDyl/Q532dgUZwe5mbh4Ors0JepgTBSOpOA4UIGeG0/u8tXtqBWS5DsQ4Vj6cDsoxekgJcTk1WXQ9KoEasEgeQbE8dZXbInZTZ8vD2kuLTJbHWQQyRyBL+BYdhAJwuFxBCDgbSmsR6+s3xe/mirloV592BZ0PkL5RAIdYfkP5VzY3282M0Dprg7RRfs8Lj3iXaqaNLHqAQs2ZE/UM49F37TcbkHKuQXCEyzve8Y7jW8KUSpEpUC8nrhOFiSWDFI8Ablwz8VUGL2kcE+O94hxvs9D6AWEWS7mMUsbCy7QHgTaSpFe8BTQ3JiZvO9fn/TYk1q9NJFxg47c5Y++LVOLuImvr6T4+1DocOfcFFLhHcyUz4bH+PYsYCoUro9YrHYQEh+FlAA4cYI5NnpWLZyCT58sjVc+6v8awhEkGgDSuJTdmfW9IIbRFhCVVPFoIAcmgfNHAmP4ljX1zdQ8CxR1ab2vzvfspe+Ff4Wfj9LWqdld32LBmLV2VtCEC6Gb4vipmDc84MqNFPHKjA8ZnTCGIIUgRGcBxBP3tb3/7cSycsBVSQBuhngdbFJAGQQ+wtBM5w+Faq789LxRtXCcs6V9z1j9uska34Ut1TQbghDOjXoNsDjIB1TKhB6fhcebpbOCOb+44SvPfzAUEt/b6y9B8kWShx4FToYUSvcYrGkfGtaG1+3RK8Yt6PZ8sL+985zuvB0LWC+TC4tbG5AbaMqmzcRAESxarFTFwDZa5KZu0ZRk/5BAClDw9v9mDOA2um0trAH123GybCmkJyqd1eKLdOrF4BSzjwcpXDvW1hZtrnL37mnrQL+wwiOTna2fInUyFvDUgyj2TaOSTzoxXe7K0bgZ1fEMISwGzLNpieRojWMKnLVLDCFgjiLUA8LcTghhrZMYQz1aR6/mLOjySx1pPinCebk/X1K75+UgWgxLOHHJ1wEWsR2pVRpHd5QLi7eFldwYAvrd61zp9fkB/IN0WM/2QmfE5AmM/F8PwOuQSH4IeBwd473vfe9QBeNDmqKBxY8yy1yVtO/imN02+1/W1hxSgwhI9oQTcryLl8MIFxGCkkEO83szCHrmjU+oMkMqJm54h7M0KzodbGQhvP3MAyKY+T+HkvIpZtFF70C7ZyMiWAC4ibhuGtk5Dlk8gfnfrPAj0+9///mM7eEuzFLYGoOIF/rHuNZ4mCxLX04UC25ZCgYlCC8pUfDL52p2NB9waj8JdZQf1gfil+GsBZM43bha0aEfxjnRzhC3aIMzG3dQTcTsbO2jmuSqsviNYpZV8IIx+uq8ewvGWAEM+IUZ7huj9w/k+8pGPHAiwAlxYXXjxN0sTB3kED14DWiKSpzGqZfib5oBhiCReIn9NGqmBNCCaYYn9BAb6KH89UGg6C7fxpcJbAneUbEPdEuj+LuNAuNYREGnKQ1QbR/EJIeRwSKRnoKKUnAMuH4DM6gscbIn4Vef33HPP9XMB0hf58BnaQN4aDKW3gA0JiIrclxcaoyvFIy0WY5z6Fjo2DsoACNSRMkbMgHtmP0sPkj3HECDApqOgFwrIz53sgYTiMW/DKexniNvLxK0bSiGbtozX4IQ0IY/s6685yTZ6zTFlRevpkG2N9ZDXZz/72aMQxIIUdHwlWpPZFJCSExALQ1ZkESbS+ypS+7k9ZG09nyDFZSGJkJZDEGZC5on1RVlCCcVivrx8y8E8dHfRKLerE0aOmW19hKFCKWcXzdXVeAwQX2k+/Q1VbEB5f79tdZ2OwyDK0tnlTsLGpqPqEK1JlnH58pe/fNQB7CK16B5WBl023sB7amY5Qs/4AcV23eSc+5qiN+YiYV1bPIivzRZCsHb3eIcKnRIqwSCOlI0MUow0iREYVxhQmFEqZgQMoGvGtp/jY3SQb41uPbRnbbJtGoeE+iCp0MhR6KlrY1EuHdBbz5kL5GTURwi/7777rucBeKYiT504vizOi7eKIQ3IYpsMNGnhK9hVGkV7drMEwgGDhNsikEyowqO68tbapKjGlvt3T0hyeHJhH0xLq2Qm0DCBpQgHPHOOrXr2vJjPuGzB1qd/xMFhKFMFE6lEMleJVSQZIl4kVNJF/WZ89YPtCx1LqCHOEwpa/l+ATk2OZ25uKmURH8X/hXLFGqlWE/JtllsAIuSe3VjfPDb+tqiE2T2CF64aC+y2OIJSvmZ0WHX97OlZRiHFFOo2NeXtPmuQQhx1gwBCS1f1Bqdv6tO3fJGxEMUAIBhUlObtYVPGjwRyzua1n5Mg473KEBiacQ4nzgAWylgfsgaiVKicfDU5cUes2XgHlkA1SAbFSJsFUwiBtLja1L5x+7AlTqKYwfu6Nt7CtxJ3c+1vH57E0iHW8hNeWj/WKk77Xv/msHshEA3c+5h2933q51xthHDJG4FkuJzQONoit8r09ilah3E4hGzJenAlxJHO/w8kCjh3x/xw1gAAAABJRU5ErkJggg==`,
      (texture) => {
        this.material.uniforms.uTexture.value = texture;
      }
    );
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.normalBuffer);
    const overrideMaterialValue = this.scene.overrideMaterial;

    // Uncomment this if necessary
    // this.scene.overrideMaterial = this.normalMaterial;
    // renderer.render(this.scene, this.camera);
    // this.scene.overrideMaterial = overrideMaterialValue;

    this.material.uniforms.uNormals.value = this.normalBuffer.texture;
    this.material.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } 
    else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }
}

///////////////////////////
// 2. HALFTONE EFFECT    //
///////////////////////////

// Halftone Shader
/**
 * RGB Halftone shader for three.js.
 *	NOTE:
 * 		Shape (1 = Dot, 2 = Ellipse, 3 = Line, 4 = Square)
 *		Blending Mode (1 = Linear, 2 = Multiply, 3 = Add, 4 = Lighter, 5 = Darker)
 */
const HalftoneShader = {
  uniforms: {
    tDiffuse: { value: null },
    shape: { value: 1 },
    radius: { value: 4 },
    rotateR: { value: (Math.PI / 12) * 1 },
    rotateG: { value: (Math.PI / 12) * 2 },
    rotateB: { value: (Math.PI / 12) * 3 },
    scatter: { value: 0 },
    width: { value: 1 },
    height: { value: 1 },
    blending: { value: 1 },
    blendingMode: { value: 1 },
    greyscale: { value: false },
    disable: { value: false },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUV;
  
          void main() {
  
              vUV = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  
          }`,

  fragmentShader: /* glsl */ `
  
          #define SQRT2_MINUS_ONE 0.41421356
          #define SQRT2_HALF_MINUS_ONE 0.20710678
          #define PI2 6.28318531
          #define SHAPE_DOT 1
          #define SHAPE_ELLIPSE 2
          #define SHAPE_LINE 3
          #define SHAPE_SQUARE 4
          #define BLENDING_LINEAR 1
          #define BLENDING_MULTIPLY 2
          #define BLENDING_ADD 3
          #define BLENDING_LIGHTER 4
          #define BLENDING_DARKER 5
          uniform sampler2D tDiffuse;
          uniform float radius;
          uniform float rotateR;
          uniform float rotateG;
          uniform float rotateB;
          uniform float scatter;
          uniform float width;
          uniform float height;
          uniform int shape;
          uniform bool disable;
          uniform float blending;
          uniform int blendingMode;
          varying vec2 vUV;
          uniform bool greyscale;
          const int samples = 8;
  
          float blend( float a, float b, float t ) {
  
          // linear blend
              return a * ( 1.0 - t ) + b * t;
  
          }
  
          float hypot( float x, float y ) {
  
          // vector magnitude
              return sqrt( x * x + y * y );
  
          }
  
          float rand( vec2 seed ){
  
          // get pseudo-random number
              return fract( sin( dot( seed.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  
          }
  
          float distanceToDotRadius( float channel, vec2 coord, vec2 normal, vec2 p, float angle, float rad_max ) {
  
          // apply shape-specific transforms
              float dist = hypot( coord.x - p.x, coord.y - p.y );
              float rad = channel;
  
              if ( shape == SHAPE_DOT ) {
  
                  rad = pow( abs( rad ), 1.125 ) * rad_max;
  
              } else if ( shape == SHAPE_ELLIPSE ) {
  
                  rad = pow( abs( rad ), 1.125 ) * rad_max;
  
                  if ( dist != 0.0 ) {
                      float dot_p = abs( ( p.x - coord.x ) / dist * normal.x + ( p.y - coord.y ) / dist * normal.y );
                      dist = ( dist * ( 1.0 - SQRT2_HALF_MINUS_ONE ) ) + dot_p * dist * SQRT2_MINUS_ONE;
                  }
  
              } else if ( shape == SHAPE_LINE ) {
  
                  rad = pow( abs( rad ), 1.5) * rad_max;
                  float dot_p = ( p.x - coord.x ) * normal.x + ( p.y - coord.y ) * normal.y;
                  dist = hypot( normal.x * dot_p, normal.y * dot_p );
  
              } else if ( shape == SHAPE_SQUARE ) {
  
                  float theta = atan( p.y - coord.y, p.x - coord.x ) - angle;
                  float sin_t = abs( sin( theta ) );
                  float cos_t = abs( cos( theta ) );
                  rad = pow( abs( rad ), 1.4 );
                  rad = rad_max * ( rad + ( ( sin_t > cos_t ) ? rad - sin_t * rad : rad - cos_t * rad ) );
  
              }
  
              return rad - dist;
  
          }
  
          struct Cell {
  
          // grid sample positions
              vec2 normal;
              vec2 p1;
              vec2 p2;
              vec2 p3;
              vec2 p4;
              float samp2;
              float samp1;
              float samp3;
              float samp4;
  
          };
  
          vec4 getSample( vec2 point ) {
  
          // multi-sampled point
              vec4 tex = texture2D( tDiffuse, vec2( point.x / width, point.y / height ) );
              float base = rand( vec2( floor( point.x ), floor( point.y ) ) ) * PI2;
              float step = PI2 / float( samples );
              float dist = radius * 0.66;
  
              for ( int i = 0; i < samples; ++i ) {
  
                  float r = base + step * float( i );
                  vec2 coord = point + vec2( cos( r ) * dist, sin( r ) * dist );
                  tex += texture2D( tDiffuse, vec2( coord.x / width, coord.y / height ) );
  
              }
  
              tex /= float( samples ) + 1.0;
              return tex;
  
          }
  
          float getDotColour( Cell c, vec2 p, int channel, float angle, float aa ) {
  
          // get colour for given point
              float dist_c_1, dist_c_2, dist_c_3, dist_c_4, res;
  
              if ( channel == 0 ) {
  
                  c.samp1 = getSample( c.p1 ).r;
                  c.samp2 = getSample( c.p2 ).r;
                  c.samp3 = getSample( c.p3 ).r;
                  c.samp4 = getSample( c.p4 ).r;
  
              } else if (channel == 1) {
  
                  c.samp1 = getSample( c.p1 ).g;
                  c.samp2 = getSample( c.p2 ).g;
                  c.samp3 = getSample( c.p3 ).g;
                  c.samp4 = getSample( c.p4 ).g;
  
              } else {
  
                  c.samp1 = getSample( c.p1 ).b;
                  c.samp3 = getSample( c.p3 ).b;
                  c.samp2 = getSample( c.p2 ).b;
                  c.samp4 = getSample( c.p4 ).b;
  
              }
  
              dist_c_1 = distanceToDotRadius( c.samp1, c.p1, c.normal, p, angle, radius );
              dist_c_2 = distanceToDotRadius( c.samp2, c.p2, c.normal, p, angle, radius );
              dist_c_3 = distanceToDotRadius( c.samp3, c.p3, c.normal, p, angle, radius );
              dist_c_4 = distanceToDotRadius( c.samp4, c.p4, c.normal, p, angle, radius );
              res = ( dist_c_1 > 0.0 ) ? clamp( dist_c_1 / aa, 0.0, 1.0 ) : 0.0;
              res += ( dist_c_2 > 0.0 ) ? clamp( dist_c_2 / aa, 0.0, 1.0 ) : 0.0;
              res += ( dist_c_3 > 0.0 ) ? clamp( dist_c_3 / aa, 0.0, 1.0 ) : 0.0;
              res += ( dist_c_4 > 0.0 ) ? clamp( dist_c_4 / aa, 0.0, 1.0 ) : 0.0;
              res = clamp( res, 0.0, 1.0 );
  
              return res;
  
          }
  
          Cell getReferenceCell( vec2 p, vec2 origin, float grid_angle, float step ) {
  
          // get containing cell
              Cell c;
  
          // calc grid
              vec2 n = vec2( cos( grid_angle ), sin( grid_angle ) );
              float threshold = step * 0.5;
              float dot_normal = n.x * ( p.x - origin.x ) + n.y * ( p.y - origin.y );
              float dot_line = -n.y * ( p.x - origin.x ) + n.x * ( p.y - origin.y );
              vec2 offset = vec2( n.x * dot_normal, n.y * dot_normal );
              float offset_normal = mod( hypot( offset.x, offset.y ), step );
              float normal_dir = ( dot_normal < 0.0 ) ? 1.0 : -1.0;
              float normal_scale = ( ( offset_normal < threshold ) ? -offset_normal : step - offset_normal ) * normal_dir;
              float offset_line = mod( hypot( ( p.x - offset.x ) - origin.x, ( p.y - offset.y ) - origin.y ), step );
              float line_dir = ( dot_line < 0.0 ) ? 1.0 : -1.0;
              float line_scale = ( ( offset_line < threshold ) ? -offset_line : step - offset_line ) * line_dir;
  
          // get closest corner
              c.normal = n;
              c.p1.x = p.x - n.x * normal_scale + n.y * line_scale;
              c.p1.y = p.y - n.y * normal_scale - n.x * line_scale;
  
          // scatter
              if ( scatter != 0.0 ) {
  
                  float off_mag = scatter * threshold * 0.5;
                  float off_angle = rand( vec2( floor( c.p1.x ), floor( c.p1.y ) ) ) * PI2;
                  c.p1.x += cos( off_angle ) * off_mag;
                  c.p1.y += sin( off_angle ) * off_mag;
  
              }
  
          // find corners
              float normal_step = normal_dir * ( ( offset_normal < threshold ) ? step : -step );
              float line_step = line_dir * ( ( offset_line < threshold ) ? step : -step );
              c.p2.x = c.p1.x - n.x * normal_step;
              c.p2.y = c.p1.y - n.y * normal_step;
              c.p3.x = c.p1.x + n.y * line_step;
              c.p3.y = c.p1.y - n.x * line_step;
              c.p4.x = c.p1.x - n.x * normal_step + n.y * line_step;
              c.p4.y = c.p1.y - n.y * normal_step - n.x * line_step;
  
              return c;
  
          }
  
          float blendColour( float a, float b, float t ) {
  
          // blend colours
              if ( blendingMode == BLENDING_LINEAR ) {
                  return blend( a, b, 1.0 - t );
              } else if ( blendingMode == BLENDING_ADD ) {
                  return blend( a, min( 1.0, a + b ), t );
              } else if ( blendingMode == BLENDING_MULTIPLY ) {
                  return blend( a, max( 0.0, a * b ), t );
              } else if ( blendingMode == BLENDING_LIGHTER ) {
                  return blend( a, max( a, b ), t );
              } else if ( blendingMode == BLENDING_DARKER ) {
                  return blend( a, min( a, b ), t );
              } else {
                  return blend( a, b, 1.0 - t );
              }
  
          }
  
          void main() {
  
              if ( ! disable ) {
  
          // setup
                  vec2 p = vec2( vUV.x * width, vUV.y * height );
                  vec2 origin = vec2( 0, 0 );
                  float aa = ( radius < 2.5 ) ? radius * 0.5 : 1.25;
  
          // get channel samples
                  Cell cell_r = getReferenceCell( p, origin, rotateR, radius );
                  Cell cell_g = getReferenceCell( p, origin, rotateG, radius );
                  Cell cell_b = getReferenceCell( p, origin, rotateB, radius );
                  float r = getDotColour( cell_r, p, 0, rotateR, aa );
                  float g = getDotColour( cell_g, p, 1, rotateG, aa );
                  float b = getDotColour( cell_b, p, 2, rotateB, aa );
  
          // blend with original
                  vec4 colour = texture2D( tDiffuse, vUV );
                  r = blendColour( r, colour.r, blending );
                  g = blendColour( g, colour.g, blending );
                  b = blendColour( b, colour.b, blending );
  
                  if ( greyscale ) {
                      r = g = b = (r + b + g) / 3.0;
                  }
  
                  gl_FragColor = vec4( r, g, b, 1.0 );
  
              } else {
  
                  gl_FragColor = texture2D( tDiffuse, vUV );
  
              }
  
          }`,
};

// Halftone Pass
/**
 * RGB Halftone pass for three.js effects composer. Requires HalftoneShader.
 */

class HalftonePass extends Pass {
  constructor(width, height, params) {
    super();
    this.uniforms = UniformsUtils.clone(HalftoneShader.uniforms);
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      fragmentShader: HalftoneShader.fragmentShader,
      vertexShader: HalftoneShader.vertexShader,
    });
    // set params
    this.uniforms.width.value = width;
    this.uniforms.height.value = height;
    for (const key in params) {
      if (params.hasOwnProperty(key) && this.uniforms.hasOwnProperty(key)) {
        this.uniforms[key].value = params[key];
      }
    }

    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive*/) {
    this.material.uniforms["tDiffuse"].value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  setSize(width, height) {
    this.uniforms.width.value = width;
    this.uniforms.height.value = height;
  }

  dispose() {
    this.material.dispose();

    this.fsQuad.dispose();
  }
}

///////////////////////////
// 3. FILM EFFECT        //
///////////////////////////

// Film shader
/**
 * Film grain & scanlines shader
 *
 * - ported from HLSL to WebGL / GLSL
 * https://web.archive.org/web/20210226214859/http://www.truevision3d.com/forums/showcase/staticnoise_colorblackwhite_scanline_shaders-t18698.0.html
 *
 * Screen Space Static Postprocessor
 *
 * Produces an analogue noise overlay similar to a film grain / TV static
 *
 * Original implementation and noise algorithm
 * Pat 'Hawthorne' Shearon
 *
 * Optimized scanlines + noise version with intensity scaling
 * Georg 'Leviathan' Steinrohder
 *
 * This version is provided under a Creative Commons Attribution 3.0 License
 * http://creativecommons.org/licenses/by/3.0/
 */

const FilmShader = {
  name: "FilmShader",

  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    nIntensity: { value: 0.5 },
    sIntensity: { value: 0.05 },
    sCount: { value: 4096 },
    grayscale: { value: 1 },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          #include <common>
  
          // control parameter
          uniform float time;
  
          uniform bool grayscale;
  
          // noise effect intensity value (0 = no effect, 1 = full effect)
          uniform float nIntensity;
  
          // scanlines effect intensity value (0 = no effect, 1 = full effect)
          uniform float sIntensity;
  
          // scanlines effect count value (0 = no effect, 4096 = full effect)
          uniform float sCount;
  
          uniform sampler2D tDiffuse;
  
          varying vec2 vUv;
  
          void main() {
  
          // sample the source
              vec4 cTextureScreen = texture2D( tDiffuse, vUv );
  
          // make some noise
              float dx = rand( vUv + time );
  
          // add noise
              vec3 cResult = cTextureScreen.rgb + cTextureScreen.rgb * clamp( 0.1 + dx, 0.0, 1.0 );
  
          // get us a sine and cosine
              vec2 sc = vec2( sin( vUv.y * sCount ), cos( vUv.y * sCount ) );
  
          // add scanlines
              cResult += cTextureScreen.rgb * vec3( sc.x, sc.y, sc.x ) * sIntensity;
  
          // interpolate between source and result by intensity
              cResult = cTextureScreen.rgb + clamp( nIntensity, 0.0,1.0 ) * ( cResult - cTextureScreen.rgb );
  
          // convert to grayscale if desired
              if( grayscale ) {
  
                  cResult = vec3( cResult.r * 0.3 + cResult.g * 0.59 + cResult.b * 0.11 );
  
              }
  
              gl_FragColor =  vec4( cResult, cTextureScreen.a );
  
          }`,
};

// Vignette Shader
/**
 * Vignette shader
 * based on PaintEffect postprocess from ro.me
 * http://code.google.com/p/3-dreams-of-black/source/browse/deploy/js/effects/PaintEffect.js
 */

const VignetteShader = {
  name: "VignetteShader",

  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.0 },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          uniform float offset;
          uniform float darkness;
  
          uniform sampler2D tDiffuse;
  
          varying vec2 vUv;
  
          void main() {
              // Eskil's vignette
              vec4 texel = texture2D( tDiffuse, vUv );
              vec2 uv = ( vUv - vec2( 0.5 ) ) * vec2( offset );
              gl_FragColor = vec4( mix( texel.rgb, vec3( 1.0 - darkness ), dot( uv, uv ) ), texel.a );
  
          }`,
};

// Film Pass
class FilmPass extends Pass {
  constructor(noiseIntensity, scanlinesIntensity, scanlinesCount, grayscale) {
    super();

    const shader = FilmShader;

    this.uniforms = UniformsUtils.clone(shader.uniforms);

    this.material = new ShaderMaterial({
      name: shader.name,
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });

    if (grayscale !== undefined) this.uniforms.grayscale.value = grayscale;
    if (noiseIntensity !== undefined)
      this.uniforms.nIntensity.value = noiseIntensity;
    if (scanlinesIntensity !== undefined)
      this.uniforms.sIntensity.value = scanlinesIntensity;
    if (scanlinesCount !== undefined)
      this.uniforms.sCount.value = scanlinesCount;

    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime /*, maskActive */) {
    this.uniforms["tDiffuse"].value = readBuffer.texture;
    this.uniforms["time"].value += deltaTime;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  dispose() {
    this.material.dispose();

    this.fsQuad.dispose();
  }
}

//////////////////////////////
// 4. PIXEL EFFECT          //
//////////////////////////////
// Render Pixelated Pass
const MeshNormalMaterial = THREE.MeshNormalMaterial;
const Vector4 = THREE.Vector4;
const DepthTexture = THREE.DepthTexture;
const NearestFilter = THREE.NearestFilter;
class RenderPixelatedPass extends Pass {
  constructor(pixelSize, scene, camera, options = {}) {
    super();

    this.pixelSize = pixelSize;
    this.resolution = new Vector2();
    this.renderResolution = new Vector2();

    this.pixelatedMaterial = this.createPixelatedMaterial();
    this.normalMaterial = new MeshNormalMaterial();

    this.fsQuad = new FullScreenQuad(this.pixelatedMaterial);
    this.scene = scene;
    this.camera = camera;

    this.normalEdgeStrength = options.normalEdgeStrength || 0.3;
    this.depthEdgeStrength = options.depthEdgeStrength || 0.4;

    this.beautyRenderTarget = new WebGLRenderTarget();
    this.beautyRenderTarget.texture.minFilter = NearestFilter;
    this.beautyRenderTarget.texture.magFilter = NearestFilter;
    this.beautyRenderTarget.texture.type = HalfFloatType;
    this.beautyRenderTarget.depthTexture = new DepthTexture();

    this.normalRenderTarget = new WebGLRenderTarget();
    this.normalRenderTarget.texture.minFilter = NearestFilter;
    this.normalRenderTarget.texture.magFilter = NearestFilter;
    this.normalRenderTarget.texture.type = HalfFloatType;
  }

  dispose() {
    this.beautyRenderTarget.dispose();
    this.normalRenderTarget.dispose();

    this.pixelatedMaterial.dispose();
    this.normalMaterial.dispose();

    this.fsQuad.dispose();
  }

  setSize(width, height) {
    this.resolution.set(width, height);
    this.renderResolution.set(
      (width / this.pixelSize) | 0,
      (height / this.pixelSize) | 0
    );
    const { x, y } = this.renderResolution;
    this.beautyRenderTarget.setSize(x, y);
    this.normalRenderTarget.setSize(x, y);
    this.fsQuad.material.uniforms.resolution.value.set(x, y, 1 / x, 1 / y);
  }

  setPixelSize(pixelSize) {
    this.pixelSize = pixelSize;
    this.setSize(this.resolution.x, this.resolution.y);
  }

  render(renderer, writeBuffer) {
    const uniforms = this.fsQuad.material.uniforms;
    uniforms.normalEdgeStrength.value = this.normalEdgeStrength;
    uniforms.depthEdgeStrength.value = this.depthEdgeStrength;

    renderer.setRenderTarget(this.beautyRenderTarget);
    renderer.render(this.scene, this.camera);

    const overrideMaterial_old = this.scene.overrideMaterial;
    renderer.setRenderTarget(this.normalRenderTarget);
    this.scene.overrideMaterial = this.normalMaterial;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = overrideMaterial_old;

    uniforms.tDiffuse.value = this.beautyRenderTarget.texture;
    uniforms.tDepth.value = this.beautyRenderTarget.depthTexture;
    uniforms.tNormal.value = this.normalRenderTarget.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);

      if (this.clear) renderer.clear();
    }

    this.fsQuad.render(renderer);
  }

  createPixelatedMaterial() {
    return new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        resolution: {
          value: new Vector4(
            this.renderResolution.x,
            this.renderResolution.y,
            1 / this.renderResolution.x,
            1 / this.renderResolution.y
          ),
        },
        normalEdgeStrength: { value: 0 },
        depthEdgeStrength: { value: 0 },
      },
      vertexShader: /* glsl */ `
                  varying vec2 vUv;
  
                  void main() {
  
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
                  }
              `,
      fragmentShader: /* glsl */ `
                  uniform sampler2D tDiffuse;
                  uniform sampler2D tDepth;
                  uniform sampler2D tNormal;
                  uniform vec4 resolution;
                  uniform float normalEdgeStrength;
                  uniform float depthEdgeStrength;
                  varying vec2 vUv;
  
                  float getDepth(int x, int y) {
  
                      return texture2D( tDepth, vUv + vec2(x, y) * resolution.zw ).r;
  
                  }
  
                  vec3 getNormal(int x, int y) {
  
                      return texture2D( tNormal, vUv + vec2(x, y) * resolution.zw ).rgb * 2.0 - 1.0;
  
                  }
  
                  float depthEdgeIndicator(float depth, vec3 normal) {
  
                      float diff = 0.0;
                      diff += clamp(getDepth(1, 0) - depth, 0.0, 1.0);
                      diff += clamp(getDepth(-1, 0) - depth, 0.0, 1.0);
                      diff += clamp(getDepth(0, 1) - depth, 0.0, 1.0);
                      diff += clamp(getDepth(0, -1) - depth, 0.0, 1.0);
                      return floor(smoothstep(0.01, 0.02, diff) * 2.) / 2.;
  
                  }
  
                  float neighborNormalEdgeIndicator(int x, int y, float depth, vec3 normal) {
  
                      float depthDiff = getDepth(x, y) - depth;
                      vec3 neighborNormal = getNormal(x, y);
  
                      // Edge pixels should yield to faces who's normals are closer to the bias normal.
                      vec3 normalEdgeBias = vec3(1., 1., 1.); // This should probably be a parameter.
                      float normalDiff = dot(normal - neighborNormal, normalEdgeBias);
                      float normalIndicator = clamp(smoothstep(-.01, .01, normalDiff), 0.0, 1.0);
  
                      // Only the shallower pixel should detect the normal edge.
                      float depthIndicator = clamp(sign(depthDiff * .25 + .0025), 0.0, 1.0);
  
                      return (1.0 - dot(normal, neighborNormal)) * depthIndicator * normalIndicator;
  
                  }
  
                  float normalEdgeIndicator(float depth, vec3 normal) {
  
                      float indicator = 0.0;
  
                      indicator += neighborNormalEdgeIndicator(0, -1, depth, normal);
                      indicator += neighborNormalEdgeIndicator(0, 1, depth, normal);
                      indicator += neighborNormalEdgeIndicator(-1, 0, depth, normal);
                      indicator += neighborNormalEdgeIndicator(1, 0, depth, normal);
  
                      return step(0.1, indicator);
  
                  }
  
                  void main() {
  
                      vec4 texel = texture2D( tDiffuse, vUv );
  
                      float depth = 0.0;
                      vec3 normal = vec3(0.0);
  
                      if (depthEdgeStrength > 0.0 || normalEdgeStrength > 0.0) {
  
                          depth = getDepth(0, 0);
                          normal = getNormal(0, 0);
  
                      }
  
                      float dei = 0.0;
                      if (depthEdgeStrength > 0.0)
                          dei = depthEdgeIndicator(depth, normal);
  
                      float nei = 0.0;
                      if (normalEdgeStrength > 0.0)
                          nei = normalEdgeIndicator(depth, normal);
  
                      float Strength = dei > 0.0 ? (1.0 - depthEdgeStrength * dei) : (1.0 + normalEdgeStrength * nei);
  
                      gl_FragColor = texel * Strength;
  
                  }
              `,
    });
  }
}

// Gamma Correction Shader
/**
 * Gamma Correction Shader
 * http://en.wikipedia.org/wiki/gamma_correction
 */

const GammaCorrectionShader = {

	name: 'GammaCorrectionShader',

	uniforms: {

		'tDiffuse': { value: null }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 tex = texture2D( tDiffuse, vUv );

			gl_FragColor = LinearTosRGB( tex );

		}`

};


//////////////////////////////
// 5. GLITCH EFFECT   			//
//////////////////////////////

// Digital Glitch Shader
/**
 * RGB Shift Shader
 * Shifts red and blue channels from center in opposite directions
 * Ported from http://kriss.cx/tom/2009/05/rgb-shift/
 * by Tom Butterworth / http://kriss.cx/tom/
 *
 * amount: shift distance (1 is width of input)
 * angle: shift angle in radians
 */

const DigitalGlitch = {
  uniforms: {
    tDiffuse: { value: null }, //diffuse texture
    tDisp: { value: null }, //displacement texture for digital glitch squares
    byp: { value: 0 }, //apply the glitch ?
    amount: { value: 0.08 },
    angle: { value: 0.02 },
    seed: { value: 0.02 },
    seed_x: { value: 0.02 }, //-1,1
    seed_y: { value: 0.02 }, //-1,1
    distortion_x: { value: 0.5 },
    distortion_y: { value: 0.6 },
    col_s: { value: 0.05 },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
          void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }`,

  fragmentShader: /* glsl */ `
  
          uniform int byp; //should we apply the glitch ?
  
          uniform sampler2D tDiffuse;
          uniform sampler2D tDisp;
  
          uniform float amount;
          uniform float angle;
          uniform float seed;
          uniform float seed_x;
          uniform float seed_y;
          uniform float distortion_x;
          uniform float distortion_y;
          uniform float col_s;
  
          varying vec2 vUv;
  
  
          float rand(vec2 co){
              return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
          }
  
          void main() {
              if(byp<1) {
                  vec2 p = vUv;
                  float xs = floor(gl_FragCoord.x / 0.5);
                  float ys = floor(gl_FragCoord.y / 0.5);
                  //based on staffantans glitch shader for unity https://github.com/staffantan/unityglitch
                  float disp = texture2D(tDisp, p*seed*seed).r;
                  if(p.y<distortion_x+col_s && p.y>distortion_x-col_s*seed) {
                      if(seed_x>0.){
                          p.y = 1. - (p.y + distortion_y);
                      }
                      else {
                          p.y = distortion_y;
                      }
                  }
                  if(p.x<distortion_y+col_s && p.x>distortion_y-col_s*seed) {
                      if(seed_y>0.){
                          p.x=distortion_x;
                      }
                      else {
                          p.x = 1. - (p.x + distortion_x);
                      }
                  }
                  p.x+=disp*seed_x*(seed/5.);
                  p.y+=disp*seed_y*(seed/5.);
                  //base from RGB shift shader
                  vec2 offset = amount * vec2( cos(angle), sin(angle));
                  vec4 cr = texture2D(tDiffuse, p + offset);
                  vec4 cga = texture2D(tDiffuse, p);
                  vec4 cb = texture2D(tDiffuse, p - offset);
                  gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);
                  //add noise
                  vec4 snow = 200.*amount*vec4(rand(vec2(xs * seed,ys * seed*50.))*0.2);
                  gl_FragColor = gl_FragColor+ snow;
              }
              else {
                  gl_FragColor=texture2D (tDiffuse, vUv);
              }
          }`,
};

// Glitch Pass
const DataTexture = THREE.DataTexture;
const FloatType = THREE.FloatType;
const MathUtils = THREE.MathUtils;
const RedFormat = THREE.RedFormat;
const LuminanceFormat = THREE.LuminanceFormat;

class GlitchPass extends Pass {
  constructor(dt_size = 64) {
    super();

    const shader = DigitalGlitch;

    this.uniforms = UniformsUtils.clone(shader.uniforms);

    this.heightMap = this.generateHeightmap(dt_size);

    this.uniforms["tDisp"].value = this.heightMap;

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });

    this.fsQuad = new FullScreenQuad(this.material);

    this.goWild = false;
    this.curF = 0;
    this.generateTrigger();
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    if (renderer.capabilities.isWebGL2 === false)
      this.uniforms["tDisp"].value.format = LuminanceFormat;

    this.uniforms["tDiffuse"].value = readBuffer.texture;
    this.uniforms["seed"].value = Math.random(); //default seeding
    this.uniforms["byp"].value = 0;

    if (this.curF % this.randX == 0 || this.goWild == true) {
      this.uniforms["amount"].value = Math.random() / 30;
      this.uniforms["angle"].value = MathUtils.randFloat(-Math.PI, Math.PI);
      this.uniforms["seed_x"].value = MathUtils.randFloat(-1, 1);
      this.uniforms["seed_y"].value = MathUtils.randFloat(-1, 1);
      this.uniforms["distortion_x"].value = MathUtils.randFloat(0, 1);
      this.uniforms["distortion_y"].value = MathUtils.randFloat(0, 1);
      this.curF = 0;
      this.generateTrigger();
    } else if (this.curF % this.randX < this.randX / 5) {
      this.uniforms["amount"].value = Math.random() / 90;
      this.uniforms["angle"].value = MathUtils.randFloat(-Math.PI, Math.PI);
      this.uniforms["distortion_x"].value = MathUtils.randFloat(0, 1);
      this.uniforms["distortion_y"].value = MathUtils.randFloat(0, 1);
      this.uniforms["seed_x"].value = MathUtils.randFloat(-0.3, 0.3);
      this.uniforms["seed_y"].value = MathUtils.randFloat(-0.3, 0.3);
    } else if (this.goWild == false) {
      this.uniforms["byp"].value = 1;
    }

    this.curF++;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  generateTrigger() {
    this.randX = MathUtils.randInt(120, 240);
  }

  generateHeightmap(dt_size) {
    const data_arr = new Float32Array(dt_size * dt_size);
    const length = dt_size * dt_size;

    for (let i = 0; i < length; i++) {
      const val = MathUtils.randFloat(0, 1);
      data_arr[i] = val;
    }

    const texture = new DataTexture(
      data_arr,
      dt_size,
      dt_size,
      RedFormat,
      FloatType
    );
    texture.needsUpdate = true;
    return texture;
  }

  dispose() {
    this.material.dispose();

    this.heightMap.dispose();

    this.fsQuad.dispose();
  }
}

//////////////////////////////
// 6. SOBEL EFFECT          //
//////////////////////////////

// Luminosity Shader
/**
 * Luminosity
 * http://en.wikipedia.org/wiki/Luminosity
 */

const LuminosityShader = {
  uniforms: {
    tDiffuse: { value: null },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
  
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          #include <common>
  
          uniform sampler2D tDiffuse;
  
          varying vec2 vUv;
  
          void main() {
  
              vec4 texel = texture2D( tDiffuse, vUv );
  
              float l = luminance( texel.rgb );
  
              gl_FragColor = vec4( l, l, l, texel.w );
  
          }`,
};

// Sobel Operator Shader;
/**
 * Sobel Edge Detection (see https://youtu.be/uihBwtPIBxM)
 *
 * As mentioned in the video the Sobel operator expects a grayscale image as input.
 *
 */

const SobelOperatorShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new Vector2() },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
  
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          uniform sampler2D tDiffuse;
          uniform vec2 resolution;
          varying vec2 vUv;
  
          void main() {
  
              vec2 texel = vec2( 1.0 / resolution.x, 1.0 / resolution.y );
  
          // kernel definition (in glsl matrices are filled in column-major order)
  
              const mat3 Gx = mat3( -1, -2, -1, 0, 0, 0, 1, 2, 1 ); // x direction kernel
              const mat3 Gy = mat3( -1, 0, 1, -2, 0, 2, -1, 0, 1 ); // y direction kernel
  
          // fetch the 3x3 neighbourhood of a fragment
  
          // first column
  
              float tx0y0 = texture2D( tDiffuse, vUv + texel * vec2( -1, -1 ) ).r;
              float tx0y1 = texture2D( tDiffuse, vUv + texel * vec2( -1,  0 ) ).r;
              float tx0y2 = texture2D( tDiffuse, vUv + texel * vec2( -1,  1 ) ).r;
  
          // second column
  
              float tx1y0 = texture2D( tDiffuse, vUv + texel * vec2(  0, -1 ) ).r;
              float tx1y1 = texture2D( tDiffuse, vUv + texel * vec2(  0,  0 ) ).r;
              float tx1y2 = texture2D( tDiffuse, vUv + texel * vec2(  0,  1 ) ).r;
  
          // third column
  
              float tx2y0 = texture2D( tDiffuse, vUv + texel * vec2(  1, -1 ) ).r;
              float tx2y1 = texture2D( tDiffuse, vUv + texel * vec2(  1,  0 ) ).r;
              float tx2y2 = texture2D( tDiffuse, vUv + texel * vec2(  1,  1 ) ).r;
  
          // gradient value in x direction
  
              float valueGx = Gx[0][0] * tx0y0 + Gx[1][0] * tx1y0 + Gx[2][0] * tx2y0 +
                  Gx[0][1] * tx0y1 + Gx[1][1] * tx1y1 + Gx[2][1] * tx2y1 +
                  Gx[0][2] * tx0y2 + Gx[1][2] * tx1y2 + Gx[2][2] * tx2y2;
  
          // gradient value in y direction
  
              float valueGy = Gy[0][0] * tx0y0 + Gy[1][0] * tx1y0 + Gy[2][0] * tx2y0 +
                  Gy[0][1] * tx0y1 + Gy[1][1] * tx1y1 + Gy[2][1] * tx2y1 +
                  Gy[0][2] * tx0y2 + Gy[1][2] * tx1y2 + Gy[2][2] * tx2y2;
  
          // magnitute of the total gradient
  
              float G = sqrt( ( valueGx * valueGx ) + ( valueGy * valueGy ) );
  
              gl_FragColor = vec4( vec3( G ), 1 );
  
          }`,
};

//////////////////////////////
// 7. UNREAL BLOOM EFFECT		//
//////////////////////////////

// Luminosity High Pass Shader
/**
 * Luminosity
 * http://en.wikipedia.org/wiki/Luminosity
 */

const LuminosityHighPassShader = {
  shaderID: "luminosityHighPass",

  uniforms: {
    tDiffuse: { value: null },
    luminosityThreshold: { value: 1.0 },
    smoothWidth: { value: 1.0 },
    defaultColor: { value: new Color(0x000000) },
    defaultOpacity: { value: 0.0 },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
  
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          uniform sampler2D tDiffuse;
          uniform vec3 defaultColor;
          uniform float defaultOpacity;
          uniform float luminosityThreshold;
          uniform float smoothWidth;
  
          varying vec2 vUv;
  
          void main() {
  
              vec4 texel = texture2D( tDiffuse, vUv );
  
              vec3 luma = vec3( 0.299, 0.587, 0.114 );
  
              float v = dot( texel.xyz, luma );
  
              vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );
  
              float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );
  
              gl_FragColor = mix( outputColor, texel, alpha );
  
          }`,
};

// Unreal Bloom Pass
const AdditiveBlending = THREE.AdditiveBlending;
const MeshBasicMaterial = THREE.MeshBasicMaterial;
const Vector3 = THREE.Vector3;
/**
 * UnrealBloomPass is inspired by the bloom pass of Unreal Engine. It creates a
 * mip map chain of bloom textures and blurs them with different radii. Because
 * of the weighted combination of mips, and because larger blurs are done on
 * higher mips, this effect provides good quality and performance.
 *
 * Reference:
 * - https://docs.unrealengine.com/latest/INT/Engine/Rendering/PostProcessEffects/Bloom/
 */
class UnrealBloomPass extends Pass {
  constructor(resolution, strength, radius, threshold) {
    super();

    this.strength = strength !== undefined ? strength : 1;
    this.radius = radius;
    this.threshold = threshold;
    this.resolution =
      resolution !== undefined
        ? new Vector2(resolution.x, resolution.y)
        : new Vector2(256, 256);

    // create color only once here, reuse it later inside the render function
    this.clearColor = new Color(0, 0, 0);

    // render targets
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];
    this.nMips = 5;
    let resx = Math.round(this.resolution.x / 2);
    let resy = Math.round(this.resolution.y / 2);

    this.renderTargetBright = new WebGLRenderTarget(resx, resy, {
      type: HalfFloatType,
    });
    this.renderTargetBright.texture.name = "UnrealBloomPass.bright";
    this.renderTargetBright.texture.generateMipmaps = false;

    for (let i = 0; i < this.nMips; i++) {
      const renderTargetHorizonal = new WebGLRenderTarget(resx, resy, {
        type: HalfFloatType,
      });

      renderTargetHorizonal.texture.name = "UnrealBloomPass.h" + i;
      renderTargetHorizonal.texture.generateMipmaps = false;

      this.renderTargetsHorizontal.push(renderTargetHorizonal);

      const renderTargetVertical = new WebGLRenderTarget(resx, resy, {
        type: HalfFloatType,
      });

      renderTargetVertical.texture.name = "UnrealBloomPass.v" + i;
      renderTargetVertical.texture.generateMipmaps = false;

      this.renderTargetsVertical.push(renderTargetVertical);

      resx = Math.round(resx / 2);

      resy = Math.round(resy / 2);
    }

    // luminosity high pass material

    const highPassShader = LuminosityHighPassShader;
    this.highPassUniforms = UniformsUtils.clone(highPassShader.uniforms);

    this.highPassUniforms["luminosityThreshold"].value = threshold;
    this.highPassUniforms["smoothWidth"].value = 0.01;

    this.materialHighPassFilter = new ShaderMaterial({
      uniforms: this.highPassUniforms,
      vertexShader: highPassShader.vertexShader,
      fragmentShader: highPassShader.fragmentShader,
      defines: {},
    });

    // Gaussian Blur Materials
    this.separableBlurMaterials = [];
    const kernelSizeArray = [3, 5, 7, 9, 11];
    resx = Math.round(this.resolution.x / 2);
    resy = Math.round(this.resolution.y / 2);

    for (let i = 0; i < this.nMips; i++) {
      this.separableBlurMaterials.push(
        this.getSeperableBlurMaterial(kernelSizeArray[i])
      );

      this.separableBlurMaterials[i].uniforms["texSize"].value = new Vector2(
        resx,
        resy
      );

      resx = Math.round(resx / 2);

      resy = Math.round(resy / 2);
    }

    // Composite material
    this.compositeMaterial = this.getCompositeMaterial(this.nMips);
    this.compositeMaterial.uniforms["blurTexture1"].value =
      this.renderTargetsVertical[0].texture;
    this.compositeMaterial.uniforms["blurTexture2"].value =
      this.renderTargetsVertical[1].texture;
    this.compositeMaterial.uniforms["blurTexture3"].value =
      this.renderTargetsVertical[2].texture;
    this.compositeMaterial.uniforms["blurTexture4"].value =
      this.renderTargetsVertical[3].texture;
    this.compositeMaterial.uniforms["blurTexture5"].value =
      this.renderTargetsVertical[4].texture;
    this.compositeMaterial.uniforms["bloomStrength"].value = strength;
    this.compositeMaterial.uniforms["bloomRadius"].value = 0.1;
    this.compositeMaterial.needsUpdate = true;

    const bloomFactors = [1.0, 0.8, 0.6, 0.4, 0.2];
    this.compositeMaterial.uniforms["bloomFactors"].value = bloomFactors;
    this.bloomTintColors = [
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
      new Vector3(1, 1, 1),
    ];
    this.compositeMaterial.uniforms["bloomTintColors"].value =
      this.bloomTintColors;

    // copy material

    const copyShader = CopyShader;

    this.copyUniforms = UniformsUtils.clone(copyShader.uniforms);
    this.copyUniforms["opacity"].value = 1.0;

    this.materialCopy = new ShaderMaterial({
      uniforms: this.copyUniforms,
      vertexShader: copyShader.vertexShader,
      fragmentShader: copyShader.fragmentShader,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    this.enabled = true;
    this.needsSwap = false;

    this._oldClearColor = new Color();
    this.oldClearAlpha = 1;

    this.basic = new MeshBasicMaterial();

    this.fsQuad = new FullScreenQuad(null);
  }

  dispose() {
    for (let i = 0; i < this.renderTargetsHorizontal.length; i++) {
      this.renderTargetsHorizontal[i].dispose();
    }

    for (let i = 0; i < this.renderTargetsVertical.length; i++) {
      this.renderTargetsVertical[i].dispose();
    }

    this.renderTargetBright.dispose();

    //

    for (let i = 0; i < this.separableBlurMaterials.length; i++) {
      this.separableBlurMaterials[i].dispose();
    }

    this.compositeMaterial.dispose();
    this.materialCopy.dispose();
    this.basic.dispose();

    //

    this.fsQuad.dispose();
  }

  setSize(width, height) {
    let resx = Math.round(width / 2);
    let resy = Math.round(height / 2);

    this.renderTargetBright.setSize(resx, resy);

    for (let i = 0; i < this.nMips; i++) {
      this.renderTargetsHorizontal[i].setSize(resx, resy);
      this.renderTargetsVertical[i].setSize(resx, resy);

      this.separableBlurMaterials[i].uniforms["texSize"].value = new Vector2(
        resx,
        resy
      );

      resx = Math.round(resx / 2);
      resy = Math.round(resy / 2);
    }
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    renderer.setClearColor(this.clearColor, 0);

    if (maskActive) renderer.state.buffers.stencil.setTest(false);

    // Render input to screen

    if (this.renderToScreen) {
      this.fsQuad.material = this.basic;
      this.basic.map = readBuffer.texture;

      renderer.setRenderTarget(null);
      renderer.clear();
      this.fsQuad.render(renderer);
    }

    // 1. Extract Bright Areas

    this.highPassUniforms["tDiffuse"].value = readBuffer.texture;
    this.highPassUniforms["luminosityThreshold"].value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;

    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. Blur All the mips progressively

    let inputRenderTarget = this.renderTargetBright;

    for (let i = 0; i < this.nMips; i++) {
      this.fsQuad.material = this.separableBlurMaterials[i];

      this.separableBlurMaterials[i].uniforms["colorTexture"].value =
        inputRenderTarget.texture;
      this.separableBlurMaterials[i].uniforms["direction"].value =
        UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      this.separableBlurMaterials[i].uniforms["colorTexture"].value =
        this.renderTargetsHorizontal[i].texture;
      this.separableBlurMaterials[i].uniforms["direction"].value =
        UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);

      inputRenderTarget = this.renderTargetsVertical[i];
    }

    // Composite All the mips

    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms["bloomStrength"].value = this.strength;
    this.compositeMaterial.uniforms["bloomRadius"].value = this.radius;
    this.compositeMaterial.uniforms["bloomTintColors"].value =
      this.bloomTintColors;

    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    // Blend it additively over the input texture

    this.fsQuad.material = this.materialCopy;
    this.copyUniforms["tDiffuse"].value =
      this.renderTargetsHorizontal[0].texture;

    if (maskActive) renderer.state.buffers.stencil.setTest(true);

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(readBuffer);
      this.fsQuad.render(renderer);
    }

    // Restore renderer settings

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  getSeperableBlurMaterial(kernelRadius) {
    return new ShaderMaterial({
      defines: {
        KERNEL_RADIUS: kernelRadius,
        SIGMA: kernelRadius,
      },

      uniforms: {
        colorTexture: { value: null },
        texSize: { value: new Vector2(0.5, 0.5) },
        direction: { value: new Vector2(0.5, 0.5) },
      },

      vertexShader: `varying vec2 vUv;
                  void main() {
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                  }`,

      fragmentShader: `#include <common>
                  varying vec2 vUv;
                  uniform sampler2D colorTexture;
                  uniform vec2 texSize;
                  uniform vec2 direction;
  
                  float gaussianPdf(in float x, in float sigma) {
                      return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
                  }
                  void main() {
                      vec2 invSize = 1.0 / texSize;
                      float fSigma = float(SIGMA);
                      float weightSum = gaussianPdf(0.0, fSigma);
                      vec3 diffuseSum = texture2D( colorTexture, vUv).rgb * weightSum;
                      for( int i = 1; i < KERNEL_RADIUS; i ++ ) {
                          float x = float(i);
                          float w = gaussianPdf(x, fSigma);
                          vec2 uvOffset = direction * invSize * x;
                          vec3 sample1 = texture2D( colorTexture, vUv + uvOffset).rgb;
                          vec3 sample2 = texture2D( colorTexture, vUv - uvOffset).rgb;
                          diffuseSum += (sample1 + sample2) * w;
                          weightSum += 2.0 * w;
                      }
                      gl_FragColor = vec4(diffuseSum/weightSum, 1.0);
                  }`,
    });
  }

  getCompositeMaterial(nMips) {
    return new ShaderMaterial({
      defines: {
        NUM_MIPS: nMips,
      },

      uniforms: {
        blurTexture1: { value: null },
        blurTexture2: { value: null },
        blurTexture3: { value: null },
        blurTexture4: { value: null },
        blurTexture5: { value: null },
        bloomStrength: { value: 1.0 },
        bloomFactors: { value: null },
        bloomTintColors: { value: null },
        bloomRadius: { value: 0.0 },
      },

      vertexShader: `varying vec2 vUv;
                  void main() {
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                  }`,

      fragmentShader: `varying vec2 vUv;
                  uniform sampler2D blurTexture1;
                  uniform sampler2D blurTexture2;
                  uniform sampler2D blurTexture3;
                  uniform sampler2D blurTexture4;
                  uniform sampler2D blurTexture5;
                  uniform float bloomStrength;
                  uniform float bloomRadius;
                  uniform float bloomFactors[NUM_MIPS];
                  uniform vec3 bloomTintColors[NUM_MIPS];
  
                  float lerpBloomFactor(const in float factor) {
                      float mirrorFactor = 1.2 - factor;
                      return mix(factor, mirrorFactor, bloomRadius);
                  }
  
                  void main() {
                      gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
                          lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
                          lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
                          lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
                          lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );
                  }`,
    });
  }
}

UnrealBloomPass.BlurDirectionX = new Vector2(1.0, 0.0);
UnrealBloomPass.BlurDirectionY = new Vector2(0.0, 1.0);

// Output Shader
const OutputShader = {
  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
  },

  vertexShader: /* glsl */ `
  
          varying vec2 vUv;
  
          void main() {
  
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
          }`,

  fragmentShader: /* glsl */ `
  
          uniform sampler2D tDiffuse;
  
          #include <tonemapping_pars_fragment>
  
          varying vec2 vUv;
  
          void main() {
  
              gl_FragColor = texture2D( tDiffuse, vUv );
  
              // tone mapping
  
              #ifdef LINEAR_TONE_MAPPING
  
                  gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
  
              #elif defined( REINHARD_TONE_MAPPING )
  
                  gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
  
              #elif defined( CINEON_TONE_MAPPING )
  
                  gl_FragColor.rgb = OptimizedCineonToneMapping( gl_FragColor.rgb );
  
              #elif defined( ACES_FILMIC_TONE_MAPPING )
  
                  gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
  
              #endif
  
              // color space
  
              gl_FragColor = LinearTosRGB( gl_FragColor );
  
          }`,
};

// Output Pass
const NoToneMapping = THREE.NoToneMapping;
const LinearToneMapping = THREE.LinearToneMapping;
const ReinhardToneMapping = THREE.ReinhardToneMapping;
const CineonToneMapping = THREE.CineonToneMapping;
const ACESFilmicToneMapping = THREE.ACESFilmicToneMapping;
class OutputPass extends Pass {
  constructor(toneMapping = NoToneMapping, toneMappingExposure = 1) {
    super();

    this.toneMapping = toneMapping;
    this.toneMappingExposure = toneMappingExposure;

    //

    const shader = OutputShader;

    this.uniforms = UniformsUtils.clone(shader.uniforms);

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });

    if (toneMapping === LinearToneMapping)
      this.material.defines.LINEAR_TONE_MAPPING = "";
    else if (toneMapping === ReinhardToneMapping)
      this.material.defines.REINHARD_TONE_MAPPING = "";
    else if (toneMapping === CineonToneMapping)
      this.material.defines.CINEON_TONE_MAPPING = "";
    else if (toneMapping === ACESFilmicToneMapping)
      this.material.defines.ACES_FILMIC_TONE_MAPPING = "";

    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    this.uniforms["tDiffuse"].value = readBuffer.texture;
    this.uniforms["toneMappingExposure"].value = this.toneMappingExposure;

    if (this.renderToScreen === true) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear)
        renderer.clear(
          renderer.autoClearColor,
          renderer.autoClearDepth,
          renderer.autoClearStencil
        );
      this.fsQuad.render(renderer);
    }
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

//////////////////////////////
// 8. DOT EFFECT        		//
//////////////////////////////

// RGB Shift Shader
/**
 * RGB Shift Shader
 * Shifts red and blue channels from center in opposite directions
 * Ported from https://web.archive.org/web/20090820185047/http://kriss.cx/tom/2009/05/rgb-shift/
 * by Tom Butterworth / https://web.archive.org/web/20090810054752/http://kriss.cx/tom/
 *
 * amount: shift distance (1 is width of input)
 * angle: shift angle in radians
 */
const RGBShiftShader = {

	name: 'RGBShiftShader',

	uniforms: {

		'tDiffuse': { value: null },
		'amount': { value: 0.005 },
		'angle': { value: 0.0 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;
		uniform float amount;
		uniform float angle;

		varying vec2 vUv;

		void main() {

			vec2 offset = amount * vec2( cos(angle), sin(angle));
			vec4 cr = texture2D(tDiffuse, vUv + offset);
			vec4 cga = texture2D(tDiffuse, vUv);
			vec4 cb = texture2D(tDiffuse, vUv - offset);
			gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);

		}`

};
// Dot Screen Shader
/**
 * Dot screen shader
 * based on glfx.js sepia shader
 * https://github.com/evanw/glfx.js
 */

const DotScreenShader = {

	name: 'DotScreenShader',

	uniforms: {

		'tDiffuse': { value: null },
		'tSize': { value: new Vector2( 256, 256 ) },
		'center': { value: new Vector2( 0.5, 0.5 ) },
		'angle': { value: 1.57 },
		'scale': { value: 1.0 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform vec2 center;
		uniform float angle;
		uniform float scale;
		uniform vec2 tSize;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		float pattern() {

			float s = sin( angle ), c = cos( angle );

			vec2 tex = vUv * tSize - center;
			vec2 point = vec2( c * tex.x - s * tex.y, s * tex.x + c * tex.y ) * scale;

			return ( sin( point.x ) * sin( point.y ) ) * 4.0;

		}

		void main() {

			vec4 color = texture2D( tDiffuse, vUv );

			float average = ( color.r + color.g + color.b ) / 3.0;

			gl_FragColor = vec4( vec3( average * 10.0 - 5.0 + pattern() ), color.a );

		}`

};

//////////////////////////////
// 9. MASKING EFFECT	      //
//////////////////////////////

// Clear Pass
class ClearPass extends Pass {
  constructor(clearColor, clearAlpha) {
    super();

    this.needsSwap = false;

    this.clearColor = clearColor !== undefined ? clearColor : 0x000000;
    this.clearAlpha = clearAlpha !== undefined ? clearAlpha : 0;
    this._oldClearColor = new Color();
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    let oldClearAlpha;

    if (this.clearColor) {
      renderer.getClearColor(this._oldClearColor);
      oldClearAlpha = renderer.getClearAlpha();

      renderer.setClearColor(this.clearColor, this.clearAlpha);
    }

    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();

    if (this.clearColor) {
      renderer.setClearColor(this._oldClearColor, oldClearAlpha);
    }
  }
}

// Texture Pass
class TexturePass extends Pass {
  constructor(map, opacity) {
    super();

    const shader = CopyShader;

    this.map = map;
    this.opacity = opacity !== undefined ? opacity : 1.0;

    this.uniforms = UniformsUtils.clone(shader.uniforms);

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.needsSwap = false;

    this.fsQuad = new FullScreenQuad(null);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    this.fsQuad.material = this.material;

    this.uniforms["opacity"].value = this.opacity;
    this.uniforms["tDiffuse"].value = this.map;
    this.material.transparent = this.opacity < 1.0;

    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);

    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.material.dispose();

    this.fsQuad.dispose();
  }
}

////////////////////////////////////////////////////
// 10. VOLUMETRIC LIGHT EFFECT (GOD-RAYS)         //
////////////////////////////////////////////////////
const VolumetericLightShader = {
  uniforms: {
    tDiffuse: { value: null },
    lightPosition: { value: new THREE.Vector2(0.5, 0.5) },
    exposure: { value: 0.15 },
    decay: { value: 0.95 },
    density: { value: 0.5 },
    weight: { value: 0.4 },
    samples: { value: 50 },
  },

  vertexShader: [
    "varying vec2 vUv;",
    "void main() {",
    "vUv = uv;",
    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
    "}",
  ].join("\n"),

  fragmentShader: [
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform vec2 lightPosition;",
    "uniform float exposure;",
    "uniform float decay;",
    "uniform float density;",
    "uniform float weight;",
    "uniform int samples;",
    "const int MAX_SAMPLES = 100;",
    "void main()",
    "{",
    "vec2 texCoord = vUv;",
    "vec2 deltaTextCoord = texCoord - lightPosition;",
    "deltaTextCoord *= 1.0 / float(samples) * density;",
    "vec4 color = texture2D(tDiffuse, texCoord);",
    "float illuminationDecay = 1.0;",
    "for(int i=0; i < MAX_SAMPLES; i++)",
    "{",
    "if(i == samples){",
    "break;",
    "}",
    "texCoord -= deltaTextCoord;",
    "vec4 sampler = texture2D(tDiffuse, texCoord);",
    "sampler *= illuminationDecay * weight;",
    "color += sampler;",
    "illuminationDecay *= decay;",
    "}",
    "gl_FragColor = color * exposure;",
    "}",
  ].join("\n"),
};

const AdditiveBlendingShader = {
  uniforms: {
    tDiffuse: { value: null },
    tAdd: { value: null },
  },

  vertexShader: [
    "varying vec2 vUv;",
    "void main() {",
    "vUv = uv;",
    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
    "}",
  ].join("\n"),

  fragmentShader: [
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tAdd;",
    "varying vec2 vUv;",
    "void main() {",
    "vec4 color = texture2D( tDiffuse, vUv );",
    "vec4 add = texture2D( tAdd, vUv );",
    "gl_FragColor = color + add;",
    "}",
  ].join("\n"),
};

const PassThroughShader = {
  uniforms: {
    tDiffuse: { value: null },
  },

  vertexShader: [
    "varying vec2 vUv;",

    "void main() {",

    "vUv = uv;",
    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

    "}",
  ].join("\n"),

  fragmentShader: [
    "uniform sampler2D tDiffuse;",

    "varying vec2 vUv;",

    "void main() {",

    "gl_FragColor = texture2D( tDiffuse, vec2( vUv.x, vUv.y ) );",

    "}",
  ].join("\n"),
};

////////////////////////////////////////////////////
// 11. AFTERIMAGE EFFECT                          //
////////////////////////////////////////////////////
// AfterImage Shader
/**
 * Afterimage shader
 * I created this effect inspired by a demo on codepen:
 * https://codepen.io/brunoimbrizi/pen/MoRJaN?page=1&
 */

const AfterimageShader = {
  uniforms: {
    damp: { value: 0.96 },
    tOld: { value: null },
    tNew: { value: null },
  },

  vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

  fragmentShader: /* glsl */ `
		uniform float damp;
		uniform sampler2D tOld;
		uniform sampler2D tNew;
		varying vec2 vUv;
		vec4 when_gt( vec4 x, float y ) {
			return max( sign( x - y ), 0.0 );
		}
		void main() {
			vec4 texelOld = texture2D( tOld, vUv );
			vec4 texelNew = texture2D( tNew, vUv );
			texelOld *= damp * when_gt( texelOld, 0.1 );
			gl_FragColor = max(texelNew, texelOld);
		}`,
};
// AfterImage Pass
class AfterimagePass extends Pass {
  constructor(damp = 0.96) {
    super();

    this.shader = AfterimageShader;

    this.uniforms = UniformsUtils.clone(this.shader.uniforms);

    this.uniforms["damp"].value = damp;

    this.textureComp = new WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        magFilter: NearestFilter,
        type: HalfFloatType,
      }
    );

    this.textureOld = new WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        magFilter: NearestFilter,
        type: HalfFloatType,
      }
    );

    this.compFsMaterial = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.shader.vertexShader,
      fragmentShader: this.shader.fragmentShader,
    });

    this.compFsQuad = new FullScreenQuad(this.compFsMaterial);

    this.copyFsMaterial = new MeshBasicMaterial();
    this.copyFsQuad = new FullScreenQuad(this.copyFsMaterial);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive*/) {
    this.uniforms["tOld"].value = this.textureOld.texture;
    this.uniforms["tNew"].value = readBuffer.texture;

    renderer.setRenderTarget(this.textureComp);
    this.compFsQuad.render(renderer);

    this.copyFsQuad.material.map = this.textureComp.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.copyFsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);

      if (this.clear) renderer.clear();

      this.copyFsQuad.render(renderer);
    }

    // Swap buffers.
    const temp = this.textureOld;
    this.textureOld = this.textureComp;
    this.textureComp = temp;
    // Now textureOld contains the latest image, ready for the next frame.
  }

  setSize(width, height) {
    this.textureComp.setSize(width, height);
    this.textureOld.setSize(width, height);
  }

  dispose() {
    this.textureComp.dispose();
    this.textureOld.dispose();

    this.compFsMaterial.dispose();
    this.copyFsMaterial.dispose();

    this.compFsQuad.dispose();
    this.copyFsQuad.dispose();
  }
}

////////////////////////////////////////////////////
// 12. BAD TV EFFECT                              //
////////////////////////////////////////////////////
/**
 * @author Felix Turner / www.airtight.cc / @felixturner
 *
 * Bad TV Shader
 * Simulates a bad TV via horizontal distortion and vertical roll
 * Uses Ashima WebGl Noise: https://github.com/ashima/webgl-noise
 *
 * Uniforms:
 * time: steadily increasing float passed in
 * distortion: amount of thick distortion
 * distortion2: amount of fine grain distortion
 * speed: distortion vertical travel speed
 * rollSpeed: vertical roll speed
 *
 * The MIT License
 *
 * Copyright (c) Felix Turner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

const BadTVShader = {
  uniforms: {
    tDiffuse: { type: "t", value: null },
    time: { type: "f", value: 0.0 },
    distortion: { type: "f", value: 3.0 },
    distortion2: { type: "f", value: 5.0 },
    speed: { type: "f", value: 0.2 },
    rollSpeed: { type: "f", value: 0.1 },
  },

  vertexShader: [
    "varying vec2 vUv;",
    "void main() {",
    "vUv = uv;",
    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
    "}",
  ].join("\n"),

  fragmentShader: [
    "uniform sampler2D tDiffuse;",
    "uniform float time;",
    "uniform float distortion;",
    "uniform float distortion2;",
    "uniform float speed;",
    "uniform float rollSpeed;",
    "varying vec2 vUv;",

    // Start Ashima 2D Simplex Noise

    "vec3 mod289(vec3 x) {",
    "  return x - floor(x * (1.0 / 289.0)) * 289.0;",
    "}",

    "vec2 mod289(vec2 x) {",
    "  return x - floor(x * (1.0 / 289.0)) * 289.0;",
    "}",

    "vec3 permute(vec3 x) {",
    "  return mod289(((x*34.0)+1.0)*x);",
    "}",

    "float snoise(vec2 v)",
    "  {",
    "  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0",
    "                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)",
    "                     -0.577350269189626,  // -1.0 + 2.0 * C.x",
    "                      0.024390243902439); // 1.0 / 41.0",
    "  vec2 i  = floor(v + dot(v, C.yy) );",
    "  vec2 x0 = v -   i + dot(i, C.xx);",

    "  vec2 i1;",
    "  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);",
    "  vec4 x12 = x0.xyxy + C.xxzz;",
    " x12.xy -= i1;",

    "  i = mod289(i); // Avoid truncation effects in permutation",
    "  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))",
    "		+ i.x + vec3(0.0, i1.x, 1.0 ));",

    "  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);",
    "  m = m*m ;",
    "  m = m*m ;",

    "  vec3 x = 2.0 * fract(p * C.www) - 1.0;",
    "  vec3 h = abs(x) - 0.5;",
    "  vec3 ox = floor(x + 0.5);",
    "  vec3 a0 = x - ox;",

    "  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );",

    "  vec3 g;",
    "  g.x  = a0.x  * x0.x  + h.x  * x0.y;",
    "  g.yz = a0.yz * x12.xz + h.yz * x12.yw;",
    "  return 130.0 * dot(m, g);",
    "}",

    // End Ashima 2D Simplex Noise

    "void main() {",

    "vec2 p = vUv;",
    "float ty = time*speed;",
    "float yt = p.y - ty;",
    //smooth distortion
    "float offset = snoise(vec2(yt*3.0,0.0))*0.2;",
    // boost distortion
    "offset = offset*distortion * offset*distortion * offset;",
    //add fine grain distortion
    "offset += snoise(vec2(yt*50.0,0.0))*distortion2*0.001;",
    //combine distortion on X with roll on Y
    "gl_FragColor = texture2D(tDiffuse,  vec2(fract(p.x + offset),fract(p.y-time*rollSpeed) ));",

    "}",
  ].join("\n"),
};

// Static Shader
/**
 * @author Felix Turner / www.airtight.cc / @felixturner
 *
 * Static effect. Additively blended digital noise.
 *
 * amount - amount of noise to add (0 - 1)
 * size - size of noise grains (pixels)
 *
 * The MIT License
 *
 * Copyright (c) 2014 Felix Turner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

const StaticShader = {
  uniforms: {
    tDiffuse: { type: "t", value: null },
    time: { type: "f", value: 0.0 },
    amount: { type: "f", value: 0.5 },
    size: { type: "f", value: 4.0 },
  },

  vertexShader: [
    "varying vec2 vUv;",

    "void main() {",

    "vUv = uv;",
    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

    "}",
  ].join("\n"),

  fragmentShader: [
    "uniform sampler2D tDiffuse;",
    "uniform float time;",
    "uniform float amount;",
    "uniform float size;",

    "varying vec2 vUv;",

    "float rand(vec2 co){",
    "return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);",
    "}",

    "void main() {",
    "vec2 p = vUv;",
    "vec4 color = texture2D(tDiffuse, p);",
    "float xs = floor(gl_FragCoord.x / size);",
    "float ys = floor(gl_FragCoord.y / size);",
    "vec4 snow = vec4(rand(vec2(xs * time,ys * time))*amount);",

    //"gl_FragColor = color + amount * ( snow - color );", //interpolate

    "gl_FragColor = color+ snow;", //additive

    "}",
  ].join("\n"),
};


/////////////////////////////////////
// A-FRAME COMPONENT: POST-PROCESSING //
/////////////////////////////////////
AFRAME.registerComponent("post-processing", {
  schema: {
    effect: {
      type: "string",
      default: "sketchy-pencil",
    },
    halftoneParams: {
      type: "string",
      default:
        "shape: 1, radius: 6, rotateR: Math.PI / 12, rotateB: (Math.PI / 12) * 2, rotateG: (Math.PI / 12) * 3, scatter: 1, blending: 1, blendingMode: 1, greyscale: false, disable: false",
    },
    oldFilmParams: {
      type: "string",
      default: "grayscale: true, nIntensity: 0.3, sIntensity: 0.3, sCount: 256",
    },
    pixelParams: {
      type: "string",
      default:
        "pixelSize: 12, normalEdgeStrength: 0.35, depthEdgeStrength: 0.4",
    },
    glitchParams: {
      type: "string",
      default: "goWild: false, enabled: true",
    },
    sobelParams: {
      type: "string",
      default: "enabled: true",
    },
    bloomParams: {
      type: "string",
      default: "threshold: 0, strength: 0.4, radius: 0, exposure: 1",
    },
    dotScreenParams: {
      type: "string",
      default: "scale: 4, angle: 90",
    },
    volumetricLightParams: {
      type: "string",
      default: "decay: 0.95, density: 0.5, exposure: 0.2, samples: 50",
    },
    afterimageParams: {
      type: "string",
      default: "damp: 0.8",
    },
    badTVParams: {
      type: "string",
      default:
        "mute: true, show: true, distortion: 1.0, distortion2: 1.0, speed: 0.2, rollSpeed: 0",
    },
  },
  init: function () {
    this.scene = this.el.object3D;
    this.renderer = this.el.renderer;
    this.camera = this.el.camera;

    // Individual effects
    if (this.data.effect === "sketchy-pencil") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const pencilLinePass = new PencilLinesPass({
        width: this.renderer.domElement.clientWidth,
        height: this.renderer.domElement.clientHeight,
        scene: this.scene,
        camera: this.camera,
      });
      pencilLinePass.renderToScreen = false;
      this.composer.addPass(pencilLinePass);
    } else if (this.data.effect === "halftone") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Create params object from str
      const params = getParams(this.data.halftoneParams);
      const halftonePass = new HalftonePass(
        window.innerWidth,
        window.innerHeight,
        params
      );
      this.composer.addPass(halftonePass);
    } else if (this.data.effect === "old-film") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Create params object from str
      const params = getParams(this.data.oldFilmParams);
      let filmPass = new FilmPass();
      filmPass.material.uniforms.grayscale.value = params.grayscale;
      filmPass.material.uniforms.nIntensity.value = params.nIntensity; // noise intensity
      filmPass.material.uniforms.sIntensity.value = params.sIntensity; // scanlines intensity
      filmPass.material.uniforms.sCount.value = params.sCount; // Scanlines count
      this.composer.addPass(filmPass);
      // Add vignette shader to make it more appealing
      let shaderVignette = VignetteShader;
      let effectVignette = new ShaderPass(shaderVignette);
      effectVignette.uniforms["offset"].value = 1.5;
      effectVignette.uniforms["darkness"].value = 0.9;
      effectVignette.renderToScreen = true;
      this.composer.addPass(effectVignette);
    } else if (this.data.effect === "pixel") {
      this.composer = new EffectComposer(this.renderer);
      // Create params object from str
      const params = getParams(this.data.pixelParams);
      const renderPixelatedPass = new RenderPixelatedPass(
        params.pixelSize,
        this.scene,
        this.camera,
        params
      );
      this.composer.addPass(renderPixelatedPass);
      const outputPass = new ShaderPass(GammaCorrectionShader);
      this.composer.addPass(outputPass);
    } else if (this.data.effect === "glitch") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      let glitchPass = new GlitchPass();
      // Create params object from str
      const params = getParams(this.data.glitchParams);
      glitchPass.goWild = params.goWild;
      glitchPass.enabled = params.enabled;
      this.composer.addPass(glitchPass);
      const outputPass = new ShaderPass(GammaCorrectionShader);
      this.composer.addPass(outputPass);
    } else if (this.data.effect === "sobel") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      let effectSobel = new ShaderPass(SobelOperatorShader);
      // Create params object from str
      const params = getParams(this.data.sobelParams);
      effectSobel.enabled = params.enabled;
      effectSobel.uniforms["resolution"].value.x =
        window.innerWidth * window.devicePixelRatio;
      effectSobel.uniforms["resolution"].value.y =
        window.innerHeight * window.devicePixelRatio;
      this.composer.addPass(effectSobel);
    } else if (this.data.effect === "bloom") {
      this.composer = new EffectComposer(this.renderer);
      const renderScene = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderScene);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          this.renderer.domElement.clientWidth,
          this.renderer.domElement.clientHeight
        ),
        1.5,
        0.4,
        0.85
      );
      const params = getParams(this.data.bloomParams);
      bloomPass.threshold = params.threshold;
      bloomPass.strength = params.strength;
      bloomPass.radius = params.radius;
      this.composer.addPass(bloomPass);

      const outputPass = new OutputPass(THREE.ReinhardToneMapping);
      outputPass.toneMappingExposure = params.exposure;
      this.composer.addPass(outputPass);
    } else if (this.data.effect === "dot-screen") {
      this.composer = new EffectComposer(this.renderer);

      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const effect1 = new ShaderPass(DotScreenShader);
      const params = getParams(this.data.dotScreenParams);
      effect1.uniforms.scale.value = params.scale;
      effect1.uniforms.angle.value = params.angle;
      console.log(effect1);
      this.composer.addPass(effect1);

      const effect2 = new ShaderPass(RGBShiftShader);
      effect2.uniforms["amount"].value = 0.0015;
      this.composer.addPass(effect2);

      const effect3 = new ShaderPass(GammaCorrectionShader);
      this.composer.addPass(effect3);
    } else if (this.data.effect === "volumetric-light") {
      this.DEFAULT_LAYER = 0;
      this.OCCLUSION_LAYER = 1;
      let pass,
        occlusionRenderTarget = new THREE.WebGLRenderTarget(
          this.renderer.domElement.clientWidth * 0.5,
          this.renderer.domElement.clientWidth * 0.5
        );

      this.occlusionComposer = new EffectComposer(
        this.renderer,
        occlusionRenderTarget
      );
      this.occlusionComposer.addPass(new RenderPass(this.scene, this.camera));
      pass = new ShaderPass(VolumetericLightShader);
      // Create params object from str
      const params = getParams(this.data.volumetricLightParams);
      pass.uniforms.decay.value = params.decay;
      pass.uniforms.density.value = params.density;
      pass.uniforms.exposure.value = params.exposure;
      pass.uniforms.samples.value = params.samples;
      this.occlusionComposer.addPass(pass);
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      pass = new ShaderPass(AdditiveBlendingShader);
      pass.uniforms.tAdd.value = occlusionRenderTarget.texture;
      this.composer.addPass(pass);
      pass.renderToScreen = true;
      this.camera.layers.set(this.OCCLUSION_LAYER);
      this.renderer.setClearColor(0x000000);
      this.occlusionComposer.render();
      this.camera.layers.set(this.DEFAULT_LAYER);
      this.renderer.setClearColor(0x090611);
    } else if (this.data.effect === "afterimage") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      let afterimagePass = new AfterimagePass();
      const params = getParams(this.data.afterimageParams);
      afterimagePass.uniforms.damp.value = params.damp;
      this.composer.addPass(afterimagePass);
      const outputPass = new ShaderPass(GammaCorrectionShader);
      this.composer.addPass(outputPass);
    } else if (this.data.effect === "bad-tv") {
      
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      let shaderTime = 0;
      let badTVPass = new ShaderPass(BadTVShader);
      let rgbPass = new ShaderPass(RGBShiftShader);
      let filmPass = new ShaderPass(FilmShader);
      let staticPass = new ShaderPass(StaticShader);
      let copyPass = new ShaderPass(CopyShader);
      filmPass.uniforms.grayscale.value = 0;
      // Create params object from str
      const params = getParams(this.data.badTVParams);
      let staticParams = {
        show: true,
        amount: 0.5,
        size: 4.0,
      };
      let rgbParams = {
        show: true,
        amount: 0.005,
        angle: 0.0,
      };
      let filmParams = {
        show: true,
        count: 800,
        sIntensity: 0.9,
        nIntensity: 0.4,
      };

      badTVPass.uniforms["distortion"].value = params.distortion;
      badTVPass.uniforms["distortion2"].value = params.distortion2;
      badTVPass.uniforms["speed"].value = params.speed;
      badTVPass.uniforms["rollSpeed"].value = params.rollSpeed;
      staticPass.uniforms["amount"].value = staticParams.amount;
      staticPass.uniforms["size"].value = staticParams.size;
      rgbPass.uniforms["angle"].value = rgbParams.angle * Math.PI;
      rgbPass.uniforms["amount"].value = rgbParams.amount;
      filmPass.uniforms["sCount"].value = filmParams.count;
      filmPass.uniforms["sIntensity"].value = filmParams.sIntensity;
      filmPass.uniforms["nIntensity"].value = filmParams.nIntensity;

      this.composer.addPass(badTVPass);
      this.composer.addPass(rgbPass);
      this.composer.addPass(filmPass);
      this.composer.addPass(staticPass);
      this.composer.addPass(copyPass);
      function animate() {
        shaderTime += 0.1;
        badTVPass.uniforms["time"].value = shaderTime;
        filmPass.uniforms["time"].value = shaderTime;
        staticPass.uniforms["time"].value = shaderTime;
        requestAnimationFrame(animate);
      }
      animate();
    }

    function getParams(str) {
      const params = {};
      const cleanedStr = str.replace(/\s/g, "");
      const properties = cleanedStr.split(",");
      for (let i = 0; i < properties.length; i++) {
        const [key, value] = properties[i].split(":");
        params[key] = eval(value);
      }
      return params;
    }

    this.bind();
  },
  tick: function (t, dt) {
    this.t = t;
    this.dt = dt;
  },
  bind: function () {
    const render = this.renderer.render;
    const system = this;
    let isDigest = false;

    this.renderer.render = function () {
      if (isDigest) {
        render.apply(this, arguments);
      } else {
        isDigest = true;
        if (system.occlusionComposer) {
          system.occlusionComposer.render(system.dt);
        } else {
          system.composer.render(system.dt);
        }
        isDigest = false;
      }
    };
  },
});
