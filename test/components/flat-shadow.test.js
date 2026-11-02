import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const importFlatShadow = async () => ({
  flatShadow: await import('../../src/aframe-components/flat-shadow.js')
});

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  await importFlatShadow();
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

// A white ground plane seen from above, with the sun high to the east. A box
// floating east of centre throws its shadow west of centre, clear of the box
// itself as the camera sees it, so one pixel reads shade and another full sun.
async function makeScene({ shader, receive = true }) {
  const scene = document.createElement('a-scene');
  scene.setAttribute('embedded', '');
  scene.setAttribute('style', 'width: 64px; height: 64px');
  scene.setAttribute('vr-mode-ui', 'enabled: false');
  scene.innerHTML = `
    <a-entity camera position="0 30 0" rotation="-90 0 0"></a-entity>
    <a-entity light="type: ambient; intensity: 0.5"></a-entity>
    <a-entity id="sun-target"></a-entity>
    <a-entity position="10 20 0" light="type: directional; target: #sun-target;
      intensity: 3; castShadow: true; shadowCameraLeft: -12;
      shadowCameraRight: 12; shadowCameraTop: 12; shadowCameraBottom: -12"></a-entity>
    <a-plane rotation="-90 0 0" width="60" height="60"
      material="shader: ${shader}; color: #fff"
      shadow="cast: false; receive: ${receive}"></a-plane>
    <a-box position="2 8 0" width="4" depth="8" height="0.2"
      material="shader: flat; color: #f00"
      shadow="cast: true; receive: false"></a-box>
  `;
  document.body.appendChild(scene);
  mounted.push(scene);
  await new Promise((resolve) => scene.addEventListener('loaded', resolve));
  return scene;
}

// Render once and read the red channel at ground x = -2 (in the box's shadow)
// and x = +12 (full sun). The camera sees ground x in [-25, 25] across the
// canvas, so those land at 46% and 74% of its width.
function sample(scene) {
  const { renderer, object3D, camera } = scene;
  renderer.render(object3D, camera);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const read = (fx) => {
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth * fx),
      Math.floor(gl.drawingBufferHeight / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px
    );
    return px[0];
  };
  return { shadowed: read(0.46), sunlit: read(0.74) };
}

describe('flat-shadow shader', () => {
  it('renders like flat in the sun and darkens in shadow', async () => {
    const flat = sample(await makeScene({ shader: 'flat' }));
    const shaded = sample(await makeScene({ shader: 'flat-shadow' }));
    // Unlit: in the sun it is exactly the flat colour, not lit brighter.
    expect(Math.abs(shaded.sunlit - flat.sunlit)).toBeLessThanOrEqual(1);
    // flat ignores the shadow; flat-shadow darkens under the box.
    expect(Math.abs(flat.shadowed - flat.sunlit)).toBeLessThanOrEqual(1);
    expect(shaded.shadowed).toBeLessThan(shaded.sunlit * 0.8);
  });

  it('applies the shared shadow strength to every material at once', async () => {
    const { setUnlitShadowStrength, DEFAULT_UNLIT_SHADOW_STRENGTH } =
      await import('../../src/aframe-components/flat-shadow.js');
    const scene = await makeScene({ shader: 'flat-shadow' });
    const full = sample(scene);
    const programs = scene.renderer.info.programs.length;
    try {
      setUnlitShadowStrength(0);
      const none = sample(scene);
      expect(Math.abs(none.shadowed - none.sunlit)).toBeLessThanOrEqual(1);
      setUnlitShadowStrength(1);
      const black = sample(scene);
      expect(black.shadowed).toBeLessThan(full.shadowed);
      expect(scene.renderer.info.programs.length).toBe(programs);
    } finally {
      setUnlitShadowStrength(DEFAULT_UNLIT_SHADOW_STRENGTH);
    }
  });

  it('shows no shadow when the mesh does not receive', async () => {
    const off = sample(
      await makeScene({ shader: 'flat-shadow', receive: false })
    );
    expect(Math.abs(off.shadowed - off.sunlit)).toBeLessThanOrEqual(1);
  });

  it('shares one program across every flat-shadow material', async () => {
    const scene = await makeScene({ shader: 'flat-shadow' });
    sample(scene);
    const before = scene.renderer.info.programs.length;
    for (let i = 0; i < 5; i++) {
      const plane = document.createElement('a-plane');
      plane.setAttribute(
        'material',
        `shader: flat-shadow; color: #${i}${i}${i}`
      );
      plane.setAttribute('shadow', 'cast: false; receive: true');
      scene.appendChild(plane);
      await new Promise((resolve) => plane.addEventListener('loaded', resolve));
    }
    sample(scene);
    expect(scene.renderer.info.programs.length).toBe(before);
  });

  it('keeps the a-image defaults when only the shader is set', async () => {
    const scene = await makeScene({ shader: 'flat-shadow' });
    const image = document.createElement('a-image');
    image.setAttribute('material', 'shader: flat-shadow');
    scene.appendChild(image);
    await new Promise((resolve) => image.addEventListener('loaded', resolve));
    const material = image.getObject3D('mesh').material;
    expect(material.isMeshLambertMaterial).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(window.THREE.DoubleSide);
  });
  // A legacy image plane switched over by adding a shadow (ComponentAddCommand)
  // must keep its picture through the shader change.
  it('keeps the image texture when a flat a-image switches shader', async () => {
    const scene = await makeScene({ shader: 'flat-shadow' });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const image = document.createElement('a-image');
    image.setAttribute('src', canvas.toDataURL());
    const loaded = (el) =>
      new Promise((resolve) =>
        el.addEventListener('materialtextureloaded', resolve, { once: true })
      );
    let textured = loaded(image);
    scene.appendChild(image);
    await textured;
    expect(image.getAttribute('material').shader).toBe('flat');
    textured = loaded(image);
    image.setAttribute('material', 'shader', 'flat-shadow');
    await textured;
    const material = image.getObject3D('mesh').material;
    expect(material.isMeshLambertMaterial).toBe(true);
    expect(material.map).toBeTruthy();
    expect(material.transparent).toBe(true);
  });
  // 3D Tiles: each tile's unlit material is swapped as it loads.
  it('swaps unlit tile meshes to flat-shadow, keeping their state', async () => {
    const { flatShadow } = await importFlatShadow();
    const THREE = window.THREE;
    const map = new THREE.Texture();
    const basic = new THREE.MeshBasicMaterial({
      map,
      color: 0x808080,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });
    let disposed = false;
    basic.addEventListener('dispose', () => (disposed = true));
    const lit = new THREE.MeshStandardMaterial();
    const tile = new THREE.Group();
    const unlitMesh = new THREE.Mesh(new THREE.PlaneGeometry(), basic);
    const litMesh = new THREE.Mesh(new THREE.PlaneGeometry(), lit);
    tile.add(unlitMesh, litMesh);

    flatShadow.receiveShadowsOnUnlit(tile);

    const swapped = unlitMesh.material;
    expect(swapped.isMeshLambertMaterial).toBe(true);
    expect(swapped.map).toBe(map);
    expect(swapped.color.getHex()).toBe(0x808080);
    expect(swapped.transparent).toBe(true);
    expect(swapped.opacity).toBe(0.5);
    expect(swapped.side).toBe(THREE.DoubleSide);
    expect(unlitMesh.receiveShadow).toBe(true);
    expect(unlitMesh.castShadow).toBe(false);
    expect(disposed).toBe(true);
    // Already-lit materials are left alone.
    expect(litMesh.material).toBe(lit);
    expect(litMesh.receiveShadow).toBe(false);
  });
});
