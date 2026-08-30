import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { elFactory } from './helpers.js';
import {
  FILL_LIFT_M,
  fillPaintOrder
} from '../../src/aframe-components/shapeFillRender.js';

// shape.js statically imports the app store, which pulls in the Firebase/PostHog
// dependency chain at module scope. managed-street.js dodges the same hazard with
// a lazy import; here the component only ever reads `unitsPreference` and takes
// one selector subscription, so a two-method stub is enough and keeps the fix
// test-local. See managed-street-json.test.js for the same reasoning.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ unitsPreference: 'metric' }),
    subscribe: () => () => {}
  }
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  window.AFRAME.emitReady();
});

// Every derive is deferred through requestAnimationFrame — update() only ever
// asks for one, it never derives inline. So anything read about the BUILT
// geometry on the line after a setAttribute reports the PREVIOUS derive. One
// frame settles any number of changes made in the same tick.
const nextFrame = () => new Promise(requestAnimationFrame);

// Stands in for the exporter's own filterHelpers, which is declared const and
// never exported, so a test cannot reach it. The contract asserted here is only
// that the INSPECTOR marker tracks paintedness — the exporter's own handling of
// that marker is not exercised by this file or any other.
const hideHelpers = (root, visible) =>
  root.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') o.visible = visible;
  });

const exportGltf = (root) =>
  new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: false });
  });

// Every elFactory() call mounts its own a-scene, and each one keeps a WebGL
// render loop running for as long as it is in the document. Left to accumulate,
// they starve the browser and the export case times out. Torn down per test.
const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

// A shape has a fill only if it has three shape-vertex CHILDREN — positions on
// the entity are not vertices — and only after a frame has passed.
async function makeShape(attrs) {
  const el = await elFactory();
  mounted.push(el.sceneEl);
  return addShape(el, attrs);
}

// Mounting an a-scene is by far the most expensive thing this file does, so a
// test needing two shapes puts the second in the first one's scene rather than
// standing up another.
async function addShapeToSceneOf(el, attrs) {
  const sibling = document.createElement('a-entity');
  el.sceneEl.appendChild(sibling);
  return addShape(sibling, attrs);
}

// Vertices sit at a non-zero height deliberately: the cap's y is the first
// vertex's y PLUS the lift, and a fixture on the ground plane would assert only
// the second term — so dropping the base would stay green while flattening
// every mid-draw preview fill onto y=0 regardless of street elevation.
const FIXTURE_Y = 2;

async function addShape(el, attrs) {
  el.setAttribute('shape', attrs);
  for (const [x, z] of [
    [0, 0],
    [10, 0],
    [10, 10]
  ]) {
    const v = document.createElement('a-entity');
    v.setAttribute('shape-vertex', '');
    v.setAttribute('position', { x, y: FIXTURE_Y, z });
    el.appendChild(v);
  }
  await nextFrame();
  return el;
}

const fillMeshes = (el) => el.components.shape.fillGroup.children;

