/* global THREE */
// A group's bounds, pivot and stored center.
//
// A group has no geometry of its own: its bounds are what its members span, in
// the group's own local axes, so a rotated group has a rotated box rather than a
// larger world-aligned one, and the automatic center (the box midpoint) does not
// wander as the group turns. The group's origin is not part of the bounds.
//
// FRESHNESS. Bounds are recomputed, not invalidated by events: a member can move
// or gain a mesh through paths that emit nothing the editor hears. So the groups
// something is drawn for (the selected user group, and the innermost open scope)
// are re-measured in every editor frame window, after three's own matrix update,
// and `groupboundschanged` is emitted when a box changes. Every other read
// returns the stored box; a group with none is measured on demand.

import Events from '../Events';
import { isUserGroup } from './groupModel.js';

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      toLocal: new THREE.Matrix4(),
      nodeToLocal: new THREE.Matrix4(),
      part: new THREE.Box3(),
      measured: new THREE.Box3(),
      splat: new THREE.Box3()
    };
  }
  return scratch;
}

// ---------------------------------------------------------------- measuring

// State for the traversal callback, which is defined once so a measurement
// allocates no closure.
let measureRoot = null;
let measureOut = null;
let measureFound = false;
let measureSplatFrame;
let measureRefreshSplats = false;

// Loaded splats' boxes, in the splat entity's local frame. Walking every splat
// is expensive, so a splat is measured when it has no entry: after it loads
// (its `splat-loaded` clears the entry) and when a group containing it starts
// being drawn.
const splatBoxes = new WeakMap();

function addBox(box, matrixWorld) {
  const t = tmp();
  t.nodeToLocal.multiplyMatrices(t.toLocal, matrixWorld);
  t.part.copy(box).applyMatrix4(t.nodeToLocal);
  measureOut.union(t.part);
  measureFound = true;
}

function splatBox(el, splat) {
  let entry = splatBoxes.get(el);
  if (measureRefreshSplats && entry && entry.frame !== measureSplatFrame) {
    entry = undefined;
  }
  if (!entry) {
    // Null until the splat has loaded, which can be many frames: nothing is
    // allocated until there is a box to keep.
    const box = splat.getBoundingBox?.(true, tmp().splat);
    if (!box || box.isEmpty()) return null;
    entry = { box: box.clone(), frame: measureSplatFrame };
    splatBoxes.set(el, entry);
  }
  return entry.box;
}

function visitMember(node) {
  if (node === measureRoot) return;
  const el = node.el;
  if (el && el.object3D === node) {
    const splat = el.components?.splat;
    if (splat) {
      const box = splatBox(el, splat);
      if (box) addBox(box, node.matrixWorld);
    }
  }
  // Batched models have had their meshes stripped, and a model still loading
  // has none yet; both leave an entity-local box on the object3D instead.
  const cached = node._batchLocalBbox || node._placeholderBbox;
  if (cached && !cached.isEmpty()) addBox(cached, node.matrixWorld);

  if (!node.isMesh || !node.geometry) return;
  // Prefer the object's own box where it has one: skinned, instanced and
  // batched meshes describe their posed result there, while the geometry box
  // is the rest pose (easyGizmoMath's deriveLocalBoxOf documents the trap).
  let source;
  if (node.boundingBox !== undefined) {
    if (node.boundingBox === null) node.computeBoundingBox();
    source = node.boundingBox;
  } else {
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    source = node.geometry.boundingBox;
  }
  if (source && !source.isEmpty()) addBox(source, node.matrixWorld);
}

/**
 * Measure the members of `groupEl` in the group's local axes into `outBox`.
 * Returns `outBox`, or null when no member has geometry.
 *
 * Reads every matrixWorld as it stands; the caller makes them current. Each
 * mesh's box is carried into the group frame individually, so nothing is
 * parked or re-posed and no descendant matrix is left altered. Members hidden
 * by their own or an ancestor's visibility are left out.
 */
export function memberBoundsLocal(groupEl, outBox, { refreshSplats } = {}) {
  outBox.makeEmpty();
  const group = groupEl?.object3D;
  if (!group) return null;
  const t = tmp();
  if (Math.abs(group.matrixWorld.determinant()) < 1e-12) return null;
  t.toLocal.copy(group.matrixWorld).invert();

  measureRoot = group;
  measureOut = outBox;
  measureFound = false;
  measureSplatFrame = groupEl.sceneEl?.time;
  measureRefreshSplats = !!refreshSplats;
  try {
    group.traverseVisible(visitMember);
  } finally {
    measureRoot = null;
    measureOut = null;
  }
  return measureFound && !outBox.isEmpty() ? outBox : null;
}

// ---------------------------------------------------------------- the store

// groupEl -> { box: THREE.Box3 | null }. A stored null means "measured, no
// geometry", which is different from having no entry.
const stored = new Map();
const held = new Set();

/**
 * The stored bounds of a group (group-local), measuring them now only if the
 * group has no entry. Null when the group has no member geometry. The returned
 * box is shared: read it, never modify it.
 */
