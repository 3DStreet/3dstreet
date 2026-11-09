import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { elFactory } from './helpers.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  FILL_LIFT_M,
  fillPaintOrder
} from '../../src/aframe-components/shapeFillRender.js';
import { FILL_MATERIALS, fillUV } from '../../src/tested/shape-fill.js';
import { SURFACE_ASSET_IDS } from '../../src/tested/street-segment-utils.js';
import { normaliseShapeStyle } from '../../src/editor/lib/shapeStyle.js';
import { transformUVs } from '../../src/editor/components/modals/ScreenshotModal/gltfTransforms.js';

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
  // The fill layers sync synchronously from update(), so these are read
  // immediately and deliberately — no frame needed.
  it('holds transparent and depthWrite constant across the whole range', async () => {
    // Including at 100%. Two fills must never depth-compare against each other:
    // the depth buffer cannot resolve two coplanar caps, and it is what an
    // earlier design leaned on and had to abandon. A regression here would
    // reintroduce the z-fighting the paint-order rule replaced, and it would
    // show up only where two fills overlap at full opacity.
    const el = await makeShape('closed: true; fillOpacity: 0');
    const m = el.components.shape.fillLayerMaterials[0];
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
    expect(comp.fillLayerMaterials[0].color.getHexString()).toBe('ff0000');
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
    expect(low.components.shape.fillLayerMaterials[0].depthWrite).toBe(false);
    expect(high.components.shape.fillLayerMaterials[0].depthWrite).toBe(false);
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
    const m = el.components.shape.fillLayerMaterials[0];
    expect(m.opacity).toBe(1);
    // Fully opaque in colour, still a transparent-queue surface — see above.
    expect(m.transparent).toBe(true);
  });

  it('draws nothing at zero opacity without ever hiding the mesh', async () => {
    // `visible: false` would drop the cap from the editor's pick list and would
    // be flipped back to true by the exporter's unconditional restore.
    const el = await makeShape('closed: true; fillOpacity: 0');
    const comp = el.components.shape;
    expect(comp.fillLayerMaterials[0].colorWrite).toBe(false);
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

describe('shape fill - draw order across parents', () => {
  it('orders overlapping fills by their height in the world, and again when an ancestor moves', async () => {
    // A filled shape inside a plain entity raised 0.2 m, and one at the top
    // level raised 0.1 m, over each other with the same area. Their own local
    // heights are both 0; only the world heights tell them apart.
    const root = await elFactory();
    mounted.push(root.sceneEl);
    const holder = document.createElement('a-entity');
    holder.setAttribute('position', { x: 0, y: 0.2, z: 0 });
    root.sceneEl.appendChild(holder);
    const inside = document.createElement('a-entity');
    holder.appendChild(inside);
    const outside = document.createElement('a-entity');
    outside.setAttribute('position', { x: 0, y: 0.1, z: 0 });
    root.sceneEl.appendChild(outside);
    for (const el of [inside, outside]) {
      el.setAttribute('shape', 'closed: true; fillOpacity: 40');
      for (const [x, z] of [
        [0, 0],
        [10, 0],
        [10, 10]
      ]) {
        const v = document.createElement('a-entity');
        v.setAttribute('shape-vertex', '');
        v.setAttribute('position', { x, y: 0, z });
        el.appendChild(v);
      }
    }
    await nextFrame();
    await nextFrame();
    const order = (el) => fillMeshes(el)[0].renderOrder;
    expect(order(inside)).toBeGreaterThan(order(outside));

    // The holder moves and the system ticks in the same step: the fill order
    // has to be read off the matrix this step brought up to date.
    holder.object3D.position.y = 0;
    root.sceneEl.systems.shape.tick();
    expect(order(inside)).toBeLessThan(order(outside));
  });
});

// --- Fill appearance: two layers on one mesh --------------------------------

// A five-vertex convex ring, for cases that edit vertices and need some to stay
// where they are. Local positions, at the fixture height.
const RING5 = [
  [0, 0],
  [8, 0],
  [10, 6],
  [4, 10],
  [-2, 6]
];

async function addRing(el, attrs, points = RING5) {
  el.setAttribute('shape', attrs);
  for (const [x, z] of points) {
    const v = document.createElement('a-entity');
    v.setAttribute('shape-vertex', '');
    v.setAttribute('position', { x, y: FIXTURE_Y, z });
    el.appendChild(v);
  }
  await nextFrame();
  return el;
}

async function makeRing(attrs, opts) {
  const el = await elFactory(opts);
  mounted.push(el.sceneEl);
  return addRing(el, attrs);
}

const layerMats = (el) => el.components.shape.fillLayerMaterials;
const groupsOf = (el) =>
  fillMeshes(el)[0].geometry.groups.map((g) => g.materialIndex);

// The cap's UV at the cap vertex with local plan position (x, z), or null.
function capUV(el, x, z) {
  const g = fillMeshes(el)[0].geometry;
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - x) < 1e-5 && Math.abs(pos.getZ(i) - z) < 1e-5) {
      return [uv.getX(i), uv.getY(i)];
    }
  }
  return null;
}

