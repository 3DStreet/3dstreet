/* global AFRAME */

// The on-canvas controls the shape editor draws — measurement chips, the insert
// button, the delete button — are DOM elements in the CSS2D layer, and each has
// to be `pointer-events: auto` to be hovered or pressed at all. Taking the
// pointer also takes the WHEEL, and the camera's zoom handlers are bound on the
// canvas, which is not one of their ancestors: the CSS2D container is a sibling
// of it under document.body. So a wheel over any of these controls reaches no
// zoom handler and scroll-zoom silently stops working wherever one is drawn.
//
// That matters more the more of the viewport they cover, and resting the pointer
// on a measurement is the shape editor's primary gesture.
//
// ONE module-scope function shared by every such element rather than a closure
// per element: there is then nothing per-element to release, so detaching the
// element is the whole of its cleanup.
export function forwardWheelToCanvas(event) {
  const canvas = AFRAME.scenes[0]?.canvas;
  if (!canvas) return;
  event.preventDefault();
  // Dispatched at the canvas rather than re-dispatched at `document`: the clone
  // inherits `bubbles: true`, so a listener bound higher would see its own event
  // come back round. Consumers read dictionary members only (deltaY, deltaMode,
  // clientX/Y, ctrlKey), all of which the WheelEvent constructor copies —
  // `cancelable` included, so a consumer's own preventDefault() is sound.
  canvas.dispatchEvent(new WheelEvent('wheel', event));
}
