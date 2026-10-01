import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import { captureNavDiscovery } from '@/editor/lib/navAnalytics.js';
import { getGroupBounds } from '@/editor/lib/groups/groupBounds.js';
import { rayHitsGroupBox } from '@/editor/lib/groups/groupTransformMath.js';
import { group, item, mountEditor, posable, solid } from './_editorHarness.js';

const flags = vi.hoisted(() => ({ streetLevel: false }));

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/flag.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isStreetLevelNav: () => flags.streetLevel
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => flags.streetLevel,
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

// What the canvas draws and previews for user groups: their boxes, the
// magenta hover of a selected closed group, center markers, and hover parity with
// clicks. Real viewport, raycaster and scope controller (see _editorHarness).

let h;
let entered;
const onEnter = (el) => entered.push(el);

beforeEach(() => {
  h = mountEditor();
  entered = [];
  Events.on('raycastermouseenter', onEnter);
});

afterEach(() => {
  useStore.setState({ isInspectorEnabled: true, osmWayCandidate: null });
  h.dispose();
  Events.removeAllListeners();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  flags.streetLevel = false;
  vi.clearAllMocks();
});

const selected = () => h.inspector.selectedEntity;
const lastEntered = () => entered[entered.length - 1];

function sortedPoints(points) {
  return points
    .map((p) => p.toArray().map((v) => Number(v.toFixed(6))))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

// The eight corners a box helper draws, in world space.
function drawnCorners(helper) {
  helper.updateMatrixWorld(true);
  const array = helper.geometry.attributes.position.array;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push(
      new THREE.Vector3()
        .fromArray(array, i * 3)
        .applyMatrix4(helper.matrixWorld)
    );
  }
  return sortedPoints(corners);
}

// The eight corners of a group's local box placed by its world matrix: the
// volume the group's picking tests.
function volumeCorners(box, groupEl) {
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corners.push(
          new THREE.Vector3(x, y, z).applyMatrix4(groupEl.object3D.matrixWorld)
        );
      }
    }
  }
  return sortedPoints(corners);
}

function aimAtWorld(point) {
  h.aimDown(point.x, point.z);
}

function stubOsmStreets() {
  const osmEl = document.createElement('div');
  osmEl.setAttribute('osm-streets', '');
  const component = {
    wayAtPoint: () => ({
      way: { wayId: 'way-1', class: 'residential' },
      distance: 1,
      alreadyUpgraded: false
    }),
    highlightWayAt: vi.fn(),
    clearHighlight: vi.fn()
  };
  osmEl.components = { 'osm-streets': component };
  document.body.append(osmEl);
  return component;
}