// Fill UVs at Angle 30, offset along 0.37 and across -1.2, worked by hand from
// the frame (u = x cos θ - z sin θ - across, v = -x sin θ - z cos θ - along):
//   local (10, 10) → (4.860254, -14.030254)
//   local (4, 10)  → (-0.335898, -11.030254)
const ANGLED = 'fillAngle: 30; fillOffsetAlong: 0.37; fillOffsetAcross: -1.2';
const UV_10_10 = [4.860254, -14.030254];
const UV_4_10 = [-0.335898, -11.030254];

function expectUV(actual, literal) {
  expect(actual).not.toBe(null);
  expect(actual[0]).toBeCloseTo(literal[0], 4);
  expect(actual[1]).toBeCloseTo(literal[1], 4);
}

// Colours worked by hand in linear space (sRGB hex → linear, multiplied per
// channel, as the lazy-texture placeholder does).
//   tint #80c0ff                       → (0.215861, 0.527115, 1.0)
//   grass placeholder #929729 × tint   → (0.062047, 0.163126, 0.022174)
//   concrete placeholder #9a9994 × tint → (0.069754, 0.167911, 0.296138)
const TINT = '#80c0ff';
const TINT_LINEAR = [0.215861, 0.527115, 1.0];
const GRASS_X_TINT = [0.062047, 0.163126, 0.022174];
const CONCRETE_X_TINT = [0.069754, 0.167911, 0.296138];

function expectColor(color, rgb) {
  expect(color.r).toBeCloseTo(rgb[0], 5);
  expect(color.g).toBeCloseTo(rgb[1], 5);
  expect(color.b).toBeCloseTo(rgb[2], 5);
}

function grassImg(attrs = {}) {
  const img = document.createElement('img');
  img.id = 'grass-texture';
  for (const [k, v] of Object.entries({
    'data-src': 'https://example.invalid/grass.png',
    'data-placeholder': '#929729',
    ...attrs
  })) {
    if (v !== null) img.setAttribute(k, v);
  }
  return img;
}

function concreteImg() {
  const img = document.createElement('img');
  img.id = 'seamless-bright-road';
  img.setAttribute('data-src', 'https://example.invalid/concrete.png');
  img.setAttribute('data-placeholder', '#9a9994');
  return img;
}

// A small real texture, so a bound map has image data to upload and export.
function canvasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a7d2c';
  ctx.fillRect(0, 0, 4, 4);
  const texture = new window.THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Replace the scene's loadTexture with a recorder. The shape's per-scene
// surface cache still runs in front of it.
function stubLoadTexture(sceneEl, { applyRepeat = false } = {}) {
  const calls = [];
  sceneEl.systems.material.loadTexture = (src, data, cb) => {
    calls.push({ src, data, cb });
    if (applyRepeat) {
      const original = cb;
      calls[calls.length - 1].cb = (t) => {
        if (t) t.repeat.set(data.repeat.x, data.repeat.y);
        original(t);
      };
    }
  };
  return calls;
}

function overheadCamera() {
  const THREE = window.THREE;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(5, 40, 5);
  camera.lookAt(5, 0, 5);
  camera.updateMatrixWorld(true);
  return camera;
}

function decodeBuffer(uri) {
  const bin = atob(uri.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// One float accessor of a (non-binary) glTF, as an array of tuples.
function readAccessor(gltf, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const buffer = decodeBuffer(gltf.buffers[view.buffer].uri);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const stride = view.byteStride || n * 4;
  const dv = new DataView(
    buffer,
    (view.byteOffset || 0) + (acc.byteOffset || 0)
  );
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const t = [];
    for (let k = 0; k < n; k++) t.push(dv.getFloat32(i * stride + k * 4, true));
    out.push(t);
  }
  return out;
}

async function exportFills(...shapes) {
  const THREE = window.THREE;
  const root = new THREE.Group();
  const control = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial()
  );
  control.name = 'control';
  root.add(control);
  shapes.forEach((el, i) => {
    const mesh = fillMeshes(el)[0];
    if (mesh) mesh.name = `fill-${i}`;
    root.add(el.components.shape.fillGroup);
  });
  hideHelpers(root, false);
  const gltf = await exportGltf(root);
  hideHelpers(root, true);
  return gltf;
}

const fillNode = (gltf, i = 0) =>
  (gltf.nodes || []).find((n) => n.name === `fill-${i}`);

