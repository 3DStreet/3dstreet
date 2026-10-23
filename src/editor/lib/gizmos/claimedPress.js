/**
 * ClaimedPress — owns a press on a canvas control from the window's capture
 * phase, the way the easy gizmo owns presses on its handles
 * (EasyGizmoControls.js, docs/easy-gizmo.md#pointer-ownership), for a control
 * that cannot listen for itself.
 *
 * What it carries over from the easy gizmo, each piece for the reason given
 * there (the method names are this file's; the easy gizmo's counterparts
 * carry a leading underscore, except where named):
 * - Window capture listeners, armed only while the owner is attached
 *   (arm/disarm; the easy gizmo's _addListeners/_removeListeners): the
 *   A-Frame cursor listens on the canvas, where stopPropagation() cannot
 *   reach a listener already registered, so only an ancestor's capture
 *   listener runs first.
 * - The claim: a primary left press on the canvas, with the editor open, that
 *   `hitTest` accepts, is cancelled and stopped. A cancelled pointerdown sends
 *   no compatibility mousedown or mouseup; the press's mousedown and
 *   touchstart are suppressed anyway (onSuppressClaimed), and so is the
 *   trailing canvas click (onSuppressLatched), which would otherwise select
 *   whatever lies under the control. The double-click is not suppressed.
 * - The busy guard: while a press is held or dragging, every other
 *   pointerdown is suppressed and ignored, so a second touch reaches nothing.
 * - Click or drag (pressClassifier.js): the press does nothing until the
 *   pointer has been 2 px from where it went down, on a move or on the
 *   release sample. A still release is a click, reported with the click count
 *   of the click event that trails it (pointer events carry none), or at once
 *   for touch, which has no trailing click (reportClick).
 * - Cancels: Escape (its keyup is stopped), window blur and the owned
 *   pointercancel. Every key the editor's keymap would take is suppressed
 *   while a press is held (suppressKey).
 * - Lost pointer capture does not cancel: Chrome drops capture mid-drag on
 *   macOS trackpads. It is re-acquired on the next move with a button down
 *   (onLostCapture, reacquireCapture). A drag that leaves the canvas while it
 *   still holds capture ends as a release (onCanvasLeave).
 * - Pointer capture is set when a press becomes a drag and released when the
 *   drag ends, released before the owner hears of the end, so an Escape with
 *   the button still down frees the canvas at once.
 *
 * What it leaves out: the easy gizmo's frame-deferred release, its inert
 * controls and its test for other editing affordances under the press. The
 * easy gizmo still runs its own copy of this protocol, interwoven with its
 * drag state; this unit is the one to move it onto.
 *
 * The owner supplies:
 * - `canvas`: the element presses must target;
 * - `hitTest(event)`: a token for a press this control takes, else null;
 * - `isEditorOpen()`;
 * - `onPress(press)`: a press was claimed (`press` holds `token`, `clientX`,
 *   `clientY`, `pointerId`, `pointerType`);
 * - `onPressEnd(press)`: a held press ended without becoming a drag (a click,
 *   or a cancel);
 * - `onPromote(press, event)`: the press became a drag at `event`;
 * - `onMove(event)`: the drag moved;
 * - `onRelease(event, reason)`: the drag ended, to be kept (`'pointerup'`,
 *   `'mouseleave'`);
 * - `onClick(press, detail)`: a still press, with its click count;
 * - `onCancel(reason, dragging)`: the press or drag was cancelled;
 * - `onIdleHover(event)`: a pointer move with no press held.
 */

import { shouldCaptureKeyEvent } from '../keyCapture.js';
import { PressClassifier } from './pressClassifier.js';

const noop = () => {};