describe('the box drawn for a group', () => {
  it('matches the pick volume at the group scale, resizes from a smaller hover and follows its members in the frame they move', () => {
    // G sits in an open group scaled 1.5, beside a selected sibling, so
    // hovering G's members previews G itself.
    const parent = group(h.streetContainer, {
      id: 'parent',
      scale: [1.5, 1.5, 1.5]
    });
    const sibling = solid(parent, [100, 0, 10], [101, 1, 11], {
      id: 'sibling'
    });
    const G = group(parent, { id: 'G', yaw: 30, scale: [2, 2, 2] });
    // Members about 50 m from the group origin, one of them batched: no
    // meshes, only the entity-local box batching leaves behind.
    const m1 = solid(G, [50, 0, 0], [51, 1, 1], { id: 'm1' });
    const m2 = item(G, { id: 'm2' });
    m2.object3D._batchLocalBbox = new THREE.Box3(
      new THREE.Vector3(52, 0, 0),
      new THREE.Vector3(53, 1, 2)
    );
    // At its own origin: an entity with no 'mesh' slot has its origin boxed.
    const small = solid(h.streetContainer, [0, 0, 0], [1, 0.5, 0.5], {
      id: 'small',
      position: [-20, 0, 0]
    });
    h.frame();
    h.inspector.selectEntity(sibling);
    expect(h.openIds()).toEqual(['parent']);
    const m1Center = () =>
      m1.object3D.localToWorld(new THREE.Vector3(50.5, 0.5, 0.5));

    h.aimDown(-19.5, 0.25);
    h.poll();
    expect(h.hoverBox.object).toBe(small.object3D);
    expect(h.hoverBox.boxFill.scale.toArray()).toEqual([1, 0.5, 0.5]);

    aimAtWorld(m1Center());
    h.poll();
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(G.object3D);
    const box = getGroupBounds(G);
    expect(box.min.toArray()).toEqual([50, 0, 0]);
    expect(box.max.toArray()).toEqual([53, 1, 2]);
    expect(drawnCorners(h.hoverBox)).toEqual(volumeCorners(box, G));
    h.hoverBox.boxFill.scale
      .toArray()
      .forEach((v, i) => expect(v).toBeCloseTo([9, 3, 6][i], 9));
    // The volume those corners enclose is the one clicks pick.
    const ray = new THREE.Ray(
      m1Center().add(new THREE.Vector3(0, 10, 0)),
      new THREE.Vector3(0, -1, 0)
    );
    expect(rayHitsGroupBox(ray, box, G.object3D.matrixWorld)).not.toBe(null);

    h.inspector.selectEntity(G);
    expect(h.selectionBox.visible).toBe(true);
    expect(drawnCorners(h.selectionBox)).toEqual(volumeCorners(box, G));

    // A member moved with no event: the frame that draws it draws the box
    // around it.
    m1.object3D.position.x += 10;
    let during;
    h.frame(() => {
      during = drawnCorners(h.selectionBox);
    });
    // m1 now spans x 60..61; the batched member still spans 52..53.
    const moved = new THREE.Box3(
      new THREE.Vector3(52, 0, 0),
      new THREE.Vector3(61, 1, 2)
    );
    expect(during).toEqual(volumeCorners(moved, G));
  });

  it('takes its markers and scene listeners away when the scope controller is disposed (fails if they outlive it)', () => {
    const G = group(h.streetContainer, { id: 'G' });
    h.inspector.selectEntity(G);
    h.frame();
    expect(h.markers()).toHaveLength(1);
    const { affordances } = h.inspector.groupScope;

    h.inspector.groupScope.dispose();
    const markers = h.inspector.sceneHelpers.children.filter(
      (c) => c.name === 'group-center-marker'
    );
    expect(markers).toEqual([]);
    affordances.dirty = false;
    Events.emit('historychanged', null);
    for (const type of ['child-attached', 'child-detached', 'newScene']) {
      h.sceneEl.dispatchEvent(new Event(type));
    }
    expect(affordances.dirty).toBe(false);
  });

  it('draws no box for a group with no member geometry, from the frame its last member leaves, and shows its marker instead', () => {
    const G = group(h.streetContainer, { id: 'G' });
    const member = solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    h.frame();
    h.inspector.selectEntity(G);
    h.frame();
    expect(h.selectionBox.fatBox.visible).toBe(true);
    // The selected group shows its marker at its center.
    expect(h.markers()).toHaveLength(1);
    expect(h.markers()[0].position.toArray()).toEqual([0.5, 0.5, 0.5]);

    // Its last member leaves: A-Frame reports the removal to the scene.
    member.remove();
    G.object3D.remove(member.object3D);
    h.sceneEl.dispatchEvent(
      new CustomEvent('child-detached', { detail: { el: member } })
    );
    h.frame();
    expect(h.selectionBox.fatBox.visible).toBe(false);
    expect(h.markers()).toHaveLength(1);
    expect(h.markers()[0].position.toArray()).toEqual([0, 0, 0]);
    h.frame();
    expect(h.selectionBox.fatBox.visible).toBe(false);
  });

  it('gives a selected group whose model has not loaded a marker to open it by, and an unselected one neither box nor marker', () => {
    const loading = group(h.streetContainer, {
      id: 'loading',
      position: [30, 0, 0]
    });
    item(loading, { id: 'pending-model' });
    const other = group(h.streetContainer, {
      id: 'other',
      position: [60, 0, 0]
    });
    item(other, { id: 'other-pending-model' });
    h.frame();
    expect(h.markers()).toHaveLength(0);

    h.inspector.selectEntity(loading);
    h.frame();
    expect(h.selectionBox.fatBox.visible).toBe(false);
    expect(h.markers()).toHaveLength(1);
    expect(h.markers()[0].position.toArray()).toEqual([30, 0, 0]);
    h.aimDown(30, 0);
    h.click();
    expect(h.openIds()).toEqual(['loading']);

    // Unselected, with members: no marker and nothing to pick. The first
    // click there leaves the open group (selecting it), the second clears.
    h.aimDown(60, 0);
    h.click();
    expect(h.openIds()).toEqual([]);
    expect(selected()).toBe(loading);
    h.click();
    expect(selected()).toBe(null);
    h.frame();
    expect(h.markers().map((m) => m.position.x)).not.toContain(60);
  });
});

