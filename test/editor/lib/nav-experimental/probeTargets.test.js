// ProbeTargets (#1853): the curated raycast-target list for the nav
// floor/enclosure probes — whole scene minus `[data-ignore-raycaster]`
// subtrees, EXCEPT the Google 3D Tiles subtree (an accepted collision
// floor). Parity requirement: a scene with no excluded entities must
// produce exactly the old whole-scene intersect.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  ProbeTargets,
  intersectProbeTargets
} from '../../../../src/editor/lib/nav-experimental/probeTargets.js';

// Minimal A-Frame `.el` stub: answers hasAttribute/getAttribute/id the way
// the exclusion test walks for (mirrors the nav harness's makeEl).
function makeEl(attrs = {}, id) {
  return {
    id,
    hasAttribute: (n) => Object.prototype.hasOwnProperty.call(attrs, n),
    getAttribute: (n) => attrs[n]
  };
}

function makeSceneEl(rootObj) {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = rootObj;
  return sceneEl;
}

function groundMesh() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2; // face up
  ground.el = makeEl({ 'street-segment': '' });
  return ground;
}

// An excluded map-layer group (street-geo shape): entity group carrying
// `data-ignore-raycaster`, with a big mesh inside.
function excludedLayer(id) {
  const group = new THREE.Group();
  group.el = makeEl({ 'data-ignore-raycaster': '' }, id);
  const buildings = new THREE.Mesh(
    new THREE.BoxGeometry(50, 20, 50),
    new THREE.MeshBasicMaterial()
  );
  buildings.position.y = 10;
  group.add(buildings);
  return { group, buildings };
}

let disposables;
beforeEach(() => {
  disposables = [];
});
afterEach(() => {
  for (const d of disposables) d.dispose();
});

function makeTargets(sceneEl) {
  const pt = new ProbeTargets(sceneEl);
  disposables.push(pt);
  return pt;
}

describe('ProbeTargets — target list shape', () => {
  it('yields exactly [scene root] when nothing is excluded (parity)', () => {
    const root = new THREE.Group();
    root.add(groundMesh());
    const pt = makeTargets(makeSceneEl(root));
    expect(pt.targets()).toEqual([root]);
  });

  it('prunes an excluded subtree and keeps the included siblings', () => {
    const root = new THREE.Group();
    const ground = groundMesh();
    root.add(ground);
    const { group } = excludedLayer();
    root.add(group);
    const pt = makeTargets(makeSceneEl(root));
    const targets = pt.targets();
    expect(targets).toContain(ground);
    expect(targets).not.toContain(root);
    expect(targets).not.toContain(group);
  });

  it('prunes a nested excluded subtree (street-geo shape: layer inside a geo entity)', () => {
    const root = new THREE.Group();
    const ground = groundMesh();
    root.add(ground);
    const geoEntity = new THREE.Group(); // [street-geo] container, not excluded
    geoEntity.el = makeEl({ 'street-geo': '' });
    const { group } = excludedLayer();
    geoEntity.add(group);
    root.add(geoEntity);
    const pt = makeTargets(makeSceneEl(root));
    const targets = pt.targets();
    expect(targets).toContain(ground);
    expect(targets).not.toContain(group);
    // The geo entity itself was partially excluded, so it cannot appear
    // wholesale either.
    expect(targets).not.toContain(geoEntity);
  });

  it('keeps the Google 3D Tiles subtree despite data-ignore-raycaster', () => {
    const root = new THREE.Group();
    const byId = excludedLayer('google3d');
    root.add(byId.group);
    const byName = excludedLayer();
    byName.group.el = makeEl({
      'data-ignore-raycaster': '',
      'data-layer-name': 'Google 3D Tiles'
    });
    root.add(byName.group);
    const pt = makeTargets(makeSceneEl(root));
    // No exclusions survive → the whole scene root is the single target.
    expect(pt.targets()).toEqual([root]);
  });

  it('invalidates the cache on child-attached and object3dset', () => {
    const root = new THREE.Group();
    root.add(groundMesh());
    const sceneEl = makeSceneEl(root);
    const pt = makeTargets(sceneEl);
    expect(pt.targets()).toEqual([root]);

    const { group } = excludedLayer();
    root.add(group);
    // Stale until an invalidating scene event fires.
    expect(pt.targets()).toEqual([root]);
    sceneEl.dispatchEvent(new Event('child-attached'));
    expect(pt.targets()).not.toContain(group);

    group.el = makeEl({}); // no longer excluded
    sceneEl.dispatchEvent(new Event('object3dset'));
    expect(pt.targets()).toEqual([root]);
  });

  it('returns [] with no scene / no object3D', () => {
    const pt = makeTargets(null);
    expect(pt.targets()).toEqual([]);
  });
});

describe('intersectProbeTargets', () => {
  // Downward ray from above: the excluded buildings box sits between the
  // camera and the ground, so an unfiltered intersect reports it first.
  function makeProbeScene() {
    const root = new THREE.Group();
    const ground = groundMesh();
    root.add(ground);
    const { group, buildings } = excludedLayer();
    root.add(group);
    root.updateMatrixWorld(true);
    return { root, ground, buildings };
  }

  function castDown(ctx) {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 50, 0),
      new THREE.Vector3(0, -1, 0)
    );
    return intersectProbeTargets(raycaster, ctx);
  }

  it('skips excluded meshes via the service, keeps the floor hit', () => {
    const { root, ground, buildings } = makeProbeScene();
    const sceneEl = makeSceneEl(root);
    const hits = castDown({ sceneEl, probeTargets: makeTargets(sceneEl) });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.object === ground)).toBe(true);
    expect(hits.some((h) => h.object === buildings)).toBe(false);
  });

  it('falls back to the whole scene without the service (external ctx)', () => {
    const { root, buildings } = makeProbeScene();
    const hits = castDown({ sceneEl: makeSceneEl(root) });
    expect(hits.some((h) => h.object === buildings)).toBe(true);
  });

  it('returns [] for a ctx with no scene', () => {
    expect(castDown({ sceneEl: null })).toEqual([]);
  });
});
