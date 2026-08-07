import Events from './Events';

// "Which side has its insert button revealed changed" — deferred to a
// microtask, and carrying NO payload. Both are required, not stylistic: the
// reveal is cleared from inside a scene traversal, and a consumer that reads the
// current state from its single owner cannot act on a stale snapshot. The
// `queued` flag is deliberately private to this module rather than shared with
// the sibling notifier. Full rationale: docs/shape-vertex-editing.md.
let queued = false;

export function notifyRevealedSideChanged() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    Events.emit('shapevertexrevealchanged');
  });
}
