import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

// Fading everything outside an open group, in a real browser: real
// THREE.BatchedMesh draws (with a real WebGL renderer and its shadow pass),
// real batch-models folds, the real map-layer components and a real A-Frame
// scene. The tile streaming library is replaced by a stand-in that loads
// nothing; tile materials are prepared by its real fade manager.

vi.mock('3d-tiles-renderer', async () => {
  const { EventDispatcher, Group } = await import('three');
  class TilesRenderer extends EventDispatcher {
    constructor() {
      super();
      this.group = new Group();
      this.loaded = [];
    }

    registerPlugin() {}
    setCamera() {}
    deleteCamera() {}
    setResolutionFromRenderer() {}
    update() {}
    dispose() {}
    resetFailedTiles() {}
    getAttributions() {
      return [];
    }

    forEachLoadedModel(callback) {
      this.loaded.forEach((scene) => callback(scene));
    }

    // A tile arriving, as the library announces it.
    loadTile(scene) {
      this.loaded.push(scene);
      this.dispatchEvent({ type: 'load-model', scene });
    }
  }
  return { TilesRenderer };
});

vi.mock('3d-tiles-renderer/plugins', () => {
  class Plugin {
    constructor(options) {
      this.options = options;
    }

    transformLatLonHeightToOrigin() {}
    getPositionFromCartographic(lat, lon, target) {
      return target.set(0, 0, 0);
    }

    deleteShape() {}
    updateShape() {}
    hasShape() {
      return false;
    }
  }
  return {
    TilesFadePlugin: Plugin,
    TileCompressionPlugin: Plugin,
    GLTFExtensionsPlugin: Plugin,
    GoogleCloudAuthPlugin: Plugin,
    TileFlatteningPlugin: Plugin,
    ReorientationPlugin: Plugin,
    GeneratedSurfacePlugin: Plugin,
    XYZTilesOverlay: Plugin
  };
});

let THREE;
let batch;
let BatchAttenuation;
let ScopeAttenuation;
let installEditorFrame;
let presentation;
let FadeMaterialManager;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  THREE = window.THREE;
  window.STREET = window.STREET || {};
  batch = await import('../../src/batch-models.js');
  ({ BatchAttenuation } =
    await import('../../src/editor/lib/groups/attenuateBatches.js'));
  ({ ScopeAttenuation } =
    await import('../../src/editor/lib/groups/scopeAttenuation.js'));
  ({ installEditorFrame } =
    await import('../../src/editor/lib/editorFrame.js'));
  presentation =
    await import('../../src/tested/reference-layer-presentation.js');
  await import('../../src/aframe-components/google-maps-aerial.js');
  await import('../../src/aframe-components/tiled-basemap.js');
  await import('../../src/aframe-components/osm-buildings.js');
  ({ FadeMaterialManager } =
    await import('3d-tiles-renderer/src/three/plugins/fade/FadeMaterialManager.js'));
  window.AFRAME.emitReady?.();
});

beforeEach(() => {
  window.AFRAME.INSPECTOR = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  presentation.setPresentationFactor(1);
  window.AFRAME.INSPECTOR = null;
});

// ------------------------------------------------------------ rendering

// A renderer and camera looking down at the origin, with a shadow-casting
// light so three runs its shadow pass.
function makeRenderer(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.shadowMap.enabled = true;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 30, 30);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 30, 10);
  light.castShadow = true;
  scene.add(light);
  return { renderer, camera };
}

// Every BatchedMesh draw list built during a render: mesh -> { main, shadow }
// instance ids, in draw order. `throwFor` makes one mesh's draw throw once.
function recordDrawLists() {
  const lists = new Map();
  const proto = THREE.BatchedMesh.prototype;
  const original = proto.onBeforeRender;
  const control = { throwFor: null, lists };
  vi.spyOn(proto, 'onBeforeRender').mockImplementation(
    function (renderer, scene) {
      if (control.throwFor === this) {
        control.throwFor = null;
        throw new Error('draw list failed');
      }
      const result = original.apply(this, arguments);
      const ids = Array.from(
        this._indirectTexture.image.data.slice(0, this._multiDrawCount)
      );
      const entry = lists.get(this) || {};
      entry[scene === null ? 'shadow' : 'main'] = ids;
      lists.set(this, entry);
      return result;
    }
  );
  return control;
}

