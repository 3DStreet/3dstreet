/* global AFRAME */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import { installEditorFrame } from '@/editor/lib/editorFrame.js';
import { SCOPE_MARKS } from '@/editor/lib/groups/scopePresentation.js';
import {
  withOriginalAppearance,
  withOriginalAppearanceSync
} from '@/editor/lib/groups/scopeAttenuation.js';
import {
  getPresentationFactor,
  subscribePresentationFactor
} from '@/tested/reference-layer-presentation.js';
import { captureViewportScreenshot } from '@/editor/lib/viewportScreenshot.js';
import { group, item, mountEditor, solid } from './_editorHarness.js';

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => false,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
      setCamera() {}
      focus() {}
      navigateDoubleClick() {}
      newSceneCameraZoom() {}
    }
  };
});

// The treatment of everything outside an open group, through the real
// viewport, scope controller, entry schedule and editor frame (see
// _editorHarness). A render is the harness's frame(): the scene's matrix
// update, its onBeforeRender, then (`between`) what the renderer would draw,
// then its onAfterRender.

let h;
let frameRequests;

beforeEach(() => {
  frameRequests = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frameRequests.push(callback);
    return frameRequests.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  h = mountEditor({ gizmo: true });
  h.camera.position.set(0, 20, 30);
  h.camera.lookAt(0, 0, 0);
  h.camera.updateMatrixWorld(true);
});

