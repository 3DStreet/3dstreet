import Events from './Events';

// "Which side has its insert button revealed changed" — no payload,
// deliberately. Whoever handles this reads the current reveal from its single
// owner, which is what makes deferring the notification SAFE rather than merely
// tolerable: a late consumer reads the truth rather than a snapshot taken at
// emit time.
//
// DEFERRED OUT OF THE FRAME TRAVERSAL, and that is the whole reason this is not
// a bare Events.emit at the call site. The reveal is cleared from the controls
// layer's per-frame hook — the side can stop existing, or stop being able to
// take a point, at any frame — and that hook runs from inside
// scene.updateMatrixWorld. A synchronous notification there re-enters the
// readout renderer's clear(), which removes CSS2DObjects from and disposes tube
// geometry under the shape entity's object3D, while a traversal of that same
// scene is in flight.
//
// Its own module rather than a method on the controls class, for the reason its
// sibling notifier is: that class imports the store through a path alias the
// test runner does not resolve, so nothing defined in it is reachable from a
// unit test.
//
// Its own `queued` flag, NOT shared with the sibling. Sharing the queue would
// coalesce scheduling and not emission — two event names still reach two
// subscriptions — so it saves one microtask and buys an ordering trap where a
// second event name is silently dropped while a notify is already pending. The
// coalescing that actually pays lives on the consumer, which is where the cost
// of a rebuild lands.
let queued = false;

export function notifyRevealedSideChanged() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    Events.emit('shapevertexrevealchanged');
  });
}
