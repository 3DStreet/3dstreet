import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events';
import useStore from '@/store';
import { installEditorFrame } from '@/editor/lib/editorFrame.js';
import {
  getGroupBounds,
  trackLiveGroupBounds
} from '@/editor/lib/groups/groupBounds.js';
import { boxMesh, entity, expectBox, group, scene } from './_groupFixtures.js';

let sceneEl;
let inspector;
let emitted;
const onChanged = (groupEl) => emitted.push(groupEl);
const renderer = {};
const camera = new THREE.PerspectiveCamera();

// One editor frame in the renderer's order. `early` runs once the frame's
// clock has advanced and before the render starts (where a tick handler or an
// input event reads); `between` runs after the before hook returns and before
// the after hook: what that frame draws.
function frame(between, { early } = {}) {
  sceneEl.time += 16;
  early?.();
  const scene3D = sceneEl.object3D;
  scene3D.updateMatrixWorld();
  scene3D.onBeforeRender(renderer, scene3D, camera, null);
  between?.();
  scene3D.onAfterRender(renderer, scene3D, camera);
}

beforeEach(() => {
  sceneEl = scene();
  // close()/open() flip `opened`, as the inspector's own do; the store's
  // setIsInspectorEnabled calls them.
  inspector = {
    opened: true,
    selectedEntity: null,
    open() {
      this.opened = true;
    },
    close() {
      this.opened = false;
    }
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
  trackLiveGroupBounds(installEditorFrame(sceneEl), sceneEl);
  emitted = [];
  Events.on('groupboundschanged', onChanged);
});

afterEach(() => {
  Events.off('groupboundschanged', onChanged);
  sceneEl.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live group bounds in the editor frame', () => {
  it('picks up a member moved with no event, in the frame it moved, despite an on-demand read earlier in that frame (fails with event-driven invalidation or a recompute satisfied by the read)', () => {
    const g = group(sceneEl);
    const member = entity(g);
    boxMesh(member, [0, 0, 0], [1, 1, 1]);
    inspector.selectedEntity = g;
    frame();
    expect(emitted).toEqual([g]);
    frame();
    expect(emitted).toEqual([g]);

    member.object3D.position.set(5, 0, 0);
    frame(
      () => {
        expectBox(getGroupBounds(g), [5, 0, 0], [6, 1, 1]);
        expect(emitted).toEqual([g, g]);
      },
      {
        // An on-demand read in this frame, before its window, returns the
        // stored box.
        early: () => expectBox(getGroupBounds(g), [0, 0, 0], [1, 1, 1])
      }
    );
  });

  it('includes a mesh added since the last frame, still at its default matrixWorld when added', () => {
    const g = group(sceneEl, { position: [10, 0, 0] });
    boxMesh(entity(g), [0, 0, 0], [1, 1, 1]);
    inspector.selectedEntity = g;
    frame();
    const late = entity(g, { position: [0, 0, 3] });
    const mesh = boxMesh(late, [0, 0, 0], [1, 2, 1]);
    expect(mesh.matrixWorld.equals(new THREE.Matrix4())).toBe(true);
    frame(() => expectBox(getGroupBounds(g), [0, 0, 0], [1, 2, 4]));
    expect(emitted).toEqual([g, g]);
  });

  it('measures nothing while no group is selected or open (fails if it recomputes with no consumer)', () => {
    const g = group(sceneEl);
    boxMesh(entity(g), [0, 0, 0], [1, 1, 1]);
    const traverse = vi.spyOn(g.object3D, 'traverseVisible');
    inspector.selectedEntity = g;
    frame();
    expect(traverse).toHaveBeenCalledTimes(1);
    inspector.selectedEntity = entity(sceneEl);
    for (let i = 0; i < 3; i++) frame();
    inspector.selectedEntity = null;
    for (let i = 0; i < 3; i++) frame();
    expect(traverse).toHaveBeenCalledTimes(1);
  });

  it('measures the selected group and the innermost open scope, never an outer scope (fails if outer scopes are recomputed)', () => {
    const a = group(sceneEl);
    a.id = 'scope-a';
    boxMesh(entity(a), [0, 0, 0], [1, 1, 1]);
    const b = group(a);
    b.id = 'scope-b';
    boxMesh(entity(b), [0, 0, 0], [1, 1, 1]);
    const traverseA = vi.spyOn(a.object3D, 'traverseVisible');
    const traverseB = vi.spyOn(b.object3D, 'traverseVisible');

    inspector.selectedEntity = a;
    frame();
    expect(traverseA).toHaveBeenCalledTimes(1);
    // three's traversal of A recurses through B's own traverseVisible.
    const bDuringA = traverseB.mock.calls.length;

    inspector.groupScope = { openStack: ['scope-a', 'scope-b'] };
    inspector.selectedEntity = b;
    for (let i = 0; i < 3; i++) frame();
    expect(traverseA).toHaveBeenCalledTimes(1);
    expect(traverseB).toHaveBeenCalledTimes(bDuringA + 3);

    // A member of the innermost scope selected: the scope is still measured.
    inspector.selectedEntity = b.firstElementChild;
    frame();
    expect(traverseB).toHaveBeenCalledTimes(bDuringA + 4);
    expect(traverseA).toHaveBeenCalledTimes(1);
  });

  it('stops while the editor is closed and resumes when it reopens (fails with no editor-open gate)', () => {
    const g = group(sceneEl);
    boxMesh(entity(g), [0, 0, 0], [1, 1, 1]);
    const traverse = vi.spyOn(g.object3D, 'traverseVisible');
    inspector.selectedEntity = g;
    frame();
    expect(traverse).toHaveBeenCalledTimes(1);

    useStore.getState().setIsInspectorEnabled(false);
    expect(inspector.opened).toBe(false);
    for (let i = 0; i < 5; i++) frame();
    expect(traverse).toHaveBeenCalledTimes(1);

    useStore.getState().setIsInspectorEnabled(true);
    frame();
    expect(traverse).toHaveBeenCalledTimes(2);
  });

  it('keeps the stored box for a frame whose measuring throws, logs once, and recovers next frame (fails if a transient throw unregisters the recompute)', () => {
    const g = group(sceneEl);
    boxMesh(entity(g), [0, 0, 0], [1, 1, 1]);
    inspector.selectedEntity = g;
    frame();

    const flaky = entity(g, { position: [0, 0, 5] });
    const mesh = boxMesh(flaky, [0, 0, 0], [1, 1, 1]);
    // An object-level box that is recomputed on demand, as skinned and
    // instanced meshes have; this one fails on its first computation.
    let fail = true;
    mesh.boundingBox = null;
    mesh.computeBoundingBox = () => {
      if (fail) {
        fail = false;
        throw new Error('mid-load');
      }
      mesh.boundingBox = mesh.geometry.boundingBox.clone();
    };
    mesh.geometry.computeBoundingBox();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    frame(() => expectBox(getGroupBounds(g), [0, 0, 0], [1, 1, 1]));
    expect(error).toHaveBeenCalledTimes(1);
    frame(() => expectBox(getGroupBounds(g), [0, 0, 0], [1, 1, 6]));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('keeps one box for a group whose member moves every frame (fails if each change makes a new box)', () => {
    const g = group(sceneEl);
    const member = entity(g);
    boxMesh(member, [0, 0, 0], [1, 1, 1]);
    inspector.selectedEntity = g;
    frame();
    const box = getGroupBounds(g);
    const clone = vi.spyOn(THREE.Box3.prototype, 'clone');
    for (let x = 1; x <= 5; x++) {
      member.object3D.position.x = x;
      frame();
    }
    expect(clone).not.toHaveBeenCalled();
    expect(getGroupBounds(g)).toBe(box);
    expectBox(box, [5, 0, 0], [6, 1, 1]);
    expect(emitted).toHaveLength(6);
  });

  it('asks a splat that has not loaded for its box every frame into the same box, making none (fails if each frame allocates one)', () => {
    const g = group(sceneEl);
    const splatEl = entity(g);
    const getBoundingBox = vi.fn(() => null);
    splatEl.components.splat = { getBoundingBox };
    inspector.selectedEntity = g;
    for (let i = 0; i < 3; i++) frame();
    expect(getBoundingBox).toHaveBeenCalledTimes(3);
    const targets = new Set(getBoundingBox.mock.calls.map(([, t]) => t));
    expect(targets.size).toBe(1);
  });

  it('measures a splat member once while it is unchanged, and again after it loads (fails with an uncached splat walk)', () => {
    const g = group(sceneEl);
    const splatEl = entity(g, { position: [2, 0, 0] });
    const getBoundingBox = vi.fn((centersOnly, target) =>
      target.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 1, 1))
    );
    splatEl.components.splat = { getBoundingBox };
    inspector.selectedEntity = g;
    for (let i = 0; i < 5; i++) frame();
    expect(getBoundingBox).toHaveBeenCalledTimes(1);
    expectBox(getGroupBounds(g), [2, 0, 0], [5, 1, 1]);

    getBoundingBox.mockImplementation((centersOnly, target) =>
      target.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(6, 1, 1))
    );
    // Emitted by the splat component with A-Frame's default bubbling.
    splatEl.dispatchEvent(new Event('splat-loaded', { bubbles: true }));
    frame(() => expectBox(getGroupBounds(g), [2, 0, 0], [8, 1, 1]));
    expect(getBoundingBox).toHaveBeenCalledTimes(2);
  });
});