describe('shape fill — the build gate', () => {
  it('builds the cap when it is needed for either job, and only then', async () => {
    // Painted and clickable.
    const first = await makeShape(
      'closed: true; selectInside: true; fillOpacity: 40'
    );
    expect(fillMeshes(first)).toHaveLength(1);

    // Clickable but unpainted — the original behaviour, still a click target.
    let el = await addShapeToSceneOf(
      first,
      'closed: true; selectInside: true; fillOpacity: 0'
    );
    expect(fillMeshes(el)).toHaveLength(1);

    // Painted but not clickable — a backdrop that must not swallow clicks.
    el = await addShapeToSceneOf(
      first,
      'closed: true; selectInside: false; fillOpacity: 40'
    );
    expect(fillMeshes(el)).toHaveLength(1);

    // Neither: no cap at all.
    el = await addShapeToSceneOf(
      first,
      'closed: true; selectInside: false; fillOpacity: 0'
    );
    expect(fillMeshes(el)).toHaveLength(0);
  });

  it('builds and tears the cap down as opacity crosses zero', async () => {
    const el = await makeShape(
      'closed: true; selectInside: false; fillOpacity: 0'
    );
    expect(fillMeshes(el)).toHaveLength(0);

    el.setAttribute('shape', 'fillOpacity', 40);
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(1);

    el.setAttribute('shape', 'fillOpacity', 0);
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(0);
  });

  it('takes an unclickable fill out of the raycast without clearing its entity', async () => {
    // Clearing `.el` would resolve the hit to "nothing" and, because only the
    // CLOSEST intersection is considered, block selection of what is behind.
    const THREE = window.THREE;
    // Straight down through (7, 3), which is inside the ring. A default-built
    // Raycaster would miss the cap entirely and make the negative assertion
    // below unfalsifiable, so the clickable cap is asserted as a positive
    // control on the very same ray.
    const castAt = (mesh) => {
      mesh.updateMatrixWorld(true);
      const hits = [];
      mesh.raycast(
        new THREE.Raycaster(
          new THREE.Vector3(7, 10, 3),
          new THREE.Vector3(0, -1, 0)
        ),
        hits
      );
      return hits;
    };

    const clickable = await makeShape(
      'closed: true; selectInside: true; fillOpacity: 40'
    );
    const unclickable = await addShapeToSceneOf(
      clickable,
      'closed: true; selectInside: false; fillOpacity: 40'
    );
    expect(castAt(fillMeshes(clickable)[0])).toHaveLength(1);

    const mesh = fillMeshes(unclickable)[0];
    expect(castAt(mesh)).toHaveLength(0);
    expect(mesh.el).toBe(unclickable);
  });
});