describe('shape fill layers - the build gate', () => {
  it('builds for a painted pattern over a 0% material and tears down when it goes', async () => {
    const el = await makeShape(
      'closed: true; selectInside: false; fillOpacity: 0; fillPattern: stripes'
    );
    expect(fillMeshes(el)).toHaveLength(1);
    expect(groupsOf(el)).toEqual([1]);

    el.setAttribute('shape', 'fillPattern', 'none');
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(0);

    el.setAttribute('shape', 'fillPattern', 'stripes');
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(1);
    el.setAttribute('shape', 'fillPatternOpacity', 0);
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(0);

    el.setAttribute('shape', 'fillPatternOpacity', 100);
    await nextFrame();
    expect(fillMeshes(el)).toHaveLength(1);
    expect(layerMats(el)[1].map).not.toBe(null);
    expect(groupsOf(el)).toContain(1);
  });
});

describe('shape fill layers - groups, maps and program switches', () => {
  it('draws one group per painted layer, over every triangle', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    expect(groupsOf(el)).toEqual([0]);

    el.setAttribute('shape', { fillOpacity: 0, fillPattern: 'stripes' });
    const g = fillMeshes(el)[0].geometry;
    expect(groupsOf(el)).toEqual([1]);
    expect(g.groups[0].start).toBe(0);
    expect(g.groups[0].count).toBe(g.index.count);

    el.setAttribute('shape', 'fillOpacity', 40);
    expect(groupsOf(el)).toEqual([0, 1]);

    el.setAttribute('shape', { fillOpacity: 0, fillPattern: 'none' });
    await nextFrame();
    expect(groupsOf(el)).toEqual([0]);
    expect(layerMats(el)[0].colorWrite).toBe(false);
    expect(el.components.shape.fillGroup.userData.source).toBe('INSPECTOR');
  });

  it('adds the pattern with its map in the same call', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    el.setAttribute('shape', 'fillPattern', 'stripes');
    expect(groupsOf(el)).toEqual([0, 1]);
    expect(layerMats(el)[1].map).not.toBe(null);

    const THREE = window.THREE;
    const tex = layerMats(el)[1].map;
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.premultiplyAlpha).toBe(false);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.flipY).toBe(false);
    expect(tex.repeat.x).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(tex.repeat.y).toBeCloseTo(1 / Math.SQRT2, 9);
  });

  it('switches the pattern program only when the map comes or goes', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    const m = layerMats(el)[1];
    let v = m.version;
    el.setAttribute('shape', 'fillPattern', 'stripes');
    expect(m.version).toBeGreaterThan(v);

    const stripesMap = m.map;
    el.setAttribute('shape', 'fillPattern', 'dots');
    await nextFrame();
    expect(m.map).not.toBe(null);
    expect(m.map).not.toBe(stripesMap);

    v = m.version;
    el.setAttribute('shape', 'fillPattern', 'none');
    expect(m.version).toBeGreaterThan(v);
    expect(m.map).toBe(null);
  });
});

