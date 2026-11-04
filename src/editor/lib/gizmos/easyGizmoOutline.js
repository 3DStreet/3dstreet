import {
  Box3,
  Camera,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  NearestFilter,
  NoBlending,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const TARGET_LIMIT = 1024;
const CROP_BUCKET = 32;
const CROP_PADDING = 4;
const SAMPLES_PER_AXIS = 2;
// Five visible surface IDs plus background fit well apart in an 8-bit channel.
const SURFACE_ID_STEP = 1 / 8;
const OUTLINE_RADIUS_CSS_PX = 0.5;

// Only the cyan surfaces enter this scene. Its depth cannot include scene
// objects, yellow handles, or invisible picking geometry.
export function installEasyGizmoOutline(sceneEl, controls) {
  const renderer = sceneEl.renderer;
  const scene = sceneEl.object3D;
  const overlayScene = new Scene();
  overlayScene.add(new HemisphereLight(0xffffff, 0x647880, 2));
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(-3, 8, 5);
  overlayScene.add(light);
  const parts = [];
  let nextId = 2;
  controls.arcGroup.traverse((source) => {
    if (!source.isMesh || source.userData.isPickProxy) return;
    // Both shaft halves share an ID to suppress their construction seam.
    const id =
      source === controls.arcHalfA || source === controls.arcHalfB
        ? 1
        : nextId++;
    const mask = new MeshBasicMaterial({
      color: new Color().setRGB(id * SURFACE_ID_STEP, 0, 0),
      side: source.material.side,
      blending: NoBlending,
      toneMapped: false
    });
    const beauty = source.material.clone();
    beauty.depthTest = true;
    beauty.depthWrite = false;
    const mesh = new Mesh(source.geometry, mask);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    overlayScene.add(mesh);
    parts.push({ source, mesh, mask, beauty });
  });
  const size = new Vector2();
  const viewport = new Vector4();
  const bounds = new Box3();
  const partBounds = new Box3();
  const corner = new Vector3();
  const cropCamera = new Camera();
  cropCamera.matrixAutoUpdate = false;
  const cropProjection = new Matrix4();
  const maskTarget = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter
  });
  const colorTarget = new WebGLRenderTarget(1, 1);
  const composite = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    defines: {
      ID_EDGE_THRESHOLD: SURFACE_ID_STEP / 2,
      OUTLINE_LINEAR_GREY: 0.006,
      SAMPLES_PER_AXIS
    },
    uniforms: {
      colorMap: { value: colorTarget.texture },
      maskMap: { value: maskTarget.texture },
      pixel: { value: new Vector2(1, 1) },
      sampleStep: { value: new Vector2(1, 1) },
      clipRect: { value: new Vector4(1, 1, 0, 0) }
    },
    vertexShader: `varying vec2 vUv;
      uniform vec4 clipRect;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy * clipRect.xy + clipRect.zw, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D colorMap;
      uniform sampler2D maskMap;
      uniform vec2 pixel;
      uniform vec2 sampleStep;
      varying vec2 vUv;
      vec4 outlinedSample(vec2 uv) {
        vec4 color = texture2D(colorMap, uv);
        float center = texture2D(maskMap, uv).r;
        float edge = 0.0;
        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            float other = texture2D(maskMap,
              uv + vec2(float(x), float(y)) * pixel).r;
            edge = max(edge, step(ID_EDGE_THRESHOLD, abs(center - other)));
          }
        }
        // Keep premultiplied linear colour while resolving coverage, so the
        // transparent background cannot create a dark fringe on cyan edges.
        return vec4(mix(color.rgb, vec3(OUTLINE_LINEAR_GREY), edge), max(color.a, edge));
      }
      void main() {
        vec4 color = vec4(0.0);
        for (int x = 0; x < SAMPLES_PER_AXIS; x++) {
          for (int y = 0; y < SAMPLES_PER_AXIS; y++) {
            float midpoint = float(SAMPLES_PER_AXIS - 1) * 0.5;
            color += outlinedSample(vUv + (vec2(float(x), float(y)) - midpoint) * sampleStep);
          }
        }
        color /= float(SAMPLES_PER_AXIS * SAMPLES_PER_AXIS);
        vec3 rgb = color.a > 0.0 ? color.rgb / color.a : vec3(0.0);
        gl_FragColor = vec4(rgb, color.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const quad = new FullScreenQuad(composite);
  const clearColor = new Color();
  let insideOverlay = false;
  let disposed = false;
  const originalRender = renderer.render;

  // Project a conservative bound (including the full shared torus geometry).
  // Bucket dimensions so ordinary dragging does not reallocate GPU textures.
  const prepareCrop = (camera) => {
    bounds.makeEmpty();
    for (const { source } of parts) {
      if (!source.visible) continue;
      if (!source.geometry.boundingBox) source.geometry.computeBoundingBox();
      partBounds
        .copy(source.geometry.boundingBox)
        .applyMatrix4(source.matrixWorld);
      bounds.union(partBounds);
    }
    if (bounds.isEmpty()) return false;
    let left = Infinity;
    let bottom = Infinity;
    let right = -Infinity;
    let top = -Infinity;
    let crossesNear = false;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z
      );
      corner.applyMatrix4(camera.matrixWorldInverse);
      if (corner.z >= -camera.near) crossesNear = true;
      corner.applyMatrix4(camera.projectionMatrix);
      left = Math.min(left, corner.x);
      right = Math.max(right, corner.x);
      bottom = Math.min(bottom, corner.y);
      top = Math.max(top, corner.y);
    }
    if (crossesNear) {
      left = bottom = -1;
      right = top = 1;
    }
    if (right < -1 || left > 1 || top < -1 || bottom > 1) return false;
    const x =
      Math.floor(((Math.max(-1, left) + 1) * viewport.z) / 2) - CROP_PADDING;
    const y =
      Math.floor(((Math.max(-1, bottom) + 1) * viewport.w) / 2) - CROP_PADDING;
    const w =
      Math.ceil(
        (((Math.min(1, right) + 1) * viewport.z) / 2 - x + CROP_PADDING) /
          CROP_BUCKET
      ) * CROP_BUCKET;
    const h =
      Math.ceil(
        (((Math.min(1, top) + 1) * viewport.w) / 2 - y + CROP_PADDING) /
          CROP_BUCKET
      ) * CROP_BUCKET;
    size.set(
      Math.min(TARGET_LIMIT, w * SAMPLES_PER_AXIS),
      Math.min(TARGET_LIMIT, h * SAMPLES_PER_AXIS)
    );
    maskTarget.setSize(size.x, size.y);
    colorTarget.setSize(size.x, size.y);
    composite.uniforms.pixel.value.set(
      (OUTLINE_RADIUS_CSS_PX * renderer.getPixelRatio()) / w,
      (OUTLINE_RADIUS_CSS_PX * renderer.getPixelRatio()) / h
    );
    composite.uniforms.sampleStep.value.set(
      1 / (SAMPLES_PER_AXIS * w),
      1 / (SAMPLES_PER_AXIS * h)
    );
    composite.uniforms.clipRect.value.set(
      w / viewport.z,
      h / viewport.w,
      (2 * x + w) / viewport.z - 1,
      (2 * y + h) / viewport.w - 1
    );
    cropProjection.set(
      viewport.z / w,
      0,
      0,
      (viewport.z - 2 * x - w) / w,
      0,
      viewport.w / h,
      0,
      (viewport.w - 2 * y - h) / h,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    );
    cropCamera.projectionMatrix.multiplyMatrices(
      cropProjection,
      camera.projectionMatrix
    );
    cropCamera.projectionMatrixInverse
      .copy(cropCamera.projectionMatrix)
      .invert();
    cropCamera.matrixWorld.copy(camera.matrixWorld);
    cropCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
    cropCamera.matrix.copy(camera.matrixWorld);
    cropCamera.layers.mask = camera.layers.mask;
    cropCamera.near = camera.near;
    cropCamera.far = camera.far;
    cropCamera.isOrthographicCamera = camera.isOrthographicCamera === true;
    cropCamera.isPerspectiveCamera = camera.isPerspectiveCamera === true;
    return true;
  };

  const renderWithOutline = function (renderedScene, camera) {
    let visible = true;
    for (let parent = controls.arcGroup; parent; parent = parent.parent) {
      visible = visible && parent.visible;
    }
    const active =
      controls.axis === 'rotate' &&
      (controls.isDragging || controls._lastPointerType === 'mouse');
    if (
      disposed ||
      !active ||
      !visible ||
      !controls.enabled ||
      !controls.object ||
      insideOverlay ||
      renderedScene !== scene ||
      renderer.getRenderTarget() !== null ||
      camera.isArrayCamera ||
      renderer.xr.isPresenting
    ) {
      return originalRender.apply(this, arguments);
    }
    insideOverlay = true;
    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    const xrEnabled = renderer.xr.enabled;
    try {
      controls.arcGroup.visible = false;
      originalRender.call(renderer, scene, camera);
      controls.arcGroup.visible = true;
      controls.arcGroup.updateWorldMatrix(true, true);
      renderer.getCurrentViewport(viewport);
      if (!prepareCrop(camera)) return;
      for (const part of parts) {
        part.mesh.matrix.copy(part.source.matrixWorld);
        part.mesh.visible = part.source.visible;
        part.mesh.material = part.mask;
        part.beauty.color.copy(part.source.material.color);
        part.beauty.opacity = part.source.material.opacity;
      }
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(maskTarget);
      renderer.clear();
      originalRender.call(renderer, overlayScene, cropCamera);
      renderer.setRenderTarget(colorTarget);
      renderer.clear();
      // Depth prepass: only the nearest cyan surface contributes transparency.
      for (const part of parts) part.mask.colorWrite = false;
      originalRender.call(renderer, overlayScene, cropCamera);
      for (const part of parts) {
        part.mask.colorWrite = true;
        part.mesh.material = part.beauty;
      }
      originalRender.call(renderer, overlayScene, cropCamera);
      renderer.setRenderTarget(target, cubeFace, mipLevel);
      quad.render(renderer);
    } finally {
      controls.arcGroup.visible = true;
      for (const part of parts) part.mask.colorWrite = true;
      renderer.setRenderTarget(target, cubeFace, mipLevel);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xrEnabled;
      insideOverlay = false;
    }
  };
  renderer.render = renderWithOutline;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (renderer.render === renderWithOutline) {
        renderer.render = originalRender;
      }
      for (const part of parts) {
        part.mask.dispose();
        part.beauty.dispose();
      }
      maskTarget.dispose();
      colorTarget.dispose();
      composite.dispose();
      quad.dispose();
    }
  };
}
