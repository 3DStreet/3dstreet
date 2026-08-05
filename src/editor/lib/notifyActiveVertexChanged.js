import Events from './Events';

// "The sub-selected shape vertex changed" — no payload, deliberately. Whoever
// handles this reads the current sub-selection from its single owner, which is
// what makes deferring the notification SAFE rather than merely tolerable: a
// late consumer reads the truth rather than a snapshot taken at emit time.
//
// DEFERRED OUT OF THE FRAME TRAVERSAL, and that is the whole reason this is not
// a bare Events.emit at the call site. The sub-selection is cleared from the
// controls layer's per-frame hook on two paths (the child-count compare and the
// matrixWorld compare), and that hook runs from inside scene.updateMatrixWorld.
// A synchronous notification there re-enters the readout renderer's clear(),
// which removes CSS2DObjects from and disposes tube geometry under the shape
// entity's object3D — while a traversal of that same scene is in flight.
//
// It is its own module, rather than a method on the controls class, so that it
// can be imported by a test: that class imports the store through a path alias
// the test runner does not resolve, so nothing defined in it is reachable from
// a unit test. This is the one piece of the design that has to be.
let queued = false;

export function notifyActiveVertexChanged() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    Events.emit('shapevertexactivechanged');
  });
}