describe('shape fill layers - export structure', () => {
  it('exports the painted layers as primitives of one node, in order', async () => {
    const patternOnly = await makeShape(
      `closed: true; fillOpacity: 0; fillPattern: stripes; ${ANGLED}`
    );
    const both = await addShapeToSceneOf(
      patternOnly,
      `closed: true; fillOpacity: 40; fillPattern: stripes; ${ANGLED}`
    );
    const neither = await addShapeToSceneOf(
      patternOnly,
      'closed: true; fillOpacity: 0'
    );
    const gltf = await exportFills(patternOnly, both, neither);
    expect(gltf.nodes.map((n) => n.name)).toContain('control');

    const one = gltf.meshes[fillNode(gltf, 0).mesh].primitives;
    expect(one).toHaveLength(1);
    const patMat = gltf.materials[one[0].material];
    expect(patMat.alphaMode).toBe('BLEND');
    const scale =
      patMat.pbrMetallicRoughness.baseColorTexture.extensions
        .KHR_texture_transform.scale;
    expect(scale[0]).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(scale[1]).toBeCloseTo(1 / Math.SQRT2, 6);

    // The UVs at a known vertex are metres in the angled, offset frame.
    const positions = readAccessor(gltf, one[0].attributes.POSITION);
    const uvs = readAccessor(gltf, one[0].attributes.TEXCOORD_0);
    const at = positions.findIndex(
      (p) => Math.abs(p[0] - 10) < 1e-5 && Math.abs(p[2] - 10) < 1e-5
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(uvs[at][0]).toBeCloseTo(UV_10_10[0], 4);
    expect(uvs[at][1]).toBeCloseTo(UV_10_10[1], 4);

    const two = gltf.meshes[fillNode(gltf, 1).mesh].primitives;
    expect(two).toHaveLength(2);
    const [mat0, mat1] = two.map((p) => gltf.materials[p.material]);
    expect(mat0.pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(mat1.pbrMetallicRoughness.baseColorTexture).toBeDefined();

    expect(fillNode(gltf, 2)).toBeUndefined();
    // Two shapes on one pattern tuple share one image.
    expect(gltf.images).toHaveLength(1);
  });
});

describe('shape fill layers - one shape paints as one unit', () => {
  it('draws each shape’s two layers next to each other, duplicates included', async () => {
    const attrs = 'closed: true; fillOpacity: 40; fillPattern: stripes';
    const a = await makeShape(attrs);
    const b = await addShapeToSceneOf(a, attrs);
    const sibling = document.createElement('a-entity');
    a.sceneEl.appendChild(sibling);
    const c = await addRing(sibling, attrs);
    await nextFrame();

    // Every mesh in each shape's fill slot is hooked, so a layer drawn by a
    // mesh of its own is counted too.
    const calls = [];
    const meshes = [a, b, c].flatMap((el) => fillMeshes(el));
    for (const mesh of meshes) {
      mesh.onBeforeRender = (r, s, cam, geo, mat, group) =>
        calls.push({ mesh, index: group ? group.materialIndex : -1 });
    }
    const { sceneEl } = a;
    sceneEl.renderer.render(sceneEl.object3D, overheadCamera());
    for (const mesh of meshes) delete mesh.onBeforeRender;

    expect(calls).toHaveLength(6);
    for (let i = 0; i < 6; i += 2) {
      expect(calls[i].mesh.el).toBe(calls[i + 1].mesh.el);
      expect(calls[i].mesh).toBe(calls[i + 1].mesh);
      expect([calls[i].index, calls[i + 1].index]).toEqual([0, 1]);
    }
  });
});

describe('shape fill layers - the UV frame on the cap', () => {
  it('keeps the layers in place through vertex edits, after a yaw and a move', async () => {
    const el = await makeRing(`closed: true; fillOpacity: 40; ${ANGLED}`);
    el.setAttribute('rotation', { x: 0, y: 40, z: 0 });
    el.setAttribute('position', { x: 3, y: 0, z: -2 });
    await nextFrame();
    const before = new Map(
      RING5.map(([x, z]) => [`${x},${z}`, capUV(el, x, z)])
    );
    expectUV(capUV(el, 4, 10), UV_4_10);

    const verts = () => Array.from(el.querySelectorAll('[shape-vertex]'));
    const checkUnchanged = () => {
      let compared = 0;
      for (const v of verts()) {
        const p = v.object3D.position;
        const key = `${p.x},${p.z}`;
        if (!before.has(key)) continue;
        const now = capUV(el, p.x, p.z);
        expect(now[0]).toBeCloseTo(before.get(key)[0], 5);
        expect(now[1]).toBeCloseTo(before.get(key)[1], 5);
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(3);
      expectUV(capUV(el, 4, 10), UV_4_10);
    };

    // Drag vertex 1.
    verts()[1].setAttribute('position', { x: 9, y: FIXTURE_Y, z: -1 });
    await nextFrame();
    checkUnchanged();
    // Insert between 0 and 1.
    const inserted = document.createElement('a-entity');
    inserted.setAttribute('shape-vertex', '');
    inserted.setAttribute('position', { x: 4, y: FIXTURE_Y, z: -1.5 });
    el.insertBefore(inserted, verts()[1]);
    await nextFrame();
    await nextFrame();
    checkUnchanged();
    // Delete vertex 0.
    verts()[0].remove();
    await nextFrame();
    await nextFrame();
    checkUnchanged();
    // Swap the positions end to end, as Reverse does.
    const ps = verts().map((v) => v.object3D.position.clone());
    verts().forEach((v, i) =>
      v.setAttribute('position', ps[ps.length - 1 - i])
    );
    await nextFrame();
    checkUnchanged();
  });

  it('rewrites the UVs in place on an Angle or Offset edit, with no rebuild', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    const mesh = fillMeshes(el)[0];
    const geometry = mesh.geometry;
    let events = 0;
    el.addEventListener('shape-geometry-changed', () => events++);
    // The rewrite is flagged for upload in the same call, or the GPU keeps the
    // old UVs until some unrelated rebuild.
    const uvVersion = geometry.attributes.uv.version;
    el.setAttribute('shape', {
      fillAngle: 30,
      fillOffsetAlong: 0.37,
      fillOffsetAcross: -1.2
    });
    expect(geometry.attributes.uv.version).toBeGreaterThan(uvVersion);
    await nextFrame();
    await nextFrame();
    expect(fillMeshes(el)[0]).toBe(mesh);
    expect(fillMeshes(el)[0].geometry).toBe(geometry);
    expect(events).toBe(0);
    expectUV(capUV(el, 10, 10), UV_10_10);

    // A rebuild for a different vertex keeps the literal.
    const v = el.querySelectorAll('[shape-vertex]');
    v[0].setAttribute('position', { x: 1, y: FIXTURE_Y, z: 0 });
    await nextFrame();
    expectUV(capUV(el, 10, 10), UV_10_10);
  });

  it('stores an Angle set on an open polyline and uses it once closed', async () => {
    const el = await makeShape('fillOpacity: 40; fillPattern: stripes');
    expect(() => el.setAttribute('shape', 'fillAngle', 30)).not.toThrow();
    el.setAttribute('shape', 'closed', true);
    await nextFrame();
    const expected = fillUV(10, 10, 30, 0, 0);
    expectUV(capUV(el, 10, 10), expected);
  });
});

describe('shape fill layers - surface textures', () => {
  beforeAll(() => {
    // The lazy-texture hook is what loadTexture goes through in the app; the
    // integration case below is only meaningful with it installed.
    expect(
      window.AFRAME.systems.material.prototype._lazyTexturesInstalled
    ).toBe(true);
  });

  async function solidShapeWith(assets) {
    const el = await elFactory({ assets });
    mounted.push(el.sceneEl);
    const calls = stubLoadTexture(el.sceneEl);
    await addShape(el, 'closed: true; fillOpacity: 40');
    return { el, calls };
  }

  async function boundGrass() {
    const { el, calls } = await solidShapeWith([grassImg(), concreteImg()]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    const tex = canvasTexture();
    calls[0].cb(tex);
    expect(layerMats(el)[0].map).toBe(tex);
    return { el, calls, tex };
  }

  it('asks for the texture at its tile size and shows placeholder × tint meanwhile', async () => {
    const { el, calls } = await solidShapeWith([grassImg(), concreteImg()]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    expect(calls).toHaveLength(1);
    expect(calls[0].src.id).toBe('grass-texture');
    expect(calls[0].data.repeat).toEqual({ x: 0.25, y: 1 / 6 });
    const m = layerMats(el)[0];
    expect(m.map).toBe(null);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'pending'
    );
    expectColor(m.color, GRASS_X_TINT);

    const gltf = await exportFills(el);
    const prim = gltf.meshes[fillNode(gltf).mesh].primitives[0];
    const pbr = gltf.materials[prim.material].pbrMetallicRoughness;
    expect(pbr.baseColorTexture).toBeUndefined();
    expect(pbr.baseColorFactor[0]).toBeCloseTo(GRASS_X_TINT[0], 5);
    expect(pbr.baseColorFactor[1]).toBeCloseTo(GRASS_X_TINT[1], 5);
    expect(pbr.baseColorFactor[2]).toBeCloseTo(GRASS_X_TINT[2], 5);
  });

  it('binds the texture and shows the tint as soon as it lands', async () => {
    const { el, calls } = await solidShapeWith([grassImg(), concreteImg()]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    const m = layerMats(el)[0];
    const v = m.version;
    const tex = canvasTexture();
    calls[0].cb(tex);
    expect(m.map).toBe(tex);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'loaded'
    );
    expectColor(m.color, TINT_LINEAR);
    expect(m.version - v).toBe(1);
  });

  it('drops the old texture at once when switching to one not yet loaded', async () => {
    const { el, calls } = await boundGrass();
    const m = layerMats(el)[0];
    const v = m.version;
    el.setAttribute('shape', 'fillMaterial', 'concrete');
    expect(m.map).toBe(null);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'pending'
    );
    expectColor(m.color, CONCRETE_X_TINT);
    expect(m.version - v).toBe(1);
    calls[1].cb(null);
    expect(m.map).toBe(null);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'failed'
    );
  });

  it('switches no program on edits that keep the texture', async () => {
    const { el, tex } = await boundGrass();
    const m = layerMats(el)[0];
    const v = m.version;
    for (const pct of [1, 50, 100, 30]) {
      el.setAttribute('shape', 'fillOpacity', pct);
    }
    el.setAttribute('shape', 'fillTint', '#ff0000');
    el.setAttribute('shape', 'fillPatternSpacing', 2);
    el.setAttribute('shape', 'fillOffsetAlong', 0.5);
    expect(m.version).toBe(v);
    expect(m.map).toBe(tex);
  });

  it('switches the program exactly once when the texture goes', async () => {
    const { el } = await boundGrass();
    const m = layerMats(el)[0];
    const v = m.version;
    el.setAttribute('shape', 'fillMaterial', 'solid');
    expect(m.map).toBe(null);
    expect(m.version - v).toBe(1);
  });

  it('keeps the placeholder when a load fails, and asks again only on a new choice', async () => {
    const { el, calls } = await solidShapeWith([grassImg()]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    calls[0].cb(null);
    const m = layerMats(el)[0];
    expect(m.map).toBe(null);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'failed'
    );
    expectColor(m.color, GRASS_X_TINT);
    el.setAttribute('shape', 'fillTint', '#ff0000');
    expect(calls).toHaveLength(1);
    // Concrete has no image here: failed at once, no request.
    el.setAttribute('shape', 'fillMaterial', 'concrete');
    expect(calls).toHaveLength(1);
    el.setAttribute('shape', 'fillMaterial', 'grass');
    expect(calls).toHaveLength(2);
    expect(calls[1].src.id).toBe('grass-texture');
  });

  it('shows the tint alone when there is no image', async () => {
    const { el, calls } = await solidShapeWith([]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    expect(calls).toHaveLength(0);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'failed'
    );
    expectColor(layerMats(el)[0].color, TINT_LINEAR);
  });

  it('shows the tint alone for an image with no address', async () => {
    const { el, calls } = await solidShapeWith([
      grassImg({ 'data-src': null, 'data-placeholder': null })
    ]);
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    expect(calls).toHaveLength(0);
    expectColor(layerMats(el)[0].color, TINT_LINEAR);
  });

  it('loads through the real material system, at the tile size, in sRGB', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    const img = grassImg({ 'data-src': canvas.toDataURL('image/png') });
    const el = await elFactory({ assets: [img] });
    mounted.push(el.sceneEl);
    await addShape(el, 'closed: true; fillOpacity: 40');
    el.setAttribute('shape', { fillMaterial: 'grass', fillTint: TINT });
    const m = layerMats(el)[0];
    for (let i = 0; i < 120 && !m.map; i++) await nextFrame();
    expect(m.map).not.toBe(null);
    expect(m.map.repeat.x).toBeCloseTo(0.25, 9);
    expect(m.map.repeat.y).toBeCloseTo(1 / 6, 9);
    expect(m.map.colorSpace).toBe(window.THREE.SRGBColorSpace);
    expect(el.components.shape.fillTextures.state.surface.status).toBe(
      'loaded'
    );
    expectColor(m.color, TINT_LINEAR);

    const gltf = await exportFills(el);
    const prim = gltf.meshes[fillNode(gltf).mesh].primitives[0];
    const scale =
      gltf.materials[prim.material].pbrMetallicRoughness.baseColorTexture
        .extensions.KHR_texture_transform.scale;
    expect(scale[0]).toBeCloseTo(0.25, 6);
    expect(scale[1]).toBeCloseTo(1 / 6, 6);
  });
});