afterEach(() => {
  useStore.setState({ isInspectorEnabled: true });
  h.dispose();
  Events.removeAllListeners();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// ------------------------------------------------------------------ scene

function runFrameRequests() {
  const pending = frameRequests;
  frameRequests = [];
  pending.forEach((callback) => callback(performance.now()));
}

/** Open `g` and let its outside treatment start, as the editor schedules it. */
function enter(g) {
  h.scope.open(g);
  h.frame();
  runFrameRequests();
}

/** What each of `meshes` is drawn with in the next render. */
function drawnWith(...meshes) {
  let drawn;
  h.frame(() => {
    drawn = meshes.map((mesh) => mesh.material);
  });
  return drawn;
}

function meshOf(el) {
  return el.object3D.children.find((c) => c.isMesh);
}

// A group G with one member, next to an ordinary tree outside it.
function simpleScene() {
  const G = group(h.streetContainer, { id: 'G' });
  const member = solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
  const tree = solid(h.streetContainer, [5, 0, 0], [6, 2, 1], { id: 'tree' });
  return {
    G,
    member,
    tree,
    memberMesh: meshOf(member),
    treeMesh: meshOf(tree)
  };
}

function rootEntity(id) {
  return item(h.sceneEl, { id });
}

// A stand-in for a Gaussian splat entity: the splat component's SplatMesh,
// which Spark fades through its `opacity`.
function splatEntity(parent, id) {
  const el = item(parent, { id });
  const splatMesh = new THREE.Object3D();
  splatMesh.opacity = 1;
  splatMesh.el = el;
  el.object3D.add(splatMesh);
  el.components.splat = { splatMesh };
  return { el, splatMesh };
}

// A real BatchedMesh with one instance per entity in `els`, as batch-models
// builds them (instance id -> entity through `_batchIdToEl`).
function batchOf(els) {
  const source = new THREE.BatchedMesh(
    els.length,
    64,
    128,
    new THREE.MeshStandardMaterial()
  );
  source._batchIdToEl = [];
  const geometryId = source.addGeometry(new THREE.BoxGeometry());
  els.forEach((el) => {
    const id = source.addInstance(geometryId);
    source._batchIdToEl[id] = el;
  });
  return source;
}

// ------------------------------------------------------------ materials

describe('outside meshes', () => {
  it('are drawn with a faded copy of their material, never by changing it: opacity, transparency and cutouts', () => {
    const { G, member, tree, memberMesh, treeMesh } = simpleScene();
    const glass = solid(h.streetContainer, [8, 0, 0], [9, 1, 1]);
    const foliage = solid(h.streetContainer, [10, 0, 0], [11, 1, 1]);
    const glassMesh = meshOf(glass);
    const foliageMesh = meshOf(foliage);
    glassMesh.material = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.5
    });
    foliageMesh.material = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
    // A material shared with a member stays full strength on the member.
    const shared = new THREE.MeshStandardMaterial();
    memberMesh.material = shared;
    treeMesh.material = shared;
    const originals = [shared, glassMesh.material, foliageMesh.material];
    h.inspector.selectEntity(member);
    expect(h.openIds()).toEqual(['G']);
    enter(G);

    const [onMember, onTree, onGlass, onFoliage] = drawnWith(
      memberMesh,
      treeMesh,
      glassMesh,
      foliageMesh
    );
    expect(onMember).toBe(shared);
    expect(onTree).not.toBe(shared);
    expect(onTree.opacity).toBeCloseTo(0.2, 9);
    expect(onTree.transparent).toBe(true);
    expect(onTree.depthWrite).toBe(false);
    expect(onGlass.opacity).toBeCloseTo(0.1, 9);
    expect(onFoliage.alphaTest).toBeCloseTo(0.1, 9);
    expect(onFoliage.transparent).toBe(true);
    // The originals are untouched.
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
    expect(originals[1].opacity).toBe(0.5);
    expect(originals[2].alphaTest).toBe(0.5);
    expect(originals[2].transparent).toBe(false);
    expect(tree.object3D.visible).toBe(true);
  });

  it('fades each material of a mesh that has several, and gives the same array back after the render', () => {
    const { G, member, treeMesh } = simpleScene();
    const pair = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 })
    ];
    treeMesh.material = pair;
    // The box's six faces alternate between the two.
    treeMesh.geometry.groups.forEach((g, i) => (g.materialIndex = i % 2));
    h.inspector.selectEntity(member);
    enter(G);

    const [drawn] = drawnWith(treeMesh);
    expect(Array.isArray(drawn)).toBe(true);
    expect(drawn).not.toBe(pair);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).not.toBe(pair[0]);
    expect(drawn[0].opacity).toBeCloseTo(0.2, 9);
    expect(drawn[1].opacity).toBeCloseTo(0.1, 9);
    expect(treeMesh.material).toBe(pair);
    expect(pair[1].opacity).toBe(0.5);
  });

  it('hold their original material outside the render, pick up a replaced material or a loaded texture next frame, and keep their copies after exit', () => {
    const { G, member, treeMesh } = simpleScene();
    const original = treeMesh.material;
    h.inspector.selectEntity(member);
    enter(G);
    const [firstCopy] = drawnWith(treeMesh);
    expect(firstCopy).not.toBe(original);
    // Between renders every reader sees the original.
    expect(treeMesh.material).toBe(original);

    // Changed while isolated: the original keeps the change.
    original.color.set(0xff0000);
    expect(drawnWith(treeMesh)[0].color.getHex()).toBe(0xff0000);
    expect(original.color.getHex()).toBe(0xff0000);
    expect(original.opacity).toBe(1);

    // A texture arriving after the copy was made reaches it.
    const map = new THREE.Texture();
    original.map = map;
    expect(drawnWith(treeMesh)[0].map).toBe(map);

    // A material replaced between frames: its own copy is drawn.
    const replacement = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    treeMesh.material = replacement;
    const [replacementCopy] = drawnWith(treeMesh);
    expect(replacementCopy).not.toBe(firstCopy);
    expect(replacementCopy.color.getHex()).toBe(0x00ff00);
    expect(replacementCopy.opacity).toBeCloseTo(0.2, 9);
    expect(treeMesh.material).toBe(replacement);

    // Exit, then enter again: the same copy, nothing cloned again.
    const clone = vi.spyOn(THREE.Material.prototype, 'clone');
    h.scope.close(null);
    expect(drawnWith(treeMesh)[0]).toBe(replacement);
    h.inspector.selectEntity(member);
    enter(G);
    expect(drawnWith(treeMesh)[0]).toBe(replacementCopy);
    expect(clone).not.toHaveBeenCalled();
  });

  it('let go of the faded copies and batch views of content removed from the scene when the group closes, and keep the rest for next time (fails if they are kept until the scene is replaced)', () => {
    const { G, member, treeMesh } = simpleScene();
    const bench = solid(h.streetContainer, [8, 0, 0], [9, 1, 1], {
      id: 'bench'
    });
    const benchMesh = meshOf(bench);
    const batchRoot = item(h.streetContainer, { id: 'batch-models-root' });
    const source = batchOf([item(h.streetContainer, { id: 'car' })]);
    batchRoot.object3D.add(source);
    h.inspector.selectEntity(member);
    enter(G);
    let view;
    h.frame(() => {
      view = source.children[0];
    });
    const [treeCopy, benchCopy] = drawnWith(treeMesh, benchMesh);
    const released = [];
    treeCopy.addEventListener('dispose', () => released.push('tree copy'));
    benchCopy.addEventListener('dispose', () => released.push('bench copy'));
    view._indirectTexture.addEventListener('dispose', () =>
      released.push('batch view')
    );

    // Removing a model takes its mesh away and disposes nothing.
    treeMesh.removeFromParent();
    source.removeFromParent();
    h.frame();
    expect(released).toEqual([]);
    h.scope.close(null);
    expect(released.sort()).toEqual(['batch view', 'tree copy']);

    const clone = vi.spyOn(THREE.Material.prototype, 'clone');
    h.inspector.selectEntity(member);
    enter(G);
    expect(drawnWith(benchMesh)[0]).toBe(benchCopy);
    expect(clone).not.toHaveBeenCalled();
  });

  it('leave editor helpers, the splat renderer and map layers alone, and never touch lights', () => {
    const { G, member, treeMesh } = simpleScene();
    const helperMesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    h.inspector.sceneHelpers.add(helperMesh);
    // Spark's renderer is one mesh at the scene root, with no entity.
    const sparkRenderer = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial()
    );
    h.sceneEl.object3D.add(sparkRenderer);
    const references = rootEntity('reference-layers');
    const basemap = solid(references, [0, 0, 0], [100, 0.1, 100]);
    basemap.setAttribute('tiled-basemap', '');
    const tileMesh = meshOf(basemap);
    const tileMaterial = tileMesh.material;
    const environment = rootEntity('environment');
    const light = new THREE.DirectionalLight(0xffffff, 2);
    environment.object3D.add(light);

    h.inspector.selectEntity(member);
    enter(G);
    const [onHelper, onSpark, onTile, onTree] = drawnWith(
      helperMesh,
      sparkRenderer,
      tileMesh,
      treeMesh
    );
    expect(onTree.opacity).toBeCloseTo(0.2, 9);
    expect(onHelper).toBe(helperMesh.material);
    expect(onHelper.opacity).toBe(1);
    expect(onSpark).toBe(sparkRenderer.material);
    // A map layer fades only through the presentation factor its component
    // applies, never per mesh (which would fade it twice).
    expect(onTile).toBe(tileMaterial);
    expect(tileMaterial.opacity).toBe(1);
    expect(getPresentationFactor()).toBeCloseTo(0.2, 9);
    expect(light.intensity).toBe(2);
    expect(light.visible).toBe(true);

    h.scope.close(null);
    expect(getPresentationFactor()).toBe(1);
  });

  it('never write visibility: hidden outside content is still hidden after exit', () => {
    const { G, member } = simpleScene();
    const hidden = solid(h.streetContainer, [3, 0, 0], [4, 1, 1]);
    hidden.object3D.visible = false;
    const hiddenMesh = meshOf(hidden);
    const writes = [];
    const watch = (object, key, label) => {
      let value = object[key];
      Object.defineProperty(object, key, {
        configurable: true,
        get: () => value,
        set: (v) => {
          writes.push(label);
          value = v;
        }
      });
    };
    watch(hidden.object3D, 'visible', 'entity visible');
    watch(hiddenMesh, 'visible', 'mesh visible');
    watch(hiddenMesh.material, 'visible', 'material visible');

    h.inspector.selectEntity(member);
    enter(G);
    const [drawn] = drawnWith(hiddenMesh);
    expect(drawn.opacity).toBeCloseTo(0.2, 9);
    expect(drawn.visible).toBe(true);
    h.scope.close(null);
    h.frame();

    expect(hidden.object3D.visible).toBe(false);
    expect(writes).toEqual([]);
  });

  it('fade outside splats through their own opacity, and restore it on exit', () => {
    const { G, member } = simpleScene();
    const outside = splatEntity(h.streetContainer, 'splat-out');
    const inside = splatEntity(G, 'splat-in');
    h.inspector.selectEntity(member);
    enter(G);
    expect(outside.splatMesh.opacity).toBeCloseTo(0.2, 9);
    expect(inside.splatMesh.opacity).toBe(1);
    h.scope.close(null);
    expect(outside.splatMesh.opacity).toBe(1);
  });

  it('treat content that arrives while the group is open before it is first drawn', () => {
    const { G, member } = simpleScene();
    h.inspector.selectEntity(member);
    enter(G);
    // Entities announce new geometry with bubbling events.
    const late = solid(h.streetContainer, [12, 0, 0], [13, 1, 1]);
    late.dispatchEvent(
      new CustomEvent('object3dset', { bubbles: true, detail: {} })
    );
    const lateInside = solid(G, [2, 0, 0], [3, 1, 1]);
    lateInside.dispatchEvent(
      new CustomEvent('model-loaded', { bubbles: true, detail: {} })
    );
    const [onLate, onLateInside] = drawnWith(meshOf(late), meshOf(lateInside));
    expect(onLate.opacity).toBeCloseTo(0.2, 9);
    expect(onLateInside).toBe(meshOf(lateInside).material);
  });
});

