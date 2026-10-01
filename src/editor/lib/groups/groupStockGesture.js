/* global THREE */
// A user group's handles in the Advanced move and rotate modes: a stock
// transform control of its own, standing at the group's center, driven by a
// claimed press.
//
// The stock control draws and measures its handles at the origin of the
// object it is attached to, and a group's origin can be far from its members.
// So it is attached to an anchor instead: an object at the group's center that
// carries the group's world heading (not its pitch or roll, so local space
// follows the heading and the Y ring stays vertical). A drag moves or turns
// the anchor, and each change is mapped onto the group: a move by the same
// displacement, a turn by the same angle about world Y with the group's
// origin orbiting its center. Members are never written.
//
// The control is a second instance with no canvas listeners. Its press is
// owned by a ClaimedPress (gizmos/claimedPress.js), as the easy gizmo owns
// its own, and it is told of the press only once that is known to be a drag:
// a still click on a handle over the selected group's box opens the group,
// and never moves it. The gesture is committed once, as one undo step, on
// release; Escape, blur and a cancelled pointer put the group back exactly.
//
// This object speaks the easy gizmo's gesture events (handlePress,
// handlePressEnd, handleClick, mouseDown, objectChange, mouseUp, commitDrag,
// axisHoverChange), so the viewport wires both the same way.
//
// Scratch values are created on first use rather than at module evaluation,
// so importing this module never needs THREE to be present yet.

import { ClaimedPress } from '../gizmos/claimedPress.js';
import { formatGesturePose, quantise } from '../gizmos/easyGizmoMath.js';
import {
  POSITION_DECIMALS,
  YAW_DECIMALS
} from '../gizmos/easyGizmoConstants.js';
import { getGroupCenter } from './groupBounds.js';
import { positionForRotationAboutCenter } from './groupTransformMath.js';

// A-Frame's own conversions, so degrees written here read back unchanged.
const degToRad = (degrees) => THREE.MathUtils.degToRad(degrees);
const radToDeg = (radians) => THREE.MathUtils.radToDeg(radians);

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      center: new THREE.Vector3(),
      position: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      delta: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      qStart: new THREE.Quaternion(),
      qNow: new THREE.Quaternion(),
      up: new THREE.Vector3(0, 1, 0)
    };
  }
  return scratch;
}

function noRaycast() {}

/**
 * Build the gesture for `controls`, a TransformControls constructed with no
 * DOM element. `canvas` is the element presses target; `sceneHelpers` holds
 * the control's drawing while it is attached.
 */
export function createGroupStockGesture(options) {
  return new GroupStockGesture(options);
}

class GroupStockGesture {
  constructor({ controls, canvas, sceneHelpers, isEditorOpen }) {
    this.controls = controls;
    this.canvas = canvas;
    this.sceneHelpers = sceneHelpers;
    this.isEditorOpen = isEditorOpen;
    this.events = new THREE.EventDispatcher();
    this.el = undefined;
    this.object = undefined;
    this.axis = null;
    // The control's handle under the pointer, as last announced.
    this.hoveredAxis = null;
    // Set from a drag's first promotion until its end: the anchor then keeps
    // the pose the control gives it.
    this.drag = null;
    this.handleAnchor = null;
    this.anchorParent = null;
    this.posStart = new THREE.Vector3();
    this.centerInParent = new THREE.Vector3();
    this.originWorldStart = new THREE.Vector3();
    this.anchorStartPosition = new THREE.Vector3();
    this.anchorStartQuaternion = new THREE.Quaternion();
    this.parentInverse = new THREE.Matrix4();

    this.onObjectChange = () => this.followAnchor();
    controls.addEventListener('objectChange', this.onObjectChange);

    this.press = new ClaimedPress({
      canvas,
      isEditorOpen: () => this.isEditorOpen(),
      hitTest: (event) => this.hitTest(event),
      onPress: (press) => this.onPress(press),
      onPressEnd: (press) => this.onPressEnd(press),
      onPromote: (press, event) => this.onPromote(press, event),
      onMove: (event) => this.track(event),
      onRelease: (event) => this.onRelease(event),
      onClick: (press, detail) =>
        this.dispatchEvent({
          type: 'handleClick',
          clientX: press.clientX,
          clientY: press.clientY,
          detail
        }),
      onCancel: (reason, dragging) => {
        if (dragging) this.onCancelDrag();
      },
      onIdleHover: (event) => this.onIdleHover(event)
    });
  }