describe('shape fill layers - texture tile sizes match segments', () => {
  it('lays each surface at the size a segment does', async () => {
    await import('../../src/aframe-components/street-segment.js');
    const proto =
      window.AFRAME.components['street-segment'].Component.prototype;
    const L = 60;
    const W = 3;
    for (const name of [
      'concrete',
      'cracked-asphalt',
      'grass',
      'sidewalk',
      'parking-lot'
    ]) {
      const m = FILL_MATERIALS[name];
      expect(m.textureId).toBe(SURFACE_ASSET_IDS[name]);
      const [rx, ry] = proto.calculateTextureRepeat(L, W, m.textureId);
      expect(W / rx).toBeCloseTo(m.tileAcross, 9);
      expect(L / ry).toBeCloseTo(m.tileAlong, 9);
    }
  });
});

describe('shape fill layers - saving and loading', () => {
  it('saves only what differs from the defaults and loads old shapes as before', async () => {
    await import('../../src/json-utils_1.1.js');
    const { getElementData } = window.STREET.utils;
    const shapeOf = (el) => {
      const c = getElementData(el).components.shape;
      return typeof c === 'string'
        ? window.AFRAME.utils.styleParser.parse(c)
        : c;
    };
    const plain = await makeShape('closed: true; fillAngle: 0');
    expect('fillAngle' in shapeOf(plain)).toBe(false);
    expect(plain.components.shape.data.fillAngle).toBe(0);

    const set = await addShapeToSceneOf(
      plain,
      'closed: true; fillAngle: 36.87; fillOffsetAlong: -1.2; ' +
        'fillPatternOpacity: 0; fillMaterial: grass; fillPattern: dots'
    );
    const saved = shapeOf(set);
    expect(Number(saved.fillAngle)).toBe(36.87);
    expect(Number(saved.fillOffsetAlong)).toBe(-1.2);
    expect(Number(saved.fillPatternOpacity)).toBe(0);
    expect(saved.fillMaterial).toBe('grass');
    expect(saved.fillPattern).toBe('dots');

    const legacy = await addShapeToSceneOf(
      plain,
      'closed: true; fillColor: #336699; fillOpacity: 60'
    );
    expect(groupsOf(legacy)).toEqual([0]);
    expect(layerMats(legacy)[0].map).toBe(null);
    expect(layerMats(legacy)[0].color.getHexString()).toBe('336699');
    expect(layerMats(legacy)[0].opacity).toBeCloseTo(0.6, 9);
  });
});

