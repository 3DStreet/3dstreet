import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// bvh-geometry (#1853): builds three-mesh-bvh bounds trees for meshes
// streamed into the entity's subtree so the globally-patched accelerated
// raycast actually accelerates (without a boundsTree it silently falls back
// to a linear triangle scan). The component reads the prototype patch from
// THREE.BufferGeometry — these tests stub it with a spy so they exercise
// the component's queueing/idle logic hermetically, independent of the
// three-mesh-bvh integration itself.
let THREE;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  THREE = window.THREE;
  await import('../../src/aframe-components/bvh-geometry.js');
  window.AFRAME.emitReady?.();
});

let buildSpy;
beforeEach(() => {
  // Stub the src/three-bvh.js prototype patch: record the build and mark the
  // geometry the way the real computeBoundsTree does.
  buildSpy = vi.fn(function () {
    this.boundsTree = { stub: true };
  });
  THREE.BufferGeometry.prototype.computeBoundsTree = buildSpy;
});

// Big enough to clear the component's MIN_TRIANGLES gate (a 16×16×16-segment
// box ≈ 3k triangles); small stays under it (12 triangles).
function bigMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10, 16, 16, 16),
    new THREE.MeshBasicMaterial()
  );
}
function smallMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial()
  );
}

// The component builds one tree per idle slot (requestIdleCallback with a
// setTimeout fallback); poll until the queue drains.
async function drained(el, timeoutMs = 3000) {
  const comp = el.components['bvh-geometry'];
  const start = Date.now();
  while (comp.queue.length || comp.idleHandle !== null) {
    if (Date.now() - start > timeoutMs) throw new Error('queue never drained');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('bvh-geometry', () => {
  it('builds a bounds tree for large meshes streamed in via setObject3D', async () => {
    const el = await elFactory();
    el.setAttribute('bvh-geometry', '');
    const mesh = bigMesh();
    el.setObject3D('mesh', mesh); // fires object3dset → scan
    await drained(el);
    expect(mesh.geometry.boundsTree).toBeTruthy();
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it('skips small meshes and never rebuilds an existing tree', async () => {
    const el = await elFactory();
    el.setAttribute('bvh-geometry', '');
    const small = smallMesh();
    const big = bigMesh();
    el.setObject3D('mesh', small);
    el.setObject3D('mesh2', big);
    await drained(el);
    expect(small.geometry.boundsTree).toBeUndefined();
    expect(buildSpy).toHaveBeenCalledTimes(1);

    // A later stream-in (osm4vr sets a new object per tile) re-scans the
    // subtree; the already-built geometry must not be queued again.
    el.setObject3D('mesh3', bigMesh());
    await drained(el);
    expect(buildSpy).toHaveBeenCalledTimes(2);
  });

  it('picks up meshes attached before the component initialized', async () => {
    const el = await elFactory();
    const mesh = bigMesh();
    el.setObject3D('mesh', mesh);
    el.setAttribute('bvh-geometry', '');
    await drained(el);
    expect(mesh.geometry.boundsTree).toBeTruthy();
  });

  it('stops processing when removed', async () => {
    const el = await elFactory();
    el.setAttribute('bvh-geometry', '');
    const comp = el.components['bvh-geometry'];
    el.setObject3D('mesh', bigMesh());
    el.removeAttribute('bvh-geometry');
    expect(comp.queue.length).toBe(0);
    expect(comp.idleHandle).toBe(null);
  });
});