export class ClaimedPress {
  constructor({
    canvas,
    hitTest,
    isEditorOpen,
    onPress = noop,
    onPressEnd = noop,
    onPromote = noop,
    onMove = noop,
    onRelease = noop,
    onClick = noop,
    onCancel = noop,
    onIdleHover = noop
  }) {
    this.canvas = canvas;
    this.hitTest = hitTest;
    this.isEditorOpen = isEditorOpen;
    this.callbacks = {
      onPress,
      onPressEnd,
      onPromote,
      onMove,
      onRelease,
      onClick,
      onCancel,
      onIdleHover
    };
    this.armed = false;
    // A claimed press not yet known to be a click or a drag.
    this.pending = null;
    this.dragging = false;
    this.pointerId = null;
    this.captureLost = false;
    // Set by a claimed press, cleared by the next pointerdown: the trailing
    // click and the press's mouse and touch families are suppressed.
    this.pressWasClaimed = false;
    this.pendingClick = null;
    this.pendingClickTimer = null;

    for (const name of [
      'onPointerDown',
      'onPointerMove',
      'onPointerUp',
      'onPointerCancel',
      'onLostCapture',
      'onSuppressClaimed',
      'onSuppressLatched',
      'onKeyDown',
      'onKeyUp',
      'onBlur',
      'onCanvasLeave'
    ]) {
      this[name] = this[name].bind(this);
    }
  }

  /** A press is held or dragging. */
  get busy() {
    return !!this.pending || this.dragging;
  }

  arm() {
    if (this.armed) return;
    this.armed = true;
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerCancel, true);
    window.addEventListener('lostpointercapture', this.onLostCapture, true);
    window.addEventListener('mousedown', this.onSuppressClaimed, true);
    // The options form is required: a window touch listener is passive by
    // default, where preventDefault() does nothing.
    window.addEventListener('touchstart', this.onSuppressClaimed, {
      capture: true,
      passive: false
    });
    window.addEventListener('click', this.onSuppressLatched, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    this.canvas?.addEventListener('mouseleave', this.onCanvasLeave);
  }

  /** Takes the listeners down; cancel() first to end a live press. */
  disarm() {
    if (!this.armed) return;
    this.armed = false;
    this.dropPendingClick();
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerCancel, true);
    window.removeEventListener('lostpointercapture', this.onLostCapture, true);
    window.removeEventListener('mousedown', this.onSuppressClaimed, true);
    window.removeEventListener('touchstart', this.onSuppressClaimed, true);
    window.removeEventListener('click', this.onSuppressLatched, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.canvas?.removeEventListener('mouseleave', this.onCanvasLeave);
  }

  dispose() {
    this.cancel('dispose');
    this.disarm();
  }

  /** End a held press or a drag with nothing kept. */
  cancel(reason) {
    if (this.pending) {
      const press = this.pending;
      this.pending = null;
      this.pointerId = null;
      this.callbacks.onPressEnd(press);
      this.callbacks.onCancel(reason, false);
      return;
    }
    if (!this.dragging) return;
    this.endDrag();
    this.callbacks.onCancel(reason, true);
  }