describe('shape fill layers - shadows, picking, setting the material directly', () => {
  it('receives shadows and does not cast them', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    expect(fillMeshes(el)[0].receiveShadow).toBe(true);
    expect(fillMeshes(el)[0].castShadow).toBe(false);
  });

  it('picks anywhere inside a pattern over a 0% material, only when clickable', async () => {
    const THREE = window.THREE;
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
    const on = await makeShape(
      'closed: true; selectInside: true; fillOpacity: 0; fillPattern: stripes'
    );
    const off = await addShapeToSceneOf(
      on,
      'closed: true; selectInside: false; fillOpacity: 0; fillPattern: stripes'
    );
    const g = fillMeshes(on)[0].geometry;
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].start).toBe(0);
    expect(g.groups[0].count).toBe(g.index.count);
    expect(castAt(fillMeshes(on)[0]).length).toBeGreaterThan(0);
    expect(castAt(fillMeshes(off)[0])).toHaveLength(0);
  });

  it('leaves the opacity alone when the material is set directly', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    el.setAttribute('shape', 'fillMaterial', 'grass');
    expect(el.components.shape.data.fillOpacity).toBe(40);
  });
});

describe('shape fill layers - the AR bake', () => {
  it('bakes each primitive’s own texture scale into its UVs', async () => {
    const el = await elFactory({ assets: [grassImg()] });
    mounted.push(el.sceneEl);
    const calls = stubLoadTexture(el.sceneEl, { applyRepeat: true });
    await addShape(
      el,
      `closed: true; fillMaterial: grass; fillOpacity: 100; fillPattern: stripes; ${ANGLED}`
    );
    calls[0].cb(canvasTexture());
    expect(groupsOf(el)).toEqual([0, 1]);

    const THREE = window.THREE;
    const root = new THREE.Group();
    root.add(el.components.shape.fillGroup);
    const glb = await new Promise((resolve, reject) =>
      new GLTFExporter().parse(root, resolve, reject, { binary: true })
    );
    const baked = await transformUVs(glb);
    const doc = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .readBinary(new Uint8Array(baked));
    const docRoot = doc.getRoot();
    expect(
      docRoot
        .listExtensionsUsed()
        .some((e) => e.extensionName === 'KHR_texture_transform')
    ).toBe(false);
    const prims = docRoot.listMeshes()[0].listPrimitives();
    expect(prims).toHaveLength(2);
    const scales = [
      [0.25, 1 / 6],
      [1 / Math.SQRT2, 1 / Math.SQRT2]
    ];
    prims.forEach((prim, k) => {
      const pos = prim.getAttribute('POSITION');
      const uv = prim.getAttribute('TEXCOORD_0');
      const p = [0, 0, 0];
      const t = [0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        uv.getElement(i, t);
        const [u, v] = fillUV(p[0], p[2], 30, 0.37, -1.2);
        expect(t[0]).toBeCloseTo(u * scales[k][0], 4);
        expect(t[1]).toBeCloseTo(v * scales[k][1], 4);
      }
    });
  });
});