describe('shape fill — material state', () => {
  // _syncFillMaterial runs synchronously from update(), so these are read
  // immediately and deliberately — no frame needed.
  it('holds transparent and depthWrite constant across the whole range', async () => {
    // Including at 100%. Two fills must never depth-compare against each other:
    // the depth buffer cannot resolve two coplanar caps, and it is what an
    // earlier design leaned on and had to abandon. A regression here would
    // reintroduce the z-fighting the paint-order rule replaced, and it would
    // show up only where two fills overlap at full opacity.
    const el = await makeShape('closed: true; fillOpacity: 0');
    const m = el.components.shape.fillMaterial;
    const seen = [];
    for (const pct of [0, 40, 99, 100, 40, 0]) {
      el.setAttribute('shape', 'fillOpacity', pct);
      seen.push({ transparent: m.transparent, depthWrite: m.depthWrite });
    }
    expect(seen).toHaveLength(6);
    expect(seen.map((s) => s.transparent)).toEqual(Array(6).fill(true));
    expect(seen.map((s) => s.depthWrite)).toEqual(Array(6).fill(false));
    // And no program rebuild anywhere in that scrub. `needsUpdate` is
    // set-only in three, so the readable counter behind it is what proves it:
    // `version` increments on every needsUpdate = true, and a shader recompile
    // per scrub step is a stutter on a heavy scene.
    const versionBefore = m.version;
    for (const pct of [40, 99, 100, 40, 0]) {
      el.setAttribute('shape', 'fillOpacity', pct);
    }
    expect(m.version).toBe(versionBefore);
  });

  it('carries colour, lift and draw order onto the built mesh', async () => {
    // The pure module is well covered on its own; this is the wiring, where a
    // dropped argument or a sign error would otherwise pass every other test.
    const el = await makeShape(
      'closed: true; fillColor: #ff0000; fillOpacity: 40'
    );
    const comp = el.components.shape;
    const mesh = fillMeshes(el)[0];
    expect(comp.fillMaterial.color.getHexString()).toBe('ff0000');
    expect(comp.area).toBeCloseTo(50, 5);
    expect(mesh.position.y).toBeCloseTo(FIXTURE_Y + FILL_LIFT_M, 12);
    expect(mesh.renderOrder).toBe(fillPaintOrder(FIXTURE_Y, comp.area));
  });

  it('reads the plane height from the entity AND the vertex, not either alone', async () => {
    // A committed shape carries its centroid on the entity and its vertices
    // relative to it, so a paint order taken from either term alone is wrong
    // for every shape the draw tool produces. Moving the entity up must raise
    // the order even though no vertex moved.
    // It also goes through the real trigger: moving the whole entity moves no
    // vertex, so the vertex dirty-check cannot see it and the system tick's
    // unconditional syncFillOrder is what has to catch it. Driven by a frame,
    // not by calling rederive() by hand, because calling it by hand is exactly
    // what hid this in the first place.
    const el = await makeShape('closed: true; fillOpacity: 40');
    const atGround = fillMeshes(el)[0].renderOrder;
    const meshBefore = fillMeshes(el)[0];
    el.setAttribute('position', { x: 0, y: 5, z: 0 });
    await nextFrame();
    const raised = fillMeshes(el)[0].renderOrder;
    expect(raised).toBeGreaterThan(atGround);
    expect(raised).toBe(
      fillPaintOrder(5 + FIXTURE_Y, el.components.shape.area)
    );
    // And it did NOT rebuild the cap to do it: the geometry is entity-local, so
    // a translation cannot change it, and a rebuild every frame of a gizmo drag
    // would be waste. Asserted on the MESH rather than its geometry: the
    // stronger claim, and it survives a future geometry cache.
    expect(fillMeshes(el)[0]).toBe(meshBefore);
    // The build seeded the cache, so the first tick after it was a no-op — the
    // premise the per-frame cost rests on.
    expect(el.components.shape._fillPlaneY).toBeCloseTo(5 + FIXTURE_Y, 12);
  });

  it('paints a higher fill over a lower one, in one scene, at full opacity', async () => {
    // The composed claim end to end: the pure function is covered separately,
    // this is that two real shapes come out in the right order. At 100%, which
    // is where a depth-ordered design failed.
    const low = await makeShape('closed: true; fillOpacity: 100');
    const high = await addShapeToSceneOf(low, 'closed: true; fillOpacity: 100');
    high.setAttribute('position', { x: 0, y: 1, z: 0 });
    await nextFrame();
    // Same area, so only the metre of height separates them.
    expect(low.components.shape.area).toBeCloseTo(
      high.components.shape.area,
      9
    );
    expect(fillMeshes(high)[0].renderOrder).toBeGreaterThan(
      fillMeshes(low)[0].renderOrder
    );
    // And neither writes depth, so nothing can fight whatever the order says.
    expect(low.components.shape.fillMaterial.depthWrite).toBe(false);
    expect(high.components.shape.fillMaterial.depthWrite).toBe(false);
  });

  it('paints a smaller fill over a larger one at the same height, at full opacity', async () => {
    const big = await makeShape('closed: true; fillOpacity: 100');
    const small = await addShapeToSceneOf(
      big,
      'closed: true; fillOpacity: 100'
    );
    // Let the second shape settle BEFORE shrinking it, or its first derive
    // lands after the move and the test asserts the initial build rather than
    // a re-derive — passing either way.
    await nextFrame();
    const v = small.querySelectorAll('[shape-vertex]');
    v[v.length - 1].setAttribute('position', { x: 4, y: FIXTURE_Y, z: 4 });
    await nextFrame();
    expect(small.components.shape.area).toBeLessThan(big.components.shape.area);
    // The premise: both planes are equal, so this is a pure area comparison.
    expect(small.components.shape._fillPlaneY).toBe(
      big.components.shape._fillPlaneY
    );
    expect(fillMeshes(small)[0].renderOrder).toBeGreaterThan(
      fillMeshes(big)[0].renderOrder
    );
  });

  it('re-derives the draw order when the shape changes size', async () => {
    // The wiring that makes "smaller on top" follow an edit. The paint order is
    // set in _addFill from the area computed in the same derive, so a stale
    // order here would mean the two had come apart.
    const el = await makeShape('closed: true; fillOpacity: 40');
    const comp = el.components.shape;
    const before = fillMeshes(el)[0].renderOrder;
    const v = el.querySelectorAll('[shape-vertex]');
    v[v.length - 1].setAttribute('position', { x: 40, y: FIXTURE_Y, z: 20 });
    // Driven by a frame, not by calling rederive() by hand: the dirty-check in
    // the system tick is half of what this test's name claims to cover, and a
    // hand call skips it. Deleting the dirty flag from positionsChanged left
    // all 13 green while every live vertex drag went stale.
    await nextFrame();
    const after = fillMeshes(el)[0].renderOrder;
    expect(comp.area).toBeGreaterThan(50);
    expect(after).toBeLessThan(before);
    expect(after).toBe(fillPaintOrder(FIXTURE_Y, comp.area));
  });

  it('clamps an out-of-range opacity to full colour, still transparent-queued', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    el.setAttribute('shape', 'fillOpacity', 170);
    const m = el.components.shape.fillMaterial;
    expect(m.opacity).toBe(1);
    // Fully opaque in colour, still a transparent-queue surface — see above.
    expect(m.transparent).toBe(true);
  });

  it('draws nothing at zero opacity without ever hiding the mesh', async () => {
    // `visible: false` would drop the cap from the editor's pick list and would
    // be flipped back to true by the exporter's unconditional restore.
    const el = await makeShape('closed: true; fillOpacity: 0');
    const comp = el.components.shape;
    expect(comp.fillMaterial.colorWrite).toBe(false);
    expect(comp.fillGroup.visible).toBe(true);
    expect(fillMeshes(el)[0].visible).toBe(true);
  });
});

