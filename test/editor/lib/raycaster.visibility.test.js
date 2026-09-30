/* global THREE */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { initRaycaster } from '@/editor/lib/raycaster';
import { updateEntity } from '@/editor/lib/entity';

// The inspector's cursor casts only at objects that were shown when its object
// list was last refreshed. A-Frame refreshes that list only after the list is
// marked dirty: by a DOM mutation inside the scene, or by an object3D being set
// or removed. This cursor component follows those same rules, so what the
// inspector adds on top of them is what is tested.
function aframeCursorEntity(sceneEl) {
  const el = document.createElement('a-entity');
  const raycaster = {
    dirty: true,
    objects: [],
    intersections: [],
    raycaster: new THREE.Raycaster(),
    setDirty() {
      this.dirty = true;
    },
    refreshObjects() {
      // The inspector asks for every scene element that is neither part of
      // the inspector nor marked to be ignored. jsdom mis-evaluates that
      // selector's chained :not(), so the same filter is applied by hand.
      const els = [...sceneEl.querySelectorAll('*')].filter(
        (entity) =>
          !entity.hasAttribute('data-aframe-inspector') &&
          !entity.hasAttribute('data-ignore-raycaster')
      );
      this.objects = [];
      els.forEach((entity) => {
        Object.values(entity.object3DMap || {}).forEach((object) =>
          this.objects.push(object)
        );
      });
      this.dirty = false;
    },
    checkIntersections() {
      if (this.dirty) this.refreshObjects();
      this.intersections = this.raycaster
        .intersectObjects(this.objects, true)
        .filter((hit) => hit.object.el);
      cursor.intersectedEl = this.intersections[0]?.object.el || null;
    }
  };
  const cursor = { intersectedEl: null, clearCurrentIntersection: vi.fn() };
  const observer = new MutationObserver(() => raycaster.setDirty());
  observer.observe(sceneEl, {
    childList: true,
    attributes: true,
    subtree: true
  });
  sceneEl.addEventListener('object3dset', () => raycaster.setDirty());
  sceneEl.addEventListener('object3dremove', () => raycaster.setDirty());
  el.components = { raycaster, cursor };
  const setDomAttribute = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    if (typeof value === 'string') setDomAttribute(name, value);
  };
  return el;
}

// An entity with one box mesh. Like A-Frame's `visible` component, setting
// `visible` changes the object3D and writes nothing to the DOM.
function boxEntity(sceneEl) {
  const el = document.createElement('a-entity');
  el.id = 'box';
  el.isEntity = true;
  el.object3D = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial()
  );
  mesh.el = el;
  el.object3D.add(mesh);
  el.object3DMap = { mesh };
  const setDomAttribute = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    if (name === 'visible') el.object3D.visible = value;
    else setDomAttribute(name, value);
  };
  sceneEl.appendChild(el);
  sceneEl.object3D.add(el.object3D);
  sceneEl.object3D.updateMatrixWorld(true);
  return el;
}

function mountCursor() {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  sceneEl.canvas = document.createElement('canvas');
  document.body.appendChild(sceneEl);
  const inspector = {
    sceneEl,
    container: document.createElement('div'),
    selectedEntity: null,
    selectEntity: vi.fn((el) => {
      inspector.selectedEntity = el;
    }),
    // The group scope controller as it is with no group in the scene: it
    // leaves every click and hover to the ordinary rules.
    groupScope: {
      isActive: () => false,
      isGroupingState: () => false,
      openElements: () => [],
      clearHover() {},
      hoverOpens: null,
      consumeDoubleClick: () => false
    }
  };
  const cursorEl = aframeCursorEntity(sceneEl);
  const create = vi
    .spyOn(document, 'createElement')
    .mockImplementationOnce(() => cursorEl);
  initRaycaster(inspector);
  create.mockRestore();
  const raycaster = cursorEl.components.raycaster;
  // Aim the cursor straight down at the origin.
  raycaster.raycaster.ray.origin.set(0, 20, 0);
  raycaster.raycaster.ray.direction.set(0, -1, 0);

  // A still click at one point. Its one mousedown and one mouseup reach the
  // container's listeners and the cursor's (which emits `mousedown`, and
  // `click` on an entity hit, with the mouseup as its mouseEvent), in the
  // order a freshly opened editor runs them: the container's first.
  const click = () => {
    raycaster.checkIntersections();
    const at = { clientX: 10, clientY: 10, button: 0, detail: 1 };
    inspector.container.dispatchEvent(
      new MouseEvent('mousedown', { ...at, bubbles: true })
    );
    cursorEl.dispatchEvent(new CustomEvent('mousedown', { detail: {} }));
    const up = new MouseEvent('mouseup', { ...at, bubbles: true });
    inspector.container.dispatchEvent(up);
    if (raycaster.intersections.length) {
      cursorEl.dispatchEvent(
        new CustomEvent('click', { detail: { mouseEvent: up } })
      );
    }
    return inspector.selectedEntity;
  };
  return { sceneEl, inspector, raycaster, click };
}

describe('inspector cursor and entity visibility', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps an entity pickable after it is hidden and shown again', () => {
    const { sceneEl, inspector, raycaster, click } = mountCursor();
    const box = boxEntity(sceneEl);
    const mesh = box.object3DMap.mesh;

    expect(click()).toBe(box);
    inspector.selectEntity(null);

    updateEntity(box, 'visible', null, false);
    expect(click()).toBe(null);
    expect(raycaster.objects).not.toContain(mesh);

    updateEntity(box, 'visible', null, true);
    expect(click()).toBe(box);
    expect(raycaster.objects).toContain(mesh);
  });
});