// ---------------------------------------------------------------- batches

describe('batches', () => {
  it('split per instance for the main render only: the batch keeps its own material and its inside instances', () => {
    const { G, member } = simpleScene();
    const outsideEl = item(h.streetContainer, { id: 'car-out' });
    const insideEl = item(G, { id: 'car-in' });
    const root = item(h.streetContainer, { id: 'batch-models-root' });
    const source = batchOf([outsideEl, insideEl]);
    root.object3D.add(source);
    const material = source.material;
    h.inspector.selectEntity(member);
    enter(G);

    let during;
    h.frame(() => {
      const view = source.children[0];
      during = {
        material: source.material,
        sorting: source.customSort,
        view,
        viewMaterial: view?.material,
        viewGeometry: view?.geometry
      };
    });
    expect(during.material).toBe(material);
    expect(during.sorting).toBeTypeOf('function');
    expect(during.view.isBatchedMesh).toBe(true);
    expect(during.viewMaterial.opacity).toBeCloseTo(0.2, 9);
    expect(during.viewGeometry).toBe(source.geometry);
    expect(source.customSort).toBe(null);
    expect(source.children).toEqual([]);
  });
});

// ------------------------------------------------------- captures, exports

describe('captures and exports', () => {
  let recorded;
  let canvas;

  function fixture() {
    const scene = simpleScene();
    const references = rootEntity('reference-layers');
    solid(references, [0, 0, 0], [50, 0.1, 50]).setAttribute(
      'google-maps-aerial',
      ''
    );
    const splat = splatEntity(h.streetContainer, 'splat');
    const outsideEl = item(h.streetContainer, { id: 'car-out' });
    const insideEl = item(scene.G, { id: 'car-in' });
    const source = batchOf([outsideEl, insideEl]);
    item(h.streetContainer, { id: 'batch-models-root' }).object3D.add(source);
    return { ...scene, splat, source };
  }

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn()
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,AAAA'
    );
  });

  // The page's renderer: a render calls the scene's hooks with the camera,
  // as three does, and records what it would draw.
  function installRenderer({ treeMesh, splat, source }) {
    recorded = [];
    const scene = h.sceneEl.object3D;
    const renderer = {
      domElement: canvas,
      render(renderedScene, camera) {
        renderedScene.updateMatrixWorld();
        renderedScene.onBeforeRender(this, renderedScene, camera, null);
        recorded.push({
          tree: treeMesh.material,
          sorting: source.customSort,
          views: source.children.length,
          factor: getPresentationFactor(),
          splat: splat.splatMesh.opacity
        });
        renderedScene.onAfterRender(this, renderedScene, camera);
      }
    };
    AFRAME.scenes[0].renderer = renderer;
    AFRAME.scenes[0].object3D = scene;
    AFRAME.scenes[0].camera = h.camera;
    return renderer;
  }

  it('render the original appearance inside the wrapper, and the treatment outside it (control)', () => {
    const f = fixture();
    h.inspector.selectEntity(f.member);
    enter(f.G);
    const marked = performance.getEntriesByName(SCOPE_MARKS.attenuationEnabled);
    expect(marked.length).toBeGreaterThan(0);
    const renderer = installRenderer(f);
    const original = f.treeMesh.material;

    renderer.render(h.sceneEl.object3D, h.camera);
    const control = recorded.pop();
    expect(control.tree).not.toBe(original);
    expect(control.tree.opacity).toBeCloseTo(0.2, 9);
    expect(control.sorting).toBeTypeOf('function');
    expect(control.views).toBe(1);
    expect(control.factor).toBeCloseTo(0.2, 9);
    expect(control.splat).toBeCloseTo(0.2, 9);

    const value = withOriginalAppearanceSync(() => {
      renderer.render(h.sceneEl.object3D, h.camera);
      return 'read back';
    });
    expect(value).toBe('read back');
    expect(recorded.pop()).toEqual({
      tree: original,
      sorting: null,
      views: 0,
      factor: 1,
      splat: 1
    });
    // Faded again afterwards.
    expect(getPresentationFactor()).toBeCloseTo(0.2, 9);
    expect(f.splat.splatMesh.opacity).toBeCloseTo(0.2, 9);
  });

  it('keep the viewport screenshot synchronous and in the original appearance', () => {
    const f = fixture();
    h.inspector.selectEntity(f.member);
    enter(f.G);
    installRenderer(f);
    const shot = captureViewportScreenshot();
    expect(shot).toEqual({ mimeType: 'image/jpeg', data: 'AAAA' });
    expect(typeof shot.then).toBe('undefined');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].tree).toBe(f.treeMesh.material);
    expect(recorded[0].factor).toBe(1);
    expect(recorded[0].splat).toBe(1);
    expect(recorded[0].sorting).toBe(null);
  });

  it('stay in the original appearance until the last of two overlapping exports finishes', async () => {
    const f = fixture();
    h.inspector.selectEntity(f.member);
    enter(f.G);
    let finishFirst;
    let finishSecond;
    const first = withOriginalAppearance(
      () => new Promise((resolve) => (finishFirst = resolve))
    );
    const second = withOriginalAppearance(
      () => new Promise((resolve) => (finishSecond = resolve))
    );
    expect(getPresentationFactor()).toBe(1);
    finishFirst('a');
    await expect(first).resolves.toBe('a');
    expect(getPresentationFactor()).toBe(1);
    expect(f.splat.splatMesh.opacity).toBe(1);
    expect(drawnWith(f.treeMesh)[0]).toBe(f.treeMesh.material);
    finishSecond('b');
    await expect(second).resolves.toBe('b');
    expect(getPresentationFactor()).toBeCloseTo(0.2, 9);
    expect(f.splat.splatMesh.opacity).toBeCloseTo(0.2, 9);
  });

  it('apply nothing after an export if the group was closed while it ran', async () => {
    const f = fixture();
    h.inspector.selectEntity(f.member);
    enter(f.G);
    let finish;
    const exporting = withOriginalAppearance(
      () => new Promise((resolve) => (finish = resolve))
    );
    h.scope.close(null);
    finish();
    await exporting;
    expect(getPresentationFactor()).toBe(1);
    expect(f.splat.splatMesh.opacity).toBe(1);
    expect(drawnWith(f.treeMesh)[0]).toBe(f.treeMesh.material);
  });
});

