import { vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import { Viewport } from '@/editor/lib/viewport.js';
import { Shortcuts } from '@/editor/lib/shortcuts.js';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import {
  TRANSFORM_REFUSED,
  refuseGuardedTransform
} from '@/editor/lib/transformGuard.js';
import { boxMesh, entity } from './_groupFixtures.js';

// The editor's canvas input, mounted for real on a bare scene: the viewport,
// its raycaster, the group scope controller and the keyboard shortcuts. Only
// A-Frame is absent. Its cursor entity is replaced by one whose raycaster
// intersects the scene with three's own Raycaster along a ray the test sets,
// keeping what A-Frame's does: nearest first, visible objects only, and only
// hits on objects that carry the entity they belong to (`.el`).
//
// A test file using this must mock, as vi.mock is per file:
// '@/editor/lib/cameras', '@/editor/lib/nav-experimental/index.js' (camera
// controls) and '@/editor/lib/navAnalytics.js'.
//
// `mountEditor({ gizmo: true })` also sets up what the easy gizmo needs to be
// driven with pointer events: a sized canvas, the helper scene inside the
// main scene (as the editor mounts it), and A-Frame's system registry, so the
// gizmo moves its entity from its own system tick as in the editor.

function shownInScene(object) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function fakeCursorEntity(sceneEl) {
  const el = document.createElement('a-entity');
  const three = new THREE.Raycaster();
  const cursor = {
    intersectedEl: null,
    clearCurrentIntersection: vi.fn()
  };
  const raycaster = {
    raycaster: three,
    intersections: [],
    // What the cursor's raycaster casts against: entity geometry that is
    // shown.
    get objects() {
      const objects = [];
      sceneEl.object3D.traverse((node) => {
        if (node.el && node.isMesh && shownInScene(node)) objects.push(node);
      });
      return objects;
    },
    refreshObjects() {},
    checkIntersections() {
      this.intersections = three
        .intersectObject(sceneEl.object3D, true)
        .filter((hit) => hit.object.el && shownInScene(hit.object));
      cursor.intersectedEl = this.intersections[0]?.object.el || null;
    }
  };
  el.components = { raycaster, cursor };
  el.isPlaying = true;
  el.play = () => {};
  el.pause = () => {};
  return el;
}

export function mountEditor({ gizmo = false } = {}) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  if (gizmo) {
    canvas.getBoundingClientRect = () => ({
      width: 1200,
      height: 800,
      left: 0,
      top: 0
    });
    Object.defineProperty(canvas, 'clientHeight', { value: 800 });
    Object.defineProperty(canvas, 'clientWidth', { value: 1200 });
    // jsdom has no pointer capture; the gizmos call it on a real canvas.
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
  }
  const sceneEl = document.createElement('a-scene');
  document.body.append(sceneEl);
  sceneEl.object3D = new THREE.Scene();
  sceneEl.object3D.el = sceneEl;
  sceneEl.renderer = { render: vi.fn() };
  sceneEl.canvas = canvas;
  sceneEl.systems = {};
  sceneEl.time = 0;
  sceneEl.isScene = true;

  const streetContainer = document.createElement('a-entity');
  streetContainer.id = 'street-container';
  streetContainer.isEntity = true;
  streetContainer.object3D = new THREE.Group();
  streetContainer.object3D.el = streetContainer;
  streetContainer.sceneEl = sceneEl;
  sceneEl.append(streetContainer);
  sceneEl.object3D.add(streetContainer.object3D);

  const camera = new THREE.PerspectiveCamera(60, gizmo ? 1.5 : 1, 0.1, 1000);
  const inspector = {
    sceneEl,
    container: canvas,
    sceneHelpers: new THREE.Scene(),
    camera,
    helpers: {},
    opened: true,
    config: {},
    selectedEntity: null,
    selected: null,
    // As the inspector's own (index.jsx): select the entity's object3D and
    // announce it once per change.
    selectEntity(el) {
      this.selectedEntity = el;
      this.select(el ? el.object3D : null);
    },
    select(object3D) {
      if (this.selected === object3D) return;
      this.selected = object3D;
      Events.emit('objectselect', object3D);
    },
    open() {
      this.opened = true;
    },
    close() {
      this.opened = false;
    }
  };
  // Composed execute: the real guard, then the real History and command.
  inspector.history = new History(inspector);
  inspector.execute = (type, payload) => {
    if (refuseGuardedTransform(type, payload)) return TRANSFORM_REFUSED;
    const Cmd = commandsByType.get(type);
    return inspector.history.execute(new Cmd(inspector, payload));
  };
  const aframe = {
    INSPECTOR: inspector,
    components: {},
    scenes: [{ systems: {}, camera }]
  };
  if (gizmo) {
    sceneEl.object3D.add(inspector.sceneHelpers);
    aframe.systems = {};
    aframe.registerSystem = (name, definition) => {
      aframe.systems[name] = definition;
    };
    sceneEl.initSystem = (name) => {
      const system = { ...aframe.systems[name], el: sceneEl, sceneEl };
      system.init();
      sceneEl.systems[name] = system;
    };
  }
  vi.stubGlobal('AFRAME', aframe);

  const cursorEl = fakeCursorEntity(sceneEl);
  // The raycaster creates its cursor entity first thing in the viewport.
  const create = vi
    .spyOn(document, 'createElement')
    .mockImplementationOnce(() => cursorEl);
  Viewport(inspector);
  create.mockRestore();
  Shortcuts.init(inspector);
  Shortcuts.enable();

  const raycaster = cursorEl.components.raycaster;
  const helperByColor = (hex) =>
    inspector.sceneHelpers.children.find(
      (c) => c.material?.color?.getHex?.() === hex
    );

  const pointer = { x: 100, y: 100 };
  const lastPress = { x: 0, y: 0 };
  const mouse = (type, detail, target = canvas) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: pointer.x,
        clientY: pointer.y,
        button: 0,
        detail,
        bubbles: true
      })
    );

  const harness = {
    inspector,
    sceneEl,
    streetContainer,
    camera,
    raycaster,
    cursorEl,
    scope: inspector.groupScope,
    selectionBox: helperByColor(0x1faaf2),
    hoverBox: helperByColor(0xff0000),
    groupHoverBox: helperByColor(0x888888),

    /** Point the cursor ray straight down onto (x, z). */
    aimDown(x, z) {
      raycaster.raycaster.ray.origin.set(x, 50, z);
      raycaster.raycaster.ray.direction.set(0, -1, 0);
      pointer.x += 7; // a different spot, so no stale click position matches
    },
    aim(origin, direction) {
      raycaster.raycaster.ray.origin.set(...origin);
      raycaster.raycaster.ray.direction.set(...direction).normalize();
      pointer.x += 7;
    },
    /** One hover poll, as the raycaster's interval runs it. */
    poll() {
      raycaster.checkIntersections();
    },
    /**
     * A stationary left click with click count `detail`, in the browser's
     * order: container mousedown; on release the cursor's click (only when
     * the ray hits an entity, as A-Frame's cursor), then the container's
     * mouseup, which bubbles after it.
     */
    click({ detail = 1 } = {}) {
      raycaster.checkIntersections();
      mouse('mousedown', detail);
      lastPress.x = pointer.x;
      lastPress.y = pointer.y;
      const up = new MouseEvent('mouseup', {
        clientX: pointer.x,
        clientY: pointer.y,
        button: 0,
        detail
      });
      if (raycaster.intersections.length) {
        cursorEl.dispatchEvent(
          new CustomEvent('click', { detail: { mouseEvent: up } })
        );
      }
      canvas.dispatchEvent(
        new MouseEvent('mouseup', {
          clientX: pointer.x,
          clientY: pointer.y,
          button: 0,
          detail,
          bubbles: true
        })
      );
    },
    dblclick() {
      mouse('dblclick', 2);
    },
    /**
     * A left-button release at the spot of the last press, with no press of
     * its own reaching the canvas: what a press claimed by a gizmo handle
     * (stopped before the canvas saw its mousedown) delivers.
     */
    releaseWithoutPress() {
      canvas.dispatchEvent(
        new MouseEvent('mouseup', {
          clientX: lastPress.x,
          clientY: lastPress.y,
          button: 0,
          detail: 1,
          bubbles: true
        })
      );
    },
    escape() {
      const event = new KeyboardEvent('keyup', {
        key: 'Escape',
        bubbles: true
      });
      Object.defineProperty(event, 'keyCode', { value: 27 });
      document.body.dispatchEvent(event);
    },
    /** One editor frame in the renderer's order; `between` sees what it draws. */
    frame(between) {
      sceneEl.time += 16;
      // System ticks run before the render (the easy gizmo moves here).
      sceneEl.systems['easy-gizmo-frame']?.tick();
      const scene3D = sceneEl.object3D;
      scene3D.updateMatrixWorld();
      scene3D.onBeforeRender({}, scene3D, camera, null);
      between?.();
      scene3D.onAfterRender({}, scene3D, camera);
    },
    openIds() {
      return [...inspector.groupScope.openStack];
    },
    markers() {
      return inspector.sceneHelpers.children.filter(
        (c) => c.name === 'group-center-marker' && c.visible
      );
    },
    dispose() {
      inspector.groupScope.dispose();
      inspector.easyGizmoControls.dispose();
      inspector.shapeVertexControls.dispose();
      inspector.streetNodeControls.dispose();
      inspector.segmentWidthControls.dispose();
      Shortcuts.disable();
    }
  };
  return harness;
}

let nextId = 0;
/** An entity with an id, as every entity the editor creates has. */
export function item(parent, options = {}) {
  const el = entity(parent, options);
  el.id = options.id || `item-${++nextId}`;
  // No named object3D slots: meshes are added straight to the object3D.
  el.getObject3D = () => undefined;
  return el;
}

export function group(parent, options = {}) {
  return item(parent, { ...options, cls: 'user-group' });
}

/** An entity with a box mesh from `min` to `max` in its own frame. */
export function solid(parent, min, max, options = {}) {
  const el = item(parent, options);
  boxMesh(el, min, max);
  return el;
}
