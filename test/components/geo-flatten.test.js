import { beforeAll, describe, expect, it } from 'vitest';
import { elFactory } from './helpers.js';

// geo-flatten (#1476): per-entity terrain-flattening volumes feeding the
// scene-level registry that google-maps-aerial consumes. These tests cover
// the registry lifecycle (including the enabled toggle and detach), mesh-mode
// source resolution, and the auto-mode footprint proxy — the pieces that can
// be exercised without a live tileset.
beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/geo-flatten.js');
  window.AFRAME.emitReady();
});

async function makeFlattenEntity(attrs = 'mode: mesh') {
  const el = await elFactory();
  el.setAttribute('geometry', 'primitive: box; width: 2; height: 2; depth: 2');
  el.setAttribute('geo-flatten', attrs);
  return el;
}

describe('geo-flatten', () => {
  it('registers the component and system', () => {
    expect(window.AFRAME.components['geo-flatten']).toBeDefined();
    expect(window.AFRAME.systems['geo-flatten']).toBeDefined();
  });

  // Note: assertions on registry membership use boolean .includes() rather
  // than toContain — vitest's failure inspection walks the component's el →
  // sceneEl and invokes A-Frame's legacy scene.inspect() method, crashing
  // the reporter.
  it('registers with the scene system and reports active', async () => {
    const el = await makeFlattenEntity();
    const system = el.sceneEl.systems['geo-flatten'];
    const comp = el.components['geo-flatten'];
    expect(system.components.has(comp)).toBe(true);
    expect(system.getActiveComponents().includes(comp)).toBe(true);
  });

  it('drops out of the active set when disabled, without unregistering', async () => {
    const el = await makeFlattenEntity();
    const system = el.sceneEl.systems['geo-flatten'];
    const comp = el.components['geo-flatten'];
    el.setAttribute('geo-flatten', 'enabled', false);
    expect(system.components.has(comp)).toBe(true);
    expect(system.getActiveComponents().includes(comp)).toBe(false);
    el.setAttribute('geo-flatten', 'enabled', true);
    expect(system.getActiveComponents().includes(comp)).toBe(true);
  });

  it('emits geo-flatten-registry-changed on updates', async () => {
    const el = await makeFlattenEntity();
    let events = 0;
    el.sceneEl.addEventListener('geo-flatten-registry-changed', () => {
      events++;
    });
    el.setAttribute('geo-flatten', 'enabled', false);
    expect(events).toBeGreaterThan(0);
  });

  it('unregisters when the entity is detached', async () => {
    const el = await makeFlattenEntity();
    const system = el.sceneEl.systems['geo-flatten'];
    const comp = el.components['geo-flatten'];
    el.parentNode.removeChild(el);
    // A-Frame detaches components asynchronously on removal.
    await new Promise((resolve) => setTimeout(resolve));
    expect(system.components.has(comp)).toBe(false);
  });

  it('mesh mode returns the entity mesh', async () => {
    const el = await makeFlattenEntity('mode: mesh');
    const mesh = el.components['geo-flatten'].getFlattenMesh();
    expect(mesh).toBeTruthy();
    expect(mesh.isMesh).toBe(true);
    expect(mesh).toBe(el.getObject3D('mesh'));
  });

  it('auto mode builds a footprint proxy plane from the subtree bounds', async () => {
    const el = await elFactory();
    el.setAttribute('geo-flatten', 'mode: auto');

    // Two child boxes spanning x in [-6, 2] and z in [-1, 11] overall.
    const THREE = window.AFRAME.THREE;
    const boxA = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2)); // x [-2,2], z [-1,1]
    const boxB = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2));
    boxB.position.set(-4, 0, 10); // x [-6,-2], z [9,11]
    el.setObject3D('boxA', boxA);
    const child = document.createElement('a-entity');
    el.appendChild(child);
    await new Promise((resolve) => setTimeout(resolve));
    child.setObject3D('boxB', boxB);
    el.sceneEl.object3D.updateMatrixWorld(true);

    const comp = el.components['geo-flatten'];
    comp.proxyDirty = true; // bypass the mutation-event debounce
    const proxy = comp.getFlattenMesh();
    expect(proxy).toBeTruthy();
    expect(proxy.isMesh).toBe(true);
    // Proxy must not be part of the rendered scene graph.
    expect(proxy.parent).toBe(null);

    // Footprint: x size 8 centered at -2, z size 12 centered at 5, at y=0.
    expect(proxy.scale.x).toBeCloseTo(8);
    expect(proxy.scale.z).toBeCloseTo(12);
    expect(proxy.position.x).toBeCloseTo(-2);
    expect(proxy.position.z).toBeCloseTo(5);
    expect(proxy.position.y).toBeCloseTo(0);
  });

  it('auto mode proxy matrixWorld follows the entity transform', async () => {
    const el = await elFactory();
    el.setAttribute('geo-flatten', 'mode: auto');
    const THREE = window.AFRAME.THREE;
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2));
    el.setObject3D('box', box);
    el.object3D.position.set(100, 5, -50);
    el.sceneEl.object3D.updateMatrixWorld(true);

    const comp = el.components['geo-flatten'];
    comp.proxyDirty = true;
    const proxy = comp.getFlattenMesh();
    const worldPos = new THREE.Vector3().setFromMatrixPosition(
      proxy.matrixWorld
    );
    expect(worldPos.x).toBeCloseTo(100);
    expect(worldPos.y).toBeCloseTo(5);
    expect(worldPos.z).toBeCloseTo(-50);
  });

  it('auto mode returns null while the subtree has no meshes', async () => {
    const el = await elFactory();
    el.setAttribute('geo-flatten', 'mode: auto');
    const comp = el.components['geo-flatten'];
    expect(comp.getFlattenMesh()).toBe(null);
    // Once content arrives it recovers (proxyDirty stays set on empty reads).
    const THREE = window.AFRAME.THREE;
    el.setObject3D('box', new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2)));
    el.sceneEl.object3D.updateMatrixWorld(true);
    expect(comp.getFlattenMesh()).toBeTruthy();
  });
});