// ------------------------------------------------------ entry and exit

describe('entering and leaving', () => {
  it('marks the first faded frame after enabling it, and treats only the outside of the group opened last', () => {
    const marks = vi.spyOn(performance, 'mark');
    const A = group(h.streetContainer, { id: 'A' });
    const a1 = solid(A, [0, 0, 0], [1, 1, 1]);
    const B = group(A, { id: 'B' });
    const b1 = solid(B, [2, 0, 0], [3, 1, 1]);
    const tree = solid(h.streetContainer, [8, 0, 0], [9, 1, 1]);
    h.inspector.selectEntity(a1);
    h.scope.open(A);
    h.frame();
    // B opened before A's treatment was due.
    h.scope.open(B);
    h.frame();
    runFrameRequests();
    const [onA1, onB1, onTree] = drawnWith(
      meshOf(a1),
      meshOf(b1),
      meshOf(tree)
    );
    expect(onB1).toBe(meshOf(b1).material);
    expect(onA1.opacity).toBeCloseTo(0.2, 9);
    expect(onTree.opacity).toBeCloseTo(0.2, 9);

    const generation = h.scope.generation;
    const scopeMarks = marks.mock.calls
      .filter(([name]) => name.startsWith('group-scope:'))
      .map(([name, options]) => [name, options.detail.generation]);
    expect(scopeMarks.slice(-3)).toEqual([
      [SCOPE_MARKS.outlinedFrame, generation],
      [SCOPE_MARKS.attenuationEnabled, generation],
      [SCOPE_MARKS.firstAttenuatedFrame, generation]
    ]);
    expect(
      scopeMarks.filter(([name]) => name === SCOPE_MARKS.firstAttenuatedFrame)
    ).toHaveLength(1);
  });

  it.each([
    ['deleting the group', (G) => h.inspector.execute('entityremove', G)],
    ['a new scene', () => h.sceneEl.dispatchEvent(new CustomEvent('newScene'))],
    [
      'leaving the editor',
      () => useStore.getState().setIsInspectorEnabled(false)
    ]
  ])('restores everything when the open groups empty: %s', (_, close) => {
    const { G, member, treeMesh } = simpleScene();
    const splat = splatEntity(h.streetContainer, 'splat');
    h.inspector.selectEntity(member);
    enter(G);
    expect(drawnWith(treeMesh)[0]).not.toBe(treeMesh.material);
    close(G);
    expect(h.openIds()).toEqual([]);
    expect(getPresentationFactor()).toBe(1);
    expect(splat.splatMesh.opacity).toBe(1);
    // Rendered by the editor again: nothing is swapped.
    h.inspector.opened = true;
    expect(drawnWith(treeMesh)[0]).toBe(treeMesh.material);
  });

  it('leaves the treatment alone when members change places inside the open group', () => {
    const { G, member } = simpleScene();
    solid(G, [2, 0, 0], [3, 1, 1]);
    h.inspector.selectEntity(member);
    enter(G);
    const restore = vi.spyOn(h.scope.attenuation, 'restore');
    // What reordering a member reports: its element leaves and rejoins its
    // group, and history changes.
    h.sceneEl.dispatchEvent(
      new CustomEvent('child-detached', { detail: { el: member } })
    );
    G.dispatchEvent(
      new CustomEvent('child-attached', {
        bubbles: true,
        detail: { el: member }
      })
    );
    Events.emit('historychanged');
    h.frame();
    expect(h.openIds()).toEqual(['G']);
    expect(restore).not.toHaveBeenCalled();
  });

  it('removes the treatment before any further render when the editor is left', () => {
    const { G, member, treeMesh } = simpleScene();
    const splat = splatEntity(h.streetContainer, 'splat');
    h.inspector.selectEntity(member);
    enter(G);
    useStore.getState().setIsInspectorEnabled(false);
    expect(getPresentationFactor()).toBe(1);
    expect(splat.splatMesh.opacity).toBe(1);
    // The viewer's own render: no editor window runs, nothing is swapped.
    const scene = h.sceneEl.object3D;
    scene.onBeforeRender({}, scene, h.camera, null);
    const drawn = treeMesh.material;
    scene.onAfterRender({}, scene, h.camera);
    expect(drawn).toBe(treeMesh.material);
    expect(treeMesh.material.opacity).toBe(1);
  });

  it('costs nothing per frame while no group is open, before a group is opened and after it closes (fails if the render window stays registered)', () => {
    const { G, member, treeMesh } = simpleScene();
    const fadeWindow = vi.spyOn(h.scope.attenuation, 'fadeWindow');
    const endWindow = vi.spyOn(h.scope.attenuation, 'endWindow');
    h.inspector.selectEntity(member);
    enter(G);
    h.frame();
    expect(fadeWindow).toHaveBeenCalled();
    h.scope.close(null);
    fadeWindow.mockClear();
    endWindow.mockClear();
    const frame = installEditorFrame(h.sceneEl);
    const callbacks = () => frame.before.length + frame.after.length;
    const baseline = callbacks();
    const clone = vi.spyOn(THREE.Material.prototype, 'clone');
    const material = treeMesh.material;
    const writes = [];
    Object.defineProperty(treeMesh, 'material', {
      configurable: true,
      get: () => material,
      set: (value) => writes.push(value)
    });
    for (let i = 0; i < 5; i++) h.frame();
    expect(writes).toEqual([]);
    expect(clone).not.toHaveBeenCalled();
    expect(callbacks()).toBe(baseline);
    expect(fadeWindow).not.toHaveBeenCalled();
    expect(endWindow).not.toHaveBeenCalled();
    expect(getPresentationFactor()).toBe(1);
  });
});

