/**
 * Click or drag: tells the two apart for a press on a control that does
 * something different for each.
 *
 * A press is a drag once the pointer has been DRAG_THRESHOLD_PX or more from
 * where it went down at any moment of the gesture, and a click otherwise. The
 * furthest point counts, not where the pointer was released, so moving out
 * and back to the press point is still a drag. Every sample the browser
 * reports counts too, including the ones it coalesces into a single
 * pointermove, so a flick faster than the event rate is not missed.
 *
 * There is no time limit: a long, still press is a click. The threshold is
 * the same for mouse, pen and touch, because a wider touch allowance would
 * make small drags impossible.
 */

export const DRAG_THRESHOLD_PX = 2;

export class PressClassifier {
  /** Start classifying a press made at client coordinates (x, y). */
  constructor(clientX, clientY) {
    this.x = clientX;
    this.y = clientY;
    this.maxDistance = 0;
  }

  /** Take a pointer event of the gesture; true once the press is a drag. */
  track(event) {
    const samples = event.getCoalescedEvents?.() || [];
    for (let i = 0; i < samples.length; i++) this._sample(samples[i]);
    this._sample(event);
    return this.isDrag();
  }

  isDrag() {
    return this.maxDistance >= DRAG_THRESHOLD_PX;
  }

  _sample(point) {
    const distance = Math.hypot(point.clientX - this.x, point.clientY - this.y);
    if (distance > this.maxDistance) this.maxDistance = distance;
  }
}
