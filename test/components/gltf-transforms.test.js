import { beforeAll, describe, expect, it } from 'vitest';
// The editor's exporter copy: the npm `three` package, NOT window.THREE (A-Frame's bundled
// super-three) — mirrors production, where the exporter serializes the live scene graph.
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

let THREE;
let transformUVs;
let addGLBMetadata;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  THREE = window.THREE;
  ({ transformUVs, addGLBMetadata } =
    await import('../../src/editor/components/modals/ScreenshotModal/gltfTransforms.js'));
  window.AFRAME.emitReady?.();
});

// A scene with one textured mesh whose texture was "loaded from a webp image":
// GLTFLoader stamps userData.mimeType on textures it loads, and GLTFExporter keeps
// such textures as webp and marks EXT_texture_webp as a REQUIRED extension.
function makeWebpTexturedScene() {
  const scene = new THREE.Scene();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f00';
  ctx.fillRect(0, 0, 4, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData.mimeType = 'image/webp';
  const material = new THREE.MeshBasicMaterial({ map: texture });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  return scene;
}

function exportGlb(scene) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, resolve, reject, { binary: true });
  });
}

describe('gltfTransforms on a GLB with webp textures', () => {
  it('post-processes a GLB whose exporter output requires EXT_texture_webp', async () => {
    const glb = await exportGlb(makeWebpTexturedScene());
    // Sanity: the exporter really did declare the required extension the reader
    // must have registered. Decode only the JSON chunk: 12-byte GLB header,
    // then [u32 chunkLength][u32 chunkType] with the chunk data at byte 20.
    const jsonLength = new DataView(glb).getUint32(12, true);
    const json = new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength));
    expect(json).toContain('EXT_texture_webp');

    const transformed = await transformUVs(glb);
    expect(transformed.byteLength).toBeGreaterThan(0);

    // Pass the Uint8Array as-is, mirroring AppMenu.jsx's export flow.
    const withMetadata = await addGLBMetadata(transformed, {
      longitude: 1,
      latitude: 2
    });
    expect(withMetadata.byteLength).toBeGreaterThan(0);
  });
});