// --------------------------------------------------------------- failures

describe('failures', () => {
  function threeOutside() {
    const G = group(h.streetContainer, { id: 'G' });
    const member = solid(G, [0, 0, 0], [1, 1, 1]);
    const meshes = [5, 7, 9].map((x) =>
      meshOf(solid(h.streetContainer, [x, 0, 0], [x + 1, 1, 1]))
    );
    return { G, member, meshes };
  }

  // Records every material assigned to `mesh`. While `reads.armed`, the
  // `reads.throwAt`-th material read across all instrumented meshes throws.
  const reads = { armed: false, count: 0, throwAt: 3 };
  function instrument(mesh) {
    let material = mesh.material;
    const probe = { assigned: [], original: material };
    Object.defineProperty(mesh, 'material', {
      configurable: true,
      get() {
        if (reads.armed && ++reads.count === reads.throwAt) {
          throw new Error('material unavailable');
        }
        return material;
      },
      set(value) {
        probe.assigned.push(value);
        material = value;
      }
    });
    return probe;
  }

  it('puts every original back before the render when the swap throws, and stops fading for the session', () => {
    const { G, member, meshes } = threeOutside();
    const splat = splatEntity(h.streetContainer, 'splat');
    h.inspector.selectEntity(member);
    enter(G);
    const probes = meshes.map(instrument);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The third mesh reached fails, after two have been swapped.
    reads.armed = true;
    reads.count = 0;
    let during;
    h.frame(() => {
      reads.armed = false;
      during = meshes.map((mesh) => mesh.material);
    });
    expect(reads.count).toBe(3);
    expect(probes.filter((probe) => probe.assigned.length)).toHaveLength(2);
    expect(during).toEqual(probes.map((probe) => probe.original));
    expect(error).toHaveBeenCalledTimes(1);
    // Nothing is faded any more: not the map layers, not splats.
    expect(getPresentationFactor()).toBe(1);
    expect(splat.splatMesh.opacity).toBe(1);

    probes.forEach((probe) => (probe.assigned = []));
    const next = drawnWith(...meshes);
    expect(next).toEqual(probes.map((probe) => probe.original));
    expect(probes.every((probe) => probe.assigned.length === 0)).toBe(true);
    // Isolation itself goes on, and reopening does not fade again.
    expect(h.openIds()).toEqual(['G']);
    h.scope.close(null);
    h.inspector.selectEntity(member);
    enter(G);
    expect(drawnWith(...meshes)).toEqual(probes.map((probe) => probe.original));
    expect(getPresentationFactor()).toBe(1);
  });

  it('undoes the swaps of a render that never finished before swapping again', () => {
    const { G, member, meshes } = threeOutside();
    const originals = meshes.map((mesh) => mesh.material);
    h.inspector.selectEntity(member);
    enter(G);
    drawnWith(...meshes);
    const clone = vi.spyOn(THREE.Material.prototype, 'clone');

    // A render that stopped between the two hooks.
    const scene = h.sceneEl.object3D;
    h.sceneEl.time += 16;
    scene.updateMatrixWorld();
    scene.onBeforeRender({}, scene, h.camera, null);
    const copies = meshes.map((mesh) => mesh.material);

    const next = drawnWith(...meshes);
    expect(next).toEqual(copies);
    expect(clone).not.toHaveBeenCalled();
    expect(meshes.map((mesh) => mesh.material)).toEqual(originals);
  });
});