describe('hovering groups', () => {
  it('shows the #808 hover, not grey or red, over the selected closed group and keeps red hover for an ordinary item', () => {
    const G = group(h.streetContainer, { id: 'G' });
    solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    const plain = solid(h.streetContainer, [10, 0, 0], [11, 1, 1], {
      id: 'plain'
    });
    h.frame();
    h.inspector.selectEntity(G);
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.object).toBe(G.object3D);
    expect(h.groupHoverBox.material.color.getHex()).toBe(0x880088);
    expect(h.groupHoverBox.boxFill.material.color.getHex()).toBe(0x880088);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
    expect(h.hoverBox.visible).toBe(false);

    h.aimDown(10.5, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(false);
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(plain.object3D);
    expect(h.hoverBox.material.color.getHex()).toBe(0xff0000);
    expect(h.hoverBox.boxFill.material.opacity).toBe(0.3);
  });

  it('previews what a click does inside and outside an open group, and offers no OSM street while it is open', () => {
    const osm = stubOsmStreets();
    const A = group(h.streetContainer, { id: 'A' });
    const a1 = solid(A, [0, 0, 0], [1, 1, 1], { id: 'a1' });
    const B = group(A, { id: 'B' });
    const tree = solid(B, [4, 0, 4], [5, 1, 5], { id: 'tree' });
    solid(h.streetContainer, [0, 3, 0], [1, 4, 1], { id: 'over' });
    solid(h.streetContainer, [20, 0, 0], [21, 1, 1], {
      id: 'outside'
    });
    h.frame();

    h.groupScope.open(A);
    expect(h.openIds()).toEqual(['A']);
    // A nearer outside object does not take the hover from a member.
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(lastEntered()).toBe(a1);
    expect(h.hoverBox.object).toBe(a1.object3D);

    // Empty space inside: a click there selects nothing, so nothing is
    // previewed, and no OSM street is offered while the group is open.
    h.inspector.selectEntity(a1);
    h.aimDown(2, 2);
    h.poll();
    expect(h.hoverBox.visible).toBe(false);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();

    // Outside the outermost scope over the ground: a click there only leaves
    // the group, so again nothing is previewed or offered.
    h.aimDown(40, 40);
    h.poll();
    expect(h.hoverBox.visible).toBe(false);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();

    // Outside a nested scope, over an item: nothing is previewed.
    h.inspector.selectEntity(tree);
    expect(h.openIds()).toEqual(['A', 'B']);
    entered.length = 0;
    h.aimDown(20.5, 0.5);
    h.poll();
    expect(entered).toEqual([]);
    expect(h.hoverBox.visible).toBe(false);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();
  });

  it('offers no OSM street upgrade while any group is open, inside it or outside, and offers it again once none is (fails if only hover or only the click is held back, or if it is held back while a group is merely selected)', () => {
    const osm = stubOsmStreets();
    const A = group(h.streetContainer, { id: 'A' });
    solid(A, [0, 0, 0], [1, 1, 1], { id: 'a1' });
    const B = group(A, { id: 'B' });
    solid(B, [4, 0, 4], [5, 1, 5], { id: 'tree' });
    h.frame();
    const candidate = () => useStore.getState().osmWayCandidate;

    // Empty space inside the open group: no hover preview, no chip.
    h.groupScope.open(A);
    h.aimDown(2, 2);
    h.poll();
    h.click();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A']);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();
    expect(candidate()).toBe(null);

    // Empty space outside a nested open group: the click only leaves it.
    h.groupScope.open(B);
    h.aimDown(40, 40);
    h.poll();
    h.click();
    expect(selected()).toBe(B);
    expect(h.openIds()).toEqual(['A']);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();
    expect(candidate()).toBe(null);
    // And outside the outermost one.
    h.click();
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);
    expect(osm.highlightWayAt).not.toHaveBeenCalled();
    expect(candidate()).toBe(null);

    // No group open (A selected, closed): the offer is back.
    h.poll();
    expect(osm.highlightWayAt).toHaveBeenCalledTimes(1);
    h.click();
    expect(selected()).toBe(null);
    expect(candidate()?.wayId).toBe('way-1');
    expect(osm.highlightWayAt).toHaveBeenCalledTimes(1);
  });

  it('under street-level navigation previews the group, not the raw member, for a closed group', () => {
    flags.streetLevel = true;
    const G = group(h.streetContainer, { id: 'G' });
    const member = solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    h.frame();
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(h.cursorEl.components.cursor.intersectedEl).toBe(member);
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(G.object3D);
  });
});