  addEventListener(type, listener) {
    this.events.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    this.events.removeEventListener(type, listener);
  }

  dispatchEvent(event) {
    this.events.dispatchEvent(event);
  }

  /** Show the handles for `mode` ('translate' or 'rotate') on `groupEl`. */
  attach(groupEl, mode) {
    this.detach();
    this.ensureAnchor();
    this.el = groupEl;
    this.object = groupEl.object3D;
    this.axis = mode === 'rotate' ? 'rotate' : 'move';
    const controls = this.controls;
    controls.setMode(mode);
    // A group only yaws, so its rotate handles are the Y ring alone.
    controls.showX = mode !== 'rotate';
    controls.showY = true;
    controls.showZ = mode !== 'rotate';
    // Drawn (and laid out every render) only while attached.
    this.sceneHelpers.add(this.anchorParent);
    this.sceneHelpers.add(controls.getHelper());
    controls.attach(this.handleAnchor);
    this.press.arm();
    return this;
  }

  /** Idempotent: the viewport detaches every control on every selection. */
  detach() {
    if (!this.el) return this;
    this.press.cancel('detach');
    this.press.disarm();
    this.controls.detach();
    this.sceneHelpers.remove(this.controls.getHelper());
    this.sceneHelpers.remove(this.anchorParent);
    this.el = undefined;
    this.object = undefined;
    this.axis = null;
    // After el is cleared, so the viewport takes this as the handles going,
    // not the cursor leaving one, and redraws no hover.
    this.hoveredAxis = null;
    this.dispatchEvent({ type: 'axisHoverChange', axis: null });
    return this;
  }

  /** End a live press or drag with nothing kept (the editor closing). */
  cancel(reason) {
    this.press.cancel(reason);
  }

  dispose() {
    this.detach();
    this.controls.removeEventListener('objectChange', this.onObjectChange);
    this.press.dispose();
  }

  ensureAnchor() {
    if (this.handleAnchor) return;
    this.anchorParent = new THREE.Group();
    this.anchorParent.name = 'group-stock-gesture-anchor';
    const anchor = new THREE.Object3D();
    anchor.raycast = noRaycast;
    const self = this;
    const updateMatrixWorld = anchor.updateMatrixWorld;
    // Re-derived on every layout of the stock control (it lays its attached
    // object out first, at render and when a press is promoted), so the
    // handles stand at the group's current center and a drag starts from the
    // current pose. Not a frame-window step: the control's own hover and
    // press tests can run between frames.
    anchor.updateMatrixWorld = function (force) {
      if (!self.drag && self.object) self.placeAnchor();
      return updateMatrixWorld.call(this, force);
    };
    this.anchorParent.add(anchor);
    this.handleAnchor = anchor;
  }

  /** The anchor at the group's center, turned to its world heading. */
  placeAnchor() {
    const t = tmp();
    const object = this.object;
    object.updateWorldMatrix(true, false);
    getGroupCenter(this.el, t.center).applyMatrix4(object.matrixWorld);
    this.handleAnchor.position.copy(t.center);
    object.matrixWorld.decompose(t.position, t.quaternion, t.scale);
    const heading = t.euler.setFromQuaternion(t.quaternion, 'YXZ').y;
    this.handleAnchor.quaternion.setFromAxisAngle(t.up, heading);
  }

