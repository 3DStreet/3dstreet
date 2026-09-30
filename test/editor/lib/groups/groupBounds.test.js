import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  getGroupBounds,
  getGroupCenter,
  memberBoundsLocal
} from '@/editor/lib/groups/groupBounds.js';
import { deriveLocalBoxOf } from '@/editor/lib/gizmos/easyGizmoMath.js';
import { boxMesh, entity, expectBox, group, scene } from './_groupFixtures.js';

let sceneEl;
beforeEach(() => {
  sceneEl = scene();
});
afterEach(() => sceneEl.remove());

describe('group bounds and automatic center', () => {
  it('centers on the member geometry, not on the members origins (fails with an origin average)', () => {
    const g = group(sceneEl);
    // Both members' origins sit far from the geometry they draw.
    const a = entity(g, { position: [100, 0, 0] });
    boxMesh(a, [-90, 0, 20], [-88, 2, 22]);
    const b = entity(g, { position: [0, 0, -40] });
    boxMesh(b, [12, 0, 62], [14, 1, 64]);
    sceneEl.object3D.updateMatrixWorld();

    expectBox(getGroupBounds(g), [10, 0, 20], [14, 2, 24]);
    const center = getGroupCenter(g, new THREE.Vector3());
    expect(center.toArray()).toEqual([12, 1, 22]);
  });

  it('includes batched and nested members and leaves out the origin and hidden members (fails with deriveLocalBoxOf or when counting hidden members)', () => {
    // The group origin is 50 m from every member.
    const g = group(sceneEl, { position: [-50, 0, 0] });
    // A batched member has had its meshes stripped; only its cached box is left.
    const batched = entity(g, { position: [50, 0, 0] });
    batched.object3D._batchLocalBbox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 3, 2)
    );
    // A model still downloading shows only its placeholder box.
    const loading = entity(g, { position: [50, 0, 10] });
    loading.object3D._placeholderBbox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1)
    );
    const inner = group(g, { position: [55, 0, 0] });
    const nested = entity(inner, { position: [0, 0, 4] });
    boxMesh(nested, [0, 0, 0], [1, 5, 1]);
    const hidden = entity(g, { position: [200, 0, 0] });
    boxMesh(hidden, [0, 0, 0], [1, 50, 1]);
    hidden.object3D.visible = false;
    sceneEl.object3D.updateMatrixWorld();

    expectBox(getGroupBounds(g), [50, 0, 0], [56, 5, 11]);
    // The generic helper sees neither the descendants' cached boxes nor the
    // hidden rule; this is the path the group box must not take.
    const generic = deriveLocalBoxOf(g.object3D);
    expect(generic?.max.y ?? 0).not.toBeCloseTo(5, 3);
  });

  it('measures in the group frame: a yawed group keeps an unrotated box that its matrix places (fails with a world-axis box)', () => {
    const g = group(sceneEl, { position: [3, 0, 7], yaw: 45 });
    const m = entity(g);
    boxMesh(m, [0, 0, 0], [10, 1, 2]);
    sceneEl.object3D.updateMatrixWorld();

    const local = getGroupBounds(g);
    expectBox(local, [0, 0, 0], [10, 1, 2]);
    const size = local.getSize(new THREE.Vector3());
    expect(size.toArray()).toEqual([10, 1, 2]);
    // The far corner, through the group's matrix, is where the mesh's far
    // corner is in the world.
    const corner = new THREE.Vector3(10, 1, 2).applyMatrix4(
      g.object3D.matrixWorld
    );
    const meshCorner = new THREE.Vector3(10, 1, 2).applyMatrix4(
      m.object3D.matrixWorld
    );
    expect(corner.distanceTo(meshCorner)).toBeLessThan(1e-9);
    // A world-aligned box of the same members is a different, larger shape:
    // both its horizontal sides are (10 + 2) / sqrt(2).
    const world = new THREE.Box3()
      .setFromObject(g.object3D)
      .getSize(new THREE.Vector3());
    expect(world.x).toBeCloseTo(12 / Math.SQRT2, 9);
    expect(world.z).toBeCloseTo(12 / Math.SQRT2, 9);
  });

  it('leaves every descendant matrixWorld as a render traversal computes it (fails with the identity-matrix trick)', () => {
    const outer = group(sceneEl, {
      position: [5, 1, -3],
      yaw: 30,
      scale: [2, 2, 2]
    });
    const g = group(outer, { position: [1, 0, 1], yaw: -70 });
    const a = entity(g, { position: [4, 0, 0], yaw: 10 });
    boxMesh(a, [0, 0, 0], [1, 1, 1]);
    const b = entity(g, { position: [-2, 0, 3] });
    boxMesh(b, [0, 0, 0], [2, 1, 1]);
    sceneEl.object3D.updateMatrixWorld();
    const snapshot = () => {
      const out = [];
      sceneEl.object3D.traverse((node) =>
        out.push(...node.matrixWorld.elements)
      );
      return out;
    };
    const rendered = snapshot();

    memberBoundsLocal(g, new THREE.Box3());
    expect(snapshot()).toEqual(rendered);
    getGroupBounds(g);
    expect(snapshot()).toEqual(rendered);
  });

  it('reports no bounds for a group with no member geometry, and centers it on the origin', () => {
    const g = group(sceneEl, { position: [1, 2, 3] });
    entity(g);
    sceneEl.object3D.updateMatrixWorld();
    expect(getGroupBounds(g)).toBe(null);
    expect(getGroupCenter(g, new THREE.Vector3()).toArray()).toEqual([0, 0, 0]);
  });

  it('uses a stored center only while it is pinned', () => {
    const g = group(sceneEl);
    boxMesh(entity(g), [0, 0, 0], [2, 2, 2]);
    sceneEl.object3D.updateMatrixWorld();
    g.components['group-center'] = {
      data: { pinned: true, pin: { x: 30, y: 0, z: 0 } }
    };
    expect(getGroupCenter(g, new THREE.Vector3()).toArray()).toEqual([
      30, 0, 0
    ]);
    g.components['group-center'].data.pinned = false;
    expect(getGroupCenter(g, new THREE.Vector3()).toArray()).toEqual([1, 1, 1]);
  });
});