function box(x) {
  return new THREE.Matrix4().makeTranslation(x, 0.5, 0);
}

// A real BatchedMesh with an instance per entity in `els`, as batch-models
// builds them.
function makeBatch(els, maxInstances = els.length) {
  const source = new THREE.BatchedMesh(
    maxInstances,
    64,
    128,
    new THREE.MeshStandardMaterial()
  );
  source._batchIdToEl = [];
  source.castShadow = true;
  const geometryId = source.addGeometry(new THREE.BoxGeometry());
  els.forEach((el, i) => {
    const id = source.addInstance(geometryId);
    source.setMatrixAt(id, box(i * 3 - 3));
    source._batchIdToEl[id] = el;
  });
  return source;
}

// ------------------------------------------------------ splitting a batch

describe('a batch with instances on both sides of the open group', () => {
  let scene;
  let renderer;
  let camera;
  let outsideEl;
  let insideEl;
  let throwing;
  let batches;
  let fades;

  beforeEach(() => {
    scene = new THREE.Scene();
    ({ renderer, camera } = makeRenderer(scene));
    outsideEl = { name: 'outside' };
    insideEl = { name: 'inside' };
    throwing = false;
    fades = new Map();
    batches = new BatchAttenuation({
      isOutside: (el) => {
        if (throwing) throw new Error('classification failed');
        return el === outsideEl;
      },
      fadedMaterial: (material) => {
        if (!fades.has(material)) {
          const copy = material.clone();
          copy.transparent = true;
          copy.opacity = 0.2;
          fades.set(material, copy);
        }
        return fades.get(material);
      }
    });
  });

  afterEach(() => renderer.dispose());

  function renderWindow(source) {
    const prepared = batches.prepare(source, camera);
    renderer.render(scene, camera);
    batches.finish();
    return prepared;
  }

  it('draws only inside instances from the batch and only outside ones from its view, with shadows unchanged', () => {
    const source = makeBatch([outsideEl, insideEl]);
    scene.add(source);
    const record = recordDrawLists();
    expect(renderWindow(source)).toBe(true);

    const view = batches.views.get(source);
    expect(record.lists.get(source).main).toEqual([1]);
    expect(record.lists.get(view).main).toEqual([0]);
    expect(record.lists.get(source).shadow.sort()).toEqual([0, 1]);
    expect(view.material.opacity).toBeCloseTo(0.2, 9);
    expect(source.material.opacity).toBe(1);
    // Nothing of the split outlives the render.
    expect(source.customSort).toBe(null);
    expect(source.children).toEqual([]);
    expect(view.geometry).toBe(source.geometry);
  });

  it('lets a failing sort pass the list through, and a failing view drop out from the next render on', () => {
    const source = makeBatch([outsideEl, insideEl]);
    scene.add(source);
    const record = recordDrawLists();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    batches.prepare(source, camera);
    throwing = true;
    renderer.render(scene, camera);
    throwing = false;
    batches.finish();
    expect(record.lists.get(source).main.sort()).toEqual([0, 1]);
    expect(error).toHaveBeenCalled();

    error.mockClear();
    const view = batches.views.get(source);
    record.throwFor = view;
    expect(() => renderWindow(source)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    // Untreated from now on: no view, the batch draws everything.
    record.lists.clear();
    expect(renderWindow(source)).toBe(false);
    expect(record.lists.get(view)).toBeUndefined();
    expect(record.lists.get(source).main.sort()).toEqual([0, 1]);
  });

  it('leaves a batch whose instance data would make three throw untreated, without attaching a view', () => {
    const parked = { name: 'parked outside' };
    const source = makeBatch([outsideEl, insideEl, parked]);
    // Culling the batch as a whole uses a bounding sphere computed first.
    source.computeBoundingSphere();
    // An instance three will not draw (hidden) but that points past the
    // geometry list.
    source.setVisibleAt(2, false);
    source._instanceInfo[2].geometryIndex = 99;
    scene.add(source);
    const record = recordDrawLists();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(renderWindow(source)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(batches.views.get(source)).toBeUndefined();
    expect(record.lists.get(source).main.sort()).toEqual([0, 1]);
  });

  it('re-binds its view to the batch after growth, sharing its data and never disposing it', () => {
    const source = makeBatch([outsideEl, insideEl]);
    scene.add(source);
    renderWindow(source);
    const firstView = batches.views.get(source);

    source.setInstanceCount(8);
    const moved = box(6);
    source.setMatrixAt(0, moved);
    // The batch uploads its regrown data in a plain render first.
    renderer.render(scene, camera);
    const textures = renderer.info.memory.textures;
    const disposed = [];
    source.geometry.addEventListener('dispose', () =>
      disposed.push('geometry')
    );
    source._matricesTexture.addEventListener('dispose', () =>
      disposed.push('matrices')
    );
    const record = recordDrawLists();

    renderWindow(source);
    const view = batches.views.get(source);
    expect(view).not.toBe(firstView);
    expect(view._matricesTexture).toBe(source._matricesTexture);
    expect(view.geometry).toBe(source.geometry);
    expect(record.lists.get(view).main).toEqual([0]);
    expect(view.getMatrixAt(0, new THREE.Matrix4()).equals(moved)).toBe(true);
    expect(renderer.info.memory.textures).toBe(textures);
    expect(disposed).toEqual([]);
  });

  it('re-binds the view it keeps when the batch replaces its geometry without growing', () => {
    const source = makeBatch([outsideEl, insideEl]);
    scene.add(source);
    renderWindow(source);
    const view = batches.views.get(source);
    const oldGeometry = source.geometry;

    source.setGeometrySize(256, 512);
    expect(source.geometry).not.toBe(oldGeometry);
    const record = recordDrawLists();
    renderWindow(source);
    expect(batches.views.get(source)).toBe(view);
    expect(view.geometry).toBe(source.geometry);
    expect(record.lists.get(view).main).toEqual([0]);
  });

  it('is left untreated, with a warning, under a three.js revision it was not written for', () => {
    const source = makeBatch([outsideEl, insideEl]);
    scene.add(source);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = new BatchAttenuation({
      isOutside: () => true,
      fadedMaterial: (m) => m,
      threeRevision: '1'
    });
    expect(other.prepare(source, camera)).toBe(false);
    other.finish();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(source.customSort).toBe(null);
    expect(source.children).toEqual([]);
  });
});

// ------------------------------------------- batch-models, while faded

describe('batch-models folding a member while outside content is faded', () => {
  // A scene of plain elements carrying object3Ds, wired as A-Frame wires
  // them (setObject3D adds to the scene graph and announces it).
  function makeScene() {
    const sceneEl = document.createElement('div');
    sceneEl.object3D = new THREE.Scene();
    sceneEl.time = 0;
    sceneEl.emit = (name, detail) =>
      sceneEl.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    const container = entity(sceneEl, 'street-container');
    const batchRoot = entity(container, 'batch-models-root');
    const objects = {};
    batchRoot.setObject3D = (key, object) => {
      objects[key] = object;
      object.el = batchRoot;
      batchRoot.object3D.add(object);
      batchRoot.emit('object3dset', { object, type: key });
    };
    batchRoot.getObject3D = (key) => objects[key];
    batchRoot.removeObject3D = (key) => {
      objects[key]?.removeFromParent();
      delete objects[key];
      batchRoot.emit('object3dremove', { type: key });
    };
    document.body.appendChild(sceneEl);
    return { sceneEl, container };
  }

  function entity(parent, id, className) {
    const el = document.createElement('div');
    if (id) el.id = id;
    if (className) el.className = className;
    el.object3D = new THREE.Group();
    el.object3D.el = el;
    el.emit = (name, detail) =>
      el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    parent.appendChild(el);
    parent.object3D.add(el.object3D);
    el.sceneEl = parent.sceneEl || parent;
    return el;
  }

  // Loads of one model share its material, as the model cache shares them.
  const sharedMaterials = new Map();
  function makeModelEl(parent, src, id, x) {
    const el = entity(parent, id);
    el.setAttribute('gltf-model', src);
    el.object3D.position.set(x, 0, 0);
    el.object3D.updateMatrixWorld(true);
    let mesh = null;
    const component = {
      data: src,
      deferLoad: false,
      _loadSettled: false,
      removeMesh: vi.fn(() => {
        mesh?.removeFromParent();
        mesh = null;
      }),
      update: vi.fn()
    };
    el.components = { 'gltf-model': component };
    el.getObject3D = (type) => (type === 'mesh' ? mesh : undefined);
    el.land = () => {
      if (!sharedMaterials.has(src)) {
        sharedMaterials.set(src, new THREE.MeshStandardMaterial());
      }
      mesh = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterials.get(src));
      el.object3D.add(mesh);
      component._loadSettled = true;
      el.emit('model-loaded', { format: 'gltf', model: mesh });
    };
    return el;
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  let fixture;
  afterEach(() => {
    fixture?.attenuation.dispose();
    fixture?.renderer.dispose();
    fixture?.sceneEl.remove();
    fixture = null;
  });

  async function setUp(outsideCount) {
    sharedMaterials.clear();
    const { sceneEl, container } = makeScene();
    const G = entity(container, 'group', 'user-group');
    const outside = [];
    for (let i = 0; i < outsideCount; i++) {
      outside.push(makeModelEl(container, 'a.glb', `out-${i}`, -6 + i * 2));
    }
    const pass = batch.batchModels(sceneEl);
    await new Promise((resolve) =>
      sceneEl.addEventListener('batch-grouping-done', resolve, { once: true })
    );
    outside.forEach((el) => el.land());
    await pass;
    await flush();
    const { renderer, camera } = makeRenderer(sceneEl.object3D);
    const editorFrame = installEditorFrame(sceneEl);
    const attenuation = new ScopeAttenuation({ sceneEl, editorFrame });
    fixture = { sceneEl, container, G, outside, renderer, camera, attenuation };
    return fixture;
  }

  // One editor render: the window's hooks run with the editor open.
  function render({ renderer, camera, sceneEl }, between) {
    window.AFRAME.INSPECTOR = { opened: true };
    sceneEl.time += 16;
    let seen;
    const unregister = installEditorFrame(sceneEl).register(
      () => (seen = between?.()),
      { order: 100, everyRender: true }
    );
    try {
      renderer.render(sceneEl.object3D, camera);
    } finally {
      unregister();
      window.AFRAME.INSPECTOR = null;
    }
    return seen;
  }

  function batches(sceneEl) {
    const found = [];
    sceneEl.object3D.traverse((node) => {
      if (node.isBatchedMesh && node._batchIdToEl) found.push(node);
    });
    return found;
  }

  it('keeps the batch material and draws a member folded into an all-outside batch at full strength', async () => {
    const f = await setUp(2);
    const [source] = batches(f.sceneEl);
    expect(source).toBeDefined();
    const material = source.material;
    f.attenuation.apply(f.G, 1);
    render(f);

    // An inside copy of the same model loads and folds into the batch.
    const inside = makeModelEl(f.G, 'a.glb', 'in-0', 4);
    inside.land();
    await flush();
    expect(batch.isBatched(inside)).toBe(true);
    const insideId = source._batchIdToEl.indexOf(inside);
    expect(insideId).toBeGreaterThanOrEqual(0);

    const record = recordDrawLists();
    const during = render(f, () => source.material);
    expect(during).toBe(material);
    expect(record.lists.get(source).main).toEqual([insideId]);
    const view = [...record.lists.keys()].find((mesh) => mesh !== source);
    expect(record.lists.get(view).main.sort()).toEqual([0, 1]);
  });

  it('builds a new batch for inside copies of an outside model from the original material, and leaves nothing faded on exit', async () => {
    const f = await setUp(1);
    expect(batches(f.sceneEl)).toEqual([]);
    const outsideMesh = f.outside[0].getObject3D('mesh');
    const original = outsideMesh.material;
    f.attenuation.apply(f.G, 1);
    expect(render(f, () => outsideMesh.material.opacity)).toBeCloseTo(0.2, 9);

    const insideA = makeModelEl(f.G, 'a.glb', 'in-a', 4);
    const insideB = makeModelEl(f.G, 'a.glb', 'in-b', 6);
    insideA.land();
    insideB.land();
    await flush();
    const [source] = batches(f.sceneEl);
    expect(source).toBeDefined();
    const record = recordDrawLists();
    const during = render(f, () => ({
      material: source.material,
      children: source.children.length
    }));
    expect(during.material.opacity).toBe(1);
    expect(during.material.transparent).toBe(false);
    expect(during.children).toBe(0);
    expect(record.lists.get(source).main.sort()).toEqual([0, 1]);

    f.attenuation.restore();
    const after = render(f, () => ({
      outside: outsideMesh.material,
      sorting: source.customSort,
      children: source.children.length
    }));
    expect(after).toEqual({ outside: original, sorting: null, children: 0 });
    expect(original.opacity).toBe(1);
  });
});

// ------------------------------------------------ map layers and A-Frame

describe('in an A-Frame scene', () => {
  let sceneEl;
  let fade;

  async function makeScene() {
    sceneEl = document.createElement('a-scene');
    sceneEl.setAttribute('renderer', 'antialias: false');
    for (const id of ['street-container', 'reference-layers']) {
      const el = document.createElement('a-entity');
      el.id = id;
      sceneEl.appendChild(el);
    }
    document.body.appendChild(sceneEl);
    if (!sceneEl.hasLoaded) {
      await new Promise((resolve) =>
        sceneEl.addEventListener('loaded', resolve, { once: true })
      );
    }
    fade = new FadeMaterialManager();
    return sceneEl;
  }

  afterEach(() => {
    sceneEl?.remove();
    sceneEl = null;
  });

  async function add(parent, html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const el = holder.firstElementChild;
    parent.appendChild(el);
    if (!el.hasLoaded) {
      await new Promise((resolve) =>
        el.addEventListener('loaded', resolve, { once: true })
      );
    }
    return el;
  }

  // A streamed tile: a mesh whose material the tile library's fade manager
  // has prepared.
  function tile() {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial()
    );
    scene.add(mesh);
    fade.prepareScene(scene);
    return { scene, mesh, material: mesh.material };
  }

  const layers = [
    ['google-maps-aerial', ''],
    ['tiled-basemap', 'urlTemplate: https://example.invalid/{z}/{x}/{y}.png']
  ];

  it.each(layers)(
    '%s multiplies its own opacity by the presentation factor, keeping tile materials and their fade',
    async (name, extra) => {
      await makeScene();
      const references = document.getElementById('reference-layers');
      const layer = await add(
        references,
        `<a-entity ${name}="${extra}${extra ? '; ' : ''}opacity: 0.5"></a-entity>`
      );
      const component = layer.components[name];
      const first = tile();
      component.tiles.loadTile(first.scene);
      expect(first.material.opacity).toBe(0.5);

      presentation.setPresentationFactor(0.2);
      expect(first.material.opacity).toBeCloseTo(0.1, 9);
      expect(first.mesh.material).toBe(first.material);
      // Its fade is still driven by the tile library.
      fade.setFade(first.scene, 0.5, 0);
      expect(first.material.defines.FEATURE_FADE).toBe(1);

      // The layer's own opacity changes while the factor applies.
      layer.setAttribute(name, 'opacity', 0.8);
      expect(first.material.opacity).toBeCloseTo(0.16, 9);

      presentation.setPresentationFactor(1);
      expect(first.material.opacity).toBeCloseTo(0.8, 9);
      expect(first.mesh.material).toBe(first.material);
    }
  );

  it.each(layers)(
    '%s at full opacity fades a tile streamed in while the factor applies, and a layer created then reads it at once',
    async (name, extra) => {
      await makeScene();
      const references = document.getElementById('reference-layers');
      const layer = await add(
        references,
        `<a-entity ${name}="${extra}"></a-entity>`
      );
      presentation.setPresentationFactor(0.2);
      const streamed = tile();
      layer.components[name].tiles.loadTile(streamed.scene);
      expect(streamed.material.opacity).toBeCloseTo(0.2, 9);
      expect(streamed.material.transparent).toBe(true);

      const late = await add(
        references,
        `<a-entity ${name}="${extra}"></a-entity>`
      );
      const lateTile = tile();
      late.components[name].tiles.loadTile(lateTile.scene);
      expect(lateTile.material.opacity).toBeCloseTo(0.2, 9);

      presentation.setPresentationFactor(1);
      expect(streamed.material.opacity).toBe(1);
      expect(streamed.material.transparent).toBe(false);
    }
  );

  it.each([...layers, ['osm-buildings', '']])(
    '%s stops following the factor once removed',
    async (name, extra) => {
      await makeScene();
      const references = document.getElementById('reference-layers');
      const layer = await add(
        references,
        `<a-entity ${name}="${extra}"></a-entity>`
      );
      const component = layer.components[name];
      component.tick = () => {};
      const apply = vi.spyOn(
        component,
        name === 'osm-buildings' ? 'applyOpacity' : 'applyOpacityToLoadedTiles'
      );
      presentation.setPresentationFactor(0.5);
      expect(apply).toHaveBeenCalledTimes(1);
      layer.parentNode.removeChild(layer);
      await new Promise((resolve) => setTimeout(resolve, 0));
      apply.mockClear();
      presentation.setPresentationFactor(0.2);
      expect(apply).not.toHaveBeenCalled();
    }
  );

  describe('with a group open', () => {
    let attenuation;
    let group;
    let camera;

    async function open() {
      await makeScene();
      const container = document.getElementById('street-container');
      group = await add(container, '<a-entity class="user-group"></a-entity>');
      await add(group, '<a-entity geometry="primitive: box"></a-entity>');
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
      camera.position.set(0, 20, 20);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      attenuation = new ScopeAttenuation({
        sceneEl,
        editorFrame: installEditorFrame(sceneEl)
      });
      attenuation.apply(group, 1);
    }

    afterEach(() => attenuation?.dispose());

    // One editor render; `between` sees what is drawn.
    function render(between) {
      window.AFRAME.INSPECTOR = { opened: true };
      sceneEl.time = (sceneEl.time || 0) + 1000;
      let seen;
      const unregister = installEditorFrame(sceneEl).register(
        () => (seen = between()),
        { order: 100, everyRender: true }
      );
      try {
        sceneEl.renderer.render(sceneEl.object3D, camera);
      } finally {
        unregister();
        window.AFRAME.INSPECTOR = null;
      }
      return seen;
    }

    it('treats meshes arriving under a nested outside entity before they are drawn', async () => {
      await open();
      const container = document.getElementById('street-container');
      const outer = await add(container, '<a-entity></a-entity>');
      const inner = await add(outer, '<a-entity></a-entity>');

      const set = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial()
      );
      inner.setObject3D('extra', set);
      const appended = await add(
        inner,
        '<a-entity geometry="primitive: box" material="color: red"></a-entity>'
      );
      const appendedMesh = appended.getObject3D('mesh');
      // Geometry added without an event, announced by model-loaded.
      const loaded = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial()
      );
      inner.object3D.add(loaded);
      inner.emit('model-loaded', { format: 'gltf', model: loaded });

      const opacities = render(() =>
        [set, appendedMesh, loaded].map((mesh) => mesh.material.opacity)
      );
      opacities.forEach((opacity) => expect(opacity).toBeCloseTo(0.2, 9));
      expect(set.material.opacity).toBe(1);
      expect(appendedMesh.material.opacity).toBe(1);
    });

    it('fades a new OSM building tile only through its layer: exactly layer opacity times the factor', async () => {
      await open();
      const references = document.getElementById('reference-layers');
      const layer = await add(
        references,
        '<a-entity osm-buildings="opacity: 0.5"></a-entity>'
      );
      const component = layer.components['osm-buildings'];
      component.tick = () => {};
      expect(component.material.opacity).toBeCloseTo(0.1, 9);
      component.addTileMesh('t', {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        indices: new Uint32Array([0, 1, 2])
      });
      const mesh = layer.getObject3D('tile-t');
      const drawn = render(() => mesh.material);
      expect(drawn).toBe(component.material);
      expect(drawn.opacity).toBeCloseTo(0.5 * 0.2, 12);

      attenuation.restore();
      expect(component.material.opacity).toBe(0.5);
    });
  });
});