  /** The control's normalised pointer for a client point. */
  pointerAt(event, button) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      button
    };
  }

  /** Which handle a press at `event` lands on, or null (not this control's). */
  hitTest(event) {
    if (!this.el || this.controls.object === undefined) return null;
    const pointer = this.pointerAt(event, 0);
    if (!pointer) return null;
    this.controls.pointerHover(pointer);
    const axis = this.controls.axis;
    return axis ? { axis, pointer } : null;
  }

  announceHover(axis) {
    if (axis === this.hoveredAxis) return;
    this.hoveredAxis = axis;
    this.dispatchEvent({ type: 'axisHoverChange', axis });
  }

  /** The stock control's own hover rule: mouse and pen, over the canvas. */
  onIdleHover(event) {
    if (!this.el || !this.isEditorOpen()) return;
    const type = event.pointerType || 'mouse';
    if (type !== 'mouse' && type !== 'pen') return;
    if (event.target !== this.canvas) {
      this.controls.axis = null;
      this.announceHover(null);
      return;
    }
    const pointer = this.pointerAt(event, event.button);
    if (!pointer) return;
    this.controls.pointerHover(pointer);
    this.announceHover(this.controls.axis);
  }

  onPress(press) {
    this.announceHover(press.token.axis);
    this.dispatchEvent({
      type: 'handlePress',
      clientX: press.clientX,
      clientY: press.clientY,
      pointerType: press.pointerType
    });
  }

  /** A press that did not become a drag (a click, or a cancel). */
  onPressEnd(press) {
    if (press.pointerType !== 'mouse') {
      this.controls.axis = null;
      this.announceHover(null);
    }
    this.dispatchEvent({ type: 'handlePressEnd' });
  }

  onPromote(press, event) {
    this.dispatchEvent({ type: 'handlePressEnd' });
    const el = this.el;
    const object = this.object;
    if (!el || !el.isConnected) return;
    const controls = this.controls;

    // The group as the gesture finds it: what a cancel puts back, what the
    // commit compares against, and the frames the mapping works in.
    object.updateWorldMatrix(true, false);
    object.updateMatrix();
    this.posStart.copy(object.position);
    this.originWorldStart.setFromMatrixPosition(object.matrixWorld);
    this.parentInverse.copy(object.parent.matrixWorld).invert();
    getGroupCenter(el, this.centerInParent).applyMatrix4(object.matrix);
    const rotation = object.rotation;
    const drag = {
      el,
      pointerType: press.pointerType,
      x0: rotation.x,
      y0: rotation.y,
      z0: rotation.z,
      y0Rounded: quantise(radToDeg(rotation.y), YAW_DECIMALS),
      before: formatGesturePose(el)
    };

    // Hover, then lay the control out for the pressed handle and the current
    // camera before it measures the press against its plane.
    controls.pointerHover(press.token.pointer);
    controls.getHelper().updateMatrixWorld(true);
    // pointerDown starts a drag even when the ray misses the control's plane,
    // keeping the last drag's start point; a start it did not write is a
    // miss, and this press then moves nothing.
    controls.pointStart.set(NaN, NaN, NaN);
    controls.pointerDown(press.token.pointer);
    if (!controls.dragging || Number.isNaN(controls.pointStart.x)) {
      if (controls.dragging) controls.pointerUp(null);
      // As at the end of a drag: a touch has lifted off the handle.
      if (press.pointerType !== 'mouse' && press.pointerType !== 'pen') {
        this.announceHover(null);
      }
      return;
    }
    // The pose the control measures its drag from, read back from it, so a
    // stale anchor cannot add its difference to the first move.
    this.anchorStartPosition.copy(controls.worldPositionStart);
    this.anchorStartQuaternion.copy(controls.worldQuaternionStart);
    this.drag = drag;
    this.dispatchEvent({ type: 'mouseDown' });
    this.track(event);
  }

  /** Feed the control a pointer sample of the drag. */
  track(event) {
    if (!this.drag) return;
    // Always -1: the control moves only for a button of -1, whatever the
    // event's own button (a release sample carries 0).
    const pointer = this.pointerAt(event, -1);
    if (pointer) this.controls.pointerMove(pointer);
  }

  /** The control moved or turned the anchor: move or turn the group as much. */
  followAnchor() {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.el.isConnected) {
      this.press.cancel('disconnected');
      return;
    }
    const object = this.object;
    const t = tmp();
    const q = (v) => quantise(v, POSITION_DECIMALS);
    if (this.axis === 'move') {
      t.position
        .copy(this.handleAnchor.position)
        .sub(this.anchorStartPosition)
        .add(this.originWorldStart)
        .applyMatrix4(this.parentInverse);
      object.position.set(q(t.position.x), q(t.position.y), q(t.position.z));
    } else {
      // The turn about world Y the control made, applied from the rounded
      // yaw the commit writes, so a turn released at its start angle writes
      // the start position exactly.
      t.delta
        .copy(this.handleAnchor.quaternion)
        .multiply(t.quaternion.copy(this.anchorStartQuaternion).invert());
      const turn = 2 * Math.atan2(t.delta.y, t.delta.w);
      const yaw = quantise(radToDeg(drag.y0) + radToDeg(turn), YAW_DECIMALS);
      // The Euler, not the quaternion: pitch and roll keep the snapshot's
      // own radians, so they read back as the same degrees.
      object.rotation.set(drag.x0, degToRad(yaw), drag.z0, 'YXZ');
      t.euler.set(drag.x0, degToRad(drag.y0Rounded), drag.z0, 'YXZ');
      t.qStart.setFromEuler(t.euler);
      t.euler.set(drag.x0, degToRad(yaw), drag.z0, 'YXZ');
      t.qNow.setFromEuler(t.euler);
      positionForRotationAboutCenter(
        this.posStart,
        t.qStart,
        t.qNow,
        this.centerInParent,
        t.position
      );
      object.position.set(q(t.position.x), q(t.position.y), q(t.position.z));
    }
    this.dispatchEvent({ type: 'objectChange' });
  }

  /**
   * The release point (a pointerup, or where the cursor left the canvas) is
   * the drag's last sample.
   */
  onRelease(event) {
    if (!this.drag) return;
    this.track(event);
    if (!this.drag) return; // the last sample found the group gone
    this.controls.pointerUp({ button: 0 });
    this.finish(true, event);
  }

  onCancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    if (drag.el.isConnected) {
      this.object.position.copy(this.posStart);
      this.object.rotation.set(drag.x0, drag.y0, drag.z0, 'YXZ');
      this.dispatchEvent({ type: 'objectChange' });
    }
    this.controls.pointerUp(null);
    this.finish(false, null);
  }

  /** The one way out of a drag, kept (`commit`) or not. */
  finish(commit, event) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.dispatchEvent({ type: 'mouseUp' });
    if (commit && drag.el.isConnected) {
      const after = formatGesturePose(drag.el);
      this.dispatchEvent({
        type: 'commitDrag',
        entity: drag.el,
        name: this.axis === 'rotate' ? 'rotate' : 'move',
        changes: [
          {
            component: 'position',
            value: after.position,
            oldValue: drag.before.position
          },
          {
            component: 'rotation',
            value: after.rotation,
            oldValue: drag.before.rotation
          }
        ]
      });
    }
    // After the commit, whose wiring holds the hover until the pointer moves.
    // A touch lifts off the handle; a mouse may still be on one.
    if (drag.pointerType !== 'mouse' && drag.pointerType !== 'pen') {
      this.announceHover(null);
      return;
    }
    if (!event || !this.el) return;
    const pointer = this.pointerAt(event, 0);
    if (!pointer) return;
    this.controls.pointerHover(pointer);
    this.announceHover(this.controls.axis);
  }
}