// ------------------------------------------------------------------ leaks

describe('switching between groups', () => {
  it('keeps the outside faded in every render across a switch, redoing no map-layer or splat fading for what stays outside (a switch that restores first draws it at full strength)', () => {
    const A = group(h.streetContainer, { id: 'A' });
    const a1 = solid(A, [0, 0, 0], [1, 1, 1]);
    const B = group(A, { id: 'B' });
    const b1 = solid(B, [2, 0, 0], [3, 1, 1]);
    const tree = solid(h.streetContainer, [8, 0, 0], [9, 1, 1]);
    const outsideBoth = splatEntity(h.streetContainer, 'splat-out').splatMesh;
    const inA = splatEntity(A, 'splat-a').splatMesh;
    const meshes = [meshOf(tree), meshOf(a1), meshOf(b1)];
    const originals = meshes.map((mesh) => mesh.material);
    const faded = (drawn, k) =>
      drawn[k] !== originals[k] && Math.abs(drawn[k].opacity - 0.2) < 1e-9;
    h.inspector.selectEntity(a1);
    enter(A);

    const factors = [];
    const unsubscribe = subscribePresentationFactor((f) => factors.push(f));
    const writes = [];
    let opacity = outsideBoth.opacity;
    Object.defineProperty(outsideBoth, 'opacity', {
      configurable: true,
      get: () => opacity,
      set: (value) => {
        opacity = value;
        writes.push(value);
      }
    });

    // Into B: a1 is now outside too; the tree never stops being faded.
    h.scope.open(B);
    for (let i = 0; i < 3; i++) {
      const drawn = drawnWith(...meshes);
      expect([faded(drawn, 0), faded(drawn, 1), drawn[2]]).toEqual([
        true,
        true,
        originals[2]
      ]);
      runFrameRequests();
    }
    expect(inA.opacity).toBeCloseTo(0.2, 9);

    // Back out to A: a1 and its splat are inside again, at once.
    h.escape();
    expect(h.openIds()).toEqual(['A']);
    for (let i = 0; i < 3; i++) {
      const drawn = drawnWith(...meshes);
      expect([faded(drawn, 0), drawn[1], drawn[2]]).toEqual([
        true,
        originals[1],
        originals[2]
      ]);
      runFrameRequests();
    }
    expect(inA.opacity).toBe(1);
    expect(outsideBoth.opacity).toBeCloseTo(0.2, 9);
    expect(writes).toEqual([]);
    expect(factors).toEqual([]);
    unsubscribe();

    // Leaving the last group still puts everything back.
    h.escape();
    expect(h.openIds()).toEqual([]);
    expect(outsideBoth.opacity).toBe(1);
    expect(getPresentationFactor()).toBe(1);
    expect(drawnWith(...meshes)).toEqual(originals);
  });

  it('copies each outside material once, and leaves no callbacks or listeners behind', () => {
    const A = group(h.streetContainer, { id: 'A' });
    const a1 = solid(A, [0, 0, 0], [1, 1, 1]);
    const B = group(h.streetContainer, { id: 'B' });
    const b1 = solid(B, [4, 0, 0], [5, 1, 1]);
    solid(h.streetContainer, [8, 0, 0], [9, 1, 1]);
    const frame = installEditorFrame(h.sceneEl);
    const callbacks = () => frame.before.length + frame.after.length;
    const listeners = {};
    const add = h.sceneEl.addEventListener.bind(h.sceneEl);
    const remove = h.sceneEl.removeEventListener.bind(h.sceneEl);
    vi.spyOn(h.sceneEl, 'addEventListener').mockImplementation(
      (type, ...rest) => {
        listeners[type] = (listeners[type] || 0) + 1;
        return add(type, ...rest);
      }
    );
    vi.spyOn(h.sceneEl, 'removeEventListener').mockImplementation(
      (type, ...rest) => {
        listeners[type] = (listeners[type] || 0) - 1;
        return remove(type, ...rest);
      }
    );
    const watched = [
      'object3dset',
      'child-attached',
      'model-loaded',
      'object3dremove',
      'child-detached'
    ];
    const counts = () => [
      callbacks(),
      ...watched.map((t) => listeners[t] || 0)
    ];
    const clone = vi.spyOn(THREE.Material.prototype, 'clone');
    const baseline = counts();

    h.inspector.selectEntity(a1);
    enter(A);
    h.frame();
    const whileOpen = counts();
    expect(whileOpen).not.toEqual(baseline);
    for (let i = 0; i < 50; i++) {
      enter(i % 2 ? A : B);
      h.frame();
    }
    expect(counts()).toEqual(whileOpen);
    // a1, b1 and the tree: three distinct outside originals.
    expect(clone).toHaveBeenCalledTimes(3);

    h.scope.close(null);
    expect(counts()).toEqual(baseline);
    expect(meshOf(b1).material.opacity).toBe(1);
  });
});