describe('a closed group is entered one level at a time', () => {
  it('does not select, or offer to open, a nested group through its marker where it reaches past the closed group', () => {
    const G = group(h.streetContainer, { id: 'G' });
    solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    // Empty, so it shows a marker; its pick cube (2 m either side here)
    // reaches well past G's 1 m box.
    group(G, { id: 'nested', position: [1.5, 0, 0.5] });
    h.frame();
    h.inspector.selectEntity(G);
    h.frame();

    h.aimDown(3, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(false);
    h.click();
    expect(selected()).toBe(G);
    expect(h.openIds()).toEqual([]);

    // Over G's own box the same click opens it, and says so on hover.
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    h.click();
    expect(h.openIds()).toEqual(['G']);
  });
});

describe('ordinary click side effects with a group selected', () => {
  it('offers an OSM street on empty ground, counts a selection once, and offers one again on the click after the one that leaves the open group', () => {
    stubOsmStreets();
    const G = group(h.streetContainer, { id: 'G' });
    solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    const plain = solid(h.streetContainer, [10, 0, 0], [11, 1, 1], {
      id: 'plain'
    });
    h.frame();
    const candidate = () => useStore.getState().osmWayCandidate;

    h.inspector.selectEntity(G);
    h.aimDown(40, 40);
    h.click();
    expect(selected()).toBe(null);
    expect(candidate()?.wayId).toBe('way-1');

    h.inspector.selectEntity(G);
    h.aimDown(10.5, 0.5);
    h.click();
    expect(selected()).toBe(plain);
    expect(candidate()).toBe(null);
    expect(captureNavDiscovery.mock.calls).toEqual([['select']]);

    h.inspector.selectEntity(G);
    h.aimDown(0.5, 0.5);
    h.click();
    expect(h.openIds()).toEqual(['G']);
    // Empty ground: the click leaves the group, selecting it, and offers
    // nothing; the next click there deselects and offers the street.
    h.aimDown(40, 40);
    h.click();
    expect(h.openIds()).toEqual([]);
    expect(selected()).toBe(G);
    expect(candidate()).toBe(null);
    h.click();
    expect(selected()).toBe(null);
    expect(candidate()?.wayId).toBe('way-1');
  });
});

describe('center markers', () => {
  it('lets an empty group be hovered and selected through its marker, but not through an entity in front of it', () => {
    const E = group(h.streetContainer, { id: 'E', position: [0, 5, 0] });
    const below = solid(h.streetContainer, [-1, 0, -1], [1, 1, 1], {
      id: 'below'
    });
    h.frame();
    const [marker] = h.markers();
    expect(marker.position.toArray()).toEqual([0, 5, 0]);
    expect(marker.userData.sphere.material.opacity).toBe(0.75);

    h.aimDown(0, 0);
    h.poll();
    expect(lastEntered()).toBe(E);
    h.frame();
    expect(marker.userData.sphere.material.opacity).toBe(1);
    h.click();
    expect(selected()).toBe(E);

    // The same marker behind an entity: the entity wins.
    h.inspector.selectEntity(null);
    E.object3D.position.y = -5;
    h.frame();
    h.aimDown(0, 0);
    h.poll();
    expect(lastEntered()).toBe(below);
    h.frame();
    expect(marker.userData.sphere.material.opacity).toBe(0.75);
    h.click();
    expect(selected()).toBe(below);
  });

  it('are not surfaces: nothing raycasting the scene hits a marker or the group hover', () => {
    const G = group(h.streetContainer, { id: 'G' });
    solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    group(h.streetContainer, { id: 'E', position: [10, 0, 0] });
    h.frame();
    h.inspector.selectEntity(G);
    h.frame();
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    const affordances = [...h.markers(), h.groupHoverBox];
    expect(affordances).toHaveLength(3);

    const raycaster = new THREE.Raycaster();
    raycaster.camera = h.camera;
    for (const affordance of affordances) {
      affordance.updateMatrixWorld(true);
      const at = affordance.getWorldPosition(new THREE.Vector3());
      raycaster.ray.set(
        at.clone().add(new THREE.Vector3(0, 20, 0)),
        new THREE.Vector3(0, -1, 0)
      );
      const hits = [];
      affordance.traverse((node) => node.raycast(raycaster, hits));
      expect(hits).toEqual([]);
      // A plain mesh in the same place is hit by the same ray.
      const control = new THREE.Mesh(new THREE.SphereGeometry(0.5));
      control.position.copy(at);
      control.updateMatrixWorld(true);
      const controlHits = [];
      control.raycast(raycaster, controlHits);
      expect(controlHits.length).toBeGreaterThan(0);
    }
  });
});

describe('a group selected in scale mode', () => {
  it('carries a placeholder on its marker that follows its center in the frame it moves, takes no press and is not a surface, opens the group on a click, and is drawn as the marker pick cube (fails on a scale handle, a placeholder posed once, or one drawn at another size)', () => {
    h.dispose();
    document.body.replaceChildren();
    h = mountEditor({ gizmo: true });
    const canvas = h.inspector.container;
    const g = posable(group(h.streetContainer));
    const member = posable(solid(g, [10, 0.5, 20], [14, 2, 24]));
    h.camera.position.set(12, 14, 38);
    h.camera.lookAt(12, 0, 22);
    h.camera.updateMatrixWorld(true);
    h.inspector.selectEntity(g);
    Events.emit('transformmodechange', 'scale');
    h.frame();
    h.frame();
    const affordances = h.inspector.groupScope.affordances;
    const placeholder = affordances.scalePlaceholder;
    const marker = affordances.markers.get(g);
    const world = (object) => object.getWorldPosition(new THREE.Vector3());
    expect(placeholder.visible).toBe(true);
    expect(
      world(placeholder).distanceTo(new THREE.Vector3(12, 1.25, 22))
    ).toBeLessThan(1e-9);

    // A member moved with nothing announced: the center moves, and the
    // placeholder with it, in that frame.
    member.object3D.position.x += 2;
    let placed;
    let markerAt;
    h.frame(() => {
      placed = world(placeholder);
      markerAt = world(marker);
    });
    expect(markerAt.distanceTo(new THREE.Vector3(14, 1.25, 22))).toBeLessThan(
      1e-9
    );
    expect(placed.distanceTo(markerAt)).toBeLessThan(1e-9);

    // Exactly the marker's pick cube: two marker radii either side.
    const size = new THREE.Box3()
      .setFromObject(placeholder)
      .getSize(new THREE.Vector3());
    const half = affordances.markerRadius(h.camera, markerAt) * 2;
    expect(size.x / 2).toBeCloseTo(half, 6);
    expect(size.y / 2).toBeCloseTo(half, 6);
    expect(size.z / 2).toBeCloseTo(half, 6);

    // Not a surface.
    const raycaster = new THREE.Raycaster(
      markerAt.clone().add(new THREE.Vector3(0, 20, 0)),
      new THREE.Vector3(0, -1, 0)
    );
    expect(raycaster.intersectObject(placeholder, true)).toEqual([]);

    // A 10 px drag that starts on it moves and scales nothing.
    const p = markerAt.clone().project(h.camera);
    const at = { x: (p.x + 1) * 600, y: (1 - p.y) * 400 };
    const before = h.inspector.history.undos.length;
    const pose = g.object3D.matrix.clone();
    const send = (type, x, button = 0) => {
      const event = new MouseEvent(type, {
        clientX: x,
        clientY: at.y,
        button,
        buttons: type.endsWith('up') ? 0 : 1,
        bubbles: true,
        cancelable: true
      });
      if (type.startsWith('pointer')) {
        Object.defineProperties(event, {
          pointerType: { value: 'mouse' },
          pointerId: { value: 1 },
          isPrimary: { value: true }
        });
      }
      canvas.dispatchEvent(event);
    };
    send('pointerdown', at.x);
    send('mousedown', at.x);
    for (let dx = 2; dx <= 10; dx += 2) send('pointermove', at.x + dx, -1);
    send('pointerup', at.x + 10);
    send('mouseup', at.x + 10);
    h.frame();
    expect(h.inspector.history.undos.length).toBe(before);
    expect(g.object3D.matrix.equals(pose)).toBe(true);
    expect(h.openIds()).toEqual([]);

    // A still click on it opens the group, as on the marker.
    h.aimDown(markerAt.x, markerAt.z);
    h.click();
    expect(h.openIds()).toEqual([g.id]);
  });
});