export function getGroupBounds(groupEl) {
  const entry = stored.get(groupEl);
  if (entry) return entry.box;
  if (!groupEl?.object3D) return null;
  groupEl.object3D.updateWorldMatrix(true, true);
  const box = memberBoundsLocal(groupEl, tmp().measured);
  const copy = box ? box.clone() : null;
  stored.set(groupEl, { box: copy });
  return copy;
}

/**
 * Keep a group's stored bounds as they are until released: a transform gesture
 * on the group holds its box (and so its pivot) for the whole gesture.
 */
export function holdGroupBounds(groupEl) {
  held.add(groupEl);
}

export function releaseGroupBounds(groupEl) {
  held.delete(groupEl);
}

/**
 * A center the user stored on the group (the `group-center` component, in the
 * group's local frame), or null when none is set.
 */
export function readStoredCenter(groupEl, out) {
  const data = groupEl?.components?.['group-center']?.data;
  if (!data?.pinned || !data.pin) return null;
  return out.set(data.pin.x, data.pin.y, data.pin.z);
}

/**
 * The point a group rotates about and its handles sit at, in the group's local
 * frame: a stored center, else the middle of the member bounds, else the
 * origin (an empty group, where its marker is).
 */
export function getGroupPivot(groupEl, out) {
  if (readStoredCenter(groupEl, out)) return out;
  const box = getGroupBounds(groupEl);
  return box ? box.getCenter(out) : out.set(0, 0, 0);
}

/**
 * What camera focus frames for a group, in world space: its center, and the
 * radius about that center that takes in every corner of its member box
 * (null for a group with no member geometry, framed from a fixed standoff).
 */
export function groupFocusFrame(groupEl) {
  const matrixWorld = groupEl.object3D.matrixWorld;
  groupEl.object3D.updateWorldMatrix(true, false);
  const center = getGroupPivot(groupEl, new THREE.Vector3()).applyMatrix4(
    matrixWorld
  );
  const box = getGroupBounds(groupEl);
  if (!box) return { center, radius: null };
  const corner = new THREE.Vector3();
  let radius = 0;
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
      .applyMatrix4(matrixWorld);
    radius = Math.max(radius, corner.distanceTo(center));
  }
  return { center, radius };
}

// ---------------------------------------------------------------- live recompute

const live = [];
let previouslyLive = new Set();
let nextLive = new Set();
const changed = [];
const failing = new WeakSet();

function collectLiveGroups() {
  live.length = 0;
  const inspector = globalThis.AFRAME?.INSPECTOR;
  const selected = inspector?.selectedEntity;
  if (isUserGroup(selected) && selected.isConnected) live.push(selected);
  // Only the innermost open scope is drawn; outer scopes' bounds are unused.
  const stack = inspector?.groupScope?.openStack;
  if (stack?.length) {
    const innermost = document.getElementById(stack[stack.length - 1]);
    if (
      innermost !== selected &&
      isUserGroup(innermost) &&
      innermost.isConnected
    ) {
      live.push(innermost);
    }
  }
}

function sameBounds(a, b) {
  if (!a || !b) return a === b;
  return a.equals(b);
}

function recomputeLiveBounds() {
  collectLiveGroups();
  changed.length = 0;
  nextLive.clear();
  for (let i = 0; i < live.length; i++) {
    const groupEl = live[i];
    nextLive.add(groupEl);
    if (held.has(groupEl)) continue;
    try {
      const box = memberBoundsLocal(groupEl, tmp().measured, {
        refreshSplats: !previouslyLive.has(groupEl)
      });
      const entry = stored.get(groupEl);
      if (!entry) {
        stored.set(groupEl, { box: box ? box.clone() : null });
        changed.push(groupEl);
      } else if (!sameBounds(entry.box, box)) {
        // In place while it changes every frame (a member being dragged):
        // readers copy the box or read it at once, never keep it.
        if (entry.box && box) entry.box.copy(box);
        else entry.box = box ? box.clone() : null;
        changed.push(groupEl);
      }
      failing.delete(groupEl);
    } catch (error) {
      // Keep the stored box for this frame and measure again next frame.
      if (!failing.has(groupEl)) {
        failing.add(groupEl);
        console.error(
          '[groups] measuring group bounds failed for',
          groupEl.id,
          error
        );
      }
    }
  }
  for (const groupEl of stored.keys()) {
    if (!nextLive.has(groupEl) && !held.has(groupEl)) stored.delete(groupEl);
  }
  const swap = previouslyLive;
  previouslyLive = nextLive;
  nextLive = swap;

  for (let i = 0; i < changed.length; i++) {
    const groupEl = changed[i];
    try {
      Events.emit('groupboundschanged', groupEl);
    } catch (error) {
      console.error('[groups] a groupboundschanged listener threw', error);
    }
  }
}

/**
 * Keep the drawn groups' bounds current: registers the per-frame recompute in
 * the editor frame window and clears a splat's cached box when it (re)loads.
 */
export function trackLiveGroupBounds(editorFrame, sceneEl) {
  sceneEl.addEventListener('splat-loaded', (event) => {
    splatBoxes.delete(event.target);
  });
  // Measuring catches per group, so only a defect in the pass itself reaches
  // the frame; tolerate a few frames of that before giving up.
  return editorFrame.register(recomputeLiveBounds, {
    order: 20,
    maxConsecutiveThrows: 5
  });
}