  suppress(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  ownsPointer(event) {
    return (event.pointerId ?? null) === this.pointerId;
  }

  onPointerDown(event) {
    if (this.busy) {
      this.suppress(event);
      return;
    }
    // Cleared ahead of every return below, so the trailing-click latch never
    // outlives the press it was set for.
    this.pressWasClaimed = false;
    if (!this.isEditorOpen()) return;
    if (event.button !== 0 || event.isPrimary === false) return;
    if (!this.canvas || event.target !== this.canvas) return;
    const token = this.hitTest(event);
    if (token === null || token === undefined) return;
    this.suppress(event);
    this.pressWasClaimed = true;
    this.pending = {
      token,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      classifier: new PressClassifier(event.clientX, event.clientY)
    };
    this.pointerId = event.pointerId ?? null;
    this.callbacks.onPress(this.pending);
  }

  /** The press and touch families of a claimed press (see the header). */
  onSuppressClaimed(event) {
    if (!this.pressWasClaimed) return;
    this.suppress(event);
  }

  /**
   * Every click first completes a held click waiting for its count; then the
   * click that trails a claimed press is kept off the canvas.
   */
  onSuppressLatched(event) {
    this.flushPendingClick(event.detail || 1);
    if (!this.pressWasClaimed) return;
    if (event.target !== this.canvas) return;
    this.suppress(event);
  }

  onPointerMove(event) {
    if (this.pending) {
      if (!this.ownsPointer(event)) return;
      this.suppress(event);
      if (this.pending.classifier.track(event)) this.promote(event);
      return;
    }
    if (this.dragging) {
      if (!this.ownsPointer(event)) return;
      this.suppress(event);
      this.reacquireCapture(event);
      this.callbacks.onMove(event);
      return;
    }
    this.callbacks.onIdleHover(event);
  }

  onPointerUp(event) {
    if (this.pending && this.ownsPointer(event)) {
      const press = this.pending;
      this.suppress(event);
      if (!press.classifier.track(event)) {
        // Still within the click distance: a click, and nothing else happens.
        this.pending = null;
        this.pointerId = null;
        this.callbacks.onPressEnd(press);
        this.reportClick(press);
        return;
      }
      // Released after moving away with no pointermove between: a drag that
      // ends here.
      this.promote(event);
    }
    if (!this.dragging || !this.ownsPointer(event)) return;
    this.suppress(event);
    this.endDrag();
    this.callbacks.onRelease(event, 'pointerup');
  }

  promote(event) {
    const press = this.pending;
    this.pending = null;
    this.dragging = true;
    this.captureLost = false;
    if (this.canvas?.setPointerCapture && press.pointerId !== undefined) {
      try {
        this.canvas.setPointerCapture(press.pointerId);
      } catch {
        // The window listeners still follow only the pointer that pressed.
      }
    }
    this.callbacks.onPromote(press, event);
  }

  /** Leave the drag state, freeing the canvas before the owner hears of it. */
  endDrag() {
    this.dragging = false;
    if (this.pointerId !== null && this.canvas?.releasePointerCapture) {
      try {
        this.canvas.releasePointerCapture(this.pointerId);
      } catch {
        // Releasing a capture for a pointer that is already gone throws.
      }
    }
    this.pointerId = null;
    this.captureLost = false;
  }

  /**
   * A mouse's click count arrives only on the click event that trails the
   * release, so a mouse click is reported from that event, or as a single
   * click once the release's task is over if none follows. A touch press has
   * no count and no trailing click: it is reported at once.
   */
  reportClick(press) {
    if (press.pointerType === 'touch') {
      this.callbacks.onClick(press, 1);
      return;
    }
    this.flushPendingClick(1);
    this.pendingClick = press;
    this.pendingClickTimer = setTimeout(() => this.flushPendingClick(1), 0);
  }

  flushPendingClick(detail) {
    const press = this.pendingClick;
    if (!press) return;
    this.dropPendingClick();
    this.callbacks.onClick(press, detail);
  }

  dropPendingClick() {
    this.pendingClick = null;
    clearTimeout(this.pendingClickTimer);
    this.pendingClickTimer = null;
  }

  onPointerCancel(event) {
    if (!this.busy || !this.ownsPointer(event)) return;
    this.cancel('pointercancel');
  }

  onLostCapture(event) {
    if (this.dragging && this.ownsPointer(event)) this.captureLost = true;
  }

  reacquireCapture(event) {
    if (!this.captureLost || !event.buttons) return;
    if (!this.canvas?.setPointerCapture || event.pointerId === undefined) {
      return;
    }
    try {
      this.canvas.setPointerCapture(event.pointerId);
      this.captureLost = false;
    } catch {
      // The window listeners keep following the pointer regardless.
    }
  }

  onBlur() {
    this.cancel('blur');
  }

  onCanvasLeave(event) {
    if (!this.dragging || this.captureLost) return;
    this.endDrag();
    this.callbacks.onRelease(event, 'mouseleave');
  }

  suppressKey(event) {
    if (!this.busy) return false;
    if (!shouldCaptureKeyEvent(event)) return false;
    this.suppress(event);
    return true;
  }

  onKeyDown(event) {
    this.suppressKey(event);
  }

  onKeyUp(event) {
    if (!this.suppressKey(event)) return;
    if (event.key === 'Escape' || event.keyCode === 27) this.cancel('escape');
  }
}