describe('shape fill — export follows visibility', () => {
  it('marks an unpainted fill as editor-only and a painted one as content', async () => {
    const el = await makeShape('closed: true; fillOpacity: 0');
    const { userData } = el.components.shape.fillGroup;
    expect(userData.source).toBe('INSPECTOR');

    el.setAttribute('shape', 'fillOpacity', 40);
    expect('source' in userData).toBe(false);

    el.setAttribute('shape', 'fillOpacity', 0);
    expect(userData.source).toBe('INSPECTOR');
  });

  it('puts a painted fill in the exported file and leaves an unpainted one out', async () => {
    const painted = await makeShape('closed: true; fillOpacity: 40');
    const unpainted = await addShapeToSceneOf(
      painted,
      'closed: true; fillOpacity: 0'
    );
    const paintedMesh = fillMeshes(painted)[0];
    const unpaintedMesh = fillMeshes(unpainted)[0];
    paintedMesh.name = 'painted-fill';
    unpaintedMesh.name = 'unpainted-fill';

    const names = async (root) => {
      const gltf = await exportGltf(root);
      return (gltf.nodes || []).map((n) => n.name);
    };

    // Both fills are exported from ONE root, alongside a control node that is
    // always visible: without it, "unpainted-fill is absent" would also pass on
    // an export that produced nothing at all.
    const THREE = window.THREE;
    const root = new THREE.Group();
    const control = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial()
    );
    control.name = 'control';
    root.add(control, paintedMesh.parent, unpaintedMesh.parent);

    hideHelpers(root, false);
    const exported = await names(root);
    expect(exported).toContain('control');
    expect(exported).toContain('painted-fill');
    expect(exported).not.toContain('unpainted-fill');

    // The exporter's restore pass sets `visible = true` unconditionally. That is
    // a no-op for a painted fill precisely because nothing here ever hid it.
    hideHelpers(root, true);
    expect(paintedMesh.visible).toBe(true);
    expect(painted.components.shape.fillGroup.visible).toBe(true);
  });
});