describe('shape fill layers - shapes created with a texture already set', () => {
  const waitLoaded = (el) =>
    new Promise((resolve) => {
      if (el.hasLoaded) resolve();
      else el.addEventListener('loaded', resolve, { once: true });
    });

  // An entity built complete, attributes and vertex children, then attached -
  // the way a loaded scene, a draw-tool commit or a re-inserted clone arrives.
  async function attachShape(sceneEl, shape) {
    const el = document.createElement('a-entity');
    el.setAttribute('shape', shape);
    for (const [x, z] of [
      [0, 0],
      [10, 0],
      [10, 10]
    ]) {
      const v = document.createElement('a-entity');
      v.setAttribute('shape-vertex', '');
      v.setAttribute('position', `${x} ${FIXTURE_Y} ${z}`);
      el.appendChild(v);
    }
    sceneEl.appendChild(el);
    await waitLoaded(el);
    return el;
  }

  async function sceneWithStub() {
    const host = await elFactory({ assets: [grassImg()] });
    mounted.push(host.sceneEl);
    return { sceneEl: host.sceneEl, calls: stubLoadTexture(host.sceneEl) };
  }

  it('loads it for a shape from a saved scene', async () => {
    const { sceneEl, calls } = await sceneWithStub();
    const el = await attachShape(
      sceneEl,
      'closed: true; fillMaterial: grass; fillOpacity: 100'
    );
    expect(fillMeshes(el)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    const tex = canvasTexture();
    calls[0].cb(tex);
    expect(layerMats(el)[0].map).toBe(tex);
  });

  it('loads it for a shape drawn with a sticky textured style', async () => {
    const { sceneEl, calls } = await sceneWithStub();
    const el = await attachShape(sceneEl, {
      ...normaliseShapeStyle({ fillMaterial: 'grass', fillOpacity: 100 }),
      fillAngle: 12,
      closed: true
    });
    expect(fillMeshes(el)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    const tex = canvasTexture();
    calls[0].cb(tex);
    expect(layerMats(el)[0].map).toBe(tex);
  });

  async function cloneOf(el) {
    el.flushToDOM(true);
    const clone = el.cloneNode(true);
    el.parentNode.insertBefore(clone, el.nextSibling);
    await waitLoaded(clone);
    return clone;
  }

  it('binds a duplicate of a loaded shape at once, with no new request', async () => {
    const { sceneEl, calls } = await sceneWithStub();
    const el = await attachShape(
      sceneEl,
      `closed: true; fillMaterial: grass; fillOpacity: 100; fillTint: ${TINT}`
    );
    const tex = canvasTexture();
    calls[0].cb(tex);
    const clone = await cloneOf(el);
    expect(calls).toHaveLength(1);
    expect(layerMats(clone)[0].map).toBe(tex);
    expect(clone.components.shape.fillTextures.state.surface.status).toBe(
      'loaded'
    );
    expectColor(layerMats(clone)[0].color, TINT_LINEAR);
  });

  it('binds a duplicate of a still-loading shape when the one load lands', async () => {
    const { sceneEl, calls } = await sceneWithStub();
    const el = await attachShape(
      sceneEl,
      `closed: true; fillMaterial: grass; fillOpacity: 100; fillTint: ${TINT}`
    );
    const clone = await cloneOf(el);
    expect(calls).toHaveLength(1);
    const tex = canvasTexture();
    calls[0].cb(tex);
    for (const shape of [el, clone]) {
      expect(layerMats(shape)[0].map).toBe(tex);
      expect(shape.components.shape.fillTextures.state.surface.status).toBe(
        'loaded'
      );
      expectColor(layerMats(shape)[0].color, TINT_LINEAR);
    }
  });

  it('loads it for an open polyline the moment it is closed', async () => {
    const { sceneEl, calls } = await sceneWithStub();
    const el = await attachShape(
      sceneEl,
      'fillMaterial: grass; fillOpacity: 100'
    );
    expect(calls).toHaveLength(0);
    el.setAttribute('shape', 'closed', true);
    expect(calls).toHaveLength(1);
  });

  it('draws the pattern tile for a shape created with a pattern', async () => {
    const { sceneEl } = await sceneWithStub();
    const el = await attachShape(sceneEl, 'closed: true; fillPattern: stripes');
    expect(layerMats(el)[1].map).not.toBe(null);
    await nextFrame();
    expect(groupsOf(el)).toContain(1);
  });
});

describe('shape fill layers - spacing and width edits on a built shape', () => {
  it('swaps the tile a frame later, frees the old one, and frees all on removal', async () => {
    const el = await makeShape('closed: true; fillOpacity: 40');
    const { sceneEl } = el;
    const camera = overheadCamera();
    const textures = () => {
      sceneEl.renderer.render(sceneEl.object3D, camera);
      return sceneEl.renderer.info.memory.textures;
    };
    const B = textures();
    el.setAttribute('shape', 'fillPattern', 'stripes');
    expect(textures()).toBe(B + 1);

    const m = layerMats(el)[1];
    const oldMap = m.map;
    const oldRepeat = oldMap.repeat.x;
    el.setAttribute('shape', {
      fillPatternWidth: 0.3,
      fillPatternSpacing: 1.5
    });
    expect(m.map).toBe(oldMap);
    expect(m.map.repeat.x).toBe(oldRepeat);
    await nextFrame();
    await nextFrame();
    expect(m.map).not.toBe(oldMap);
    expect(m.map.repeat.x).toBeCloseTo(1 / (1.5 * Math.SQRT2), 9);
    // Row 0, a little way in: inside a stripe at ratio 0.2, a gap at 0.15.
    const { data, width } = m.map.image;
    expect(data[Math.floor(0.175 * width) * 4 + 3]).toBeGreaterThan(127);
    expect(textures()).toBe(B + 1);

    el.remove();
    await nextFrame();
    expect(() => textures()).not.toThrow();
    expect(textures()).toBe(B);
  });
});
