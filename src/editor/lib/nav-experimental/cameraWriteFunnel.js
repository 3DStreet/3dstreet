// The camera-write funnel. Every camera-moving path ends the same way: it
// dispatches the `change` event, and — if the move was NOT the wheel's own — it
// invalidates the wheel's transient zoom-undo memory (a non-wheel move must not
// be reversible by a later swoop-out). Concentrating that postlude here replaces
// ~25 scattered clear-then-dispatch pairs with one edge that is impossible to
// forget, and keeps the `change` event firing on the controls instance (the
// frozen external contract) via the injected bound `dispatch`.
//
// The wheel engine owns the zoom-undo memory, so the actual clear is injected as
// a `clearWheelMemory` callback rather than reached through the context (the
// wheel is extracted in a later step; until then the callback points at the
// orchestrator's own method — a one-line re-point when the wheel moves).
export class CameraWriteFunnel {
  constructor({ dispatch, clearWheelMemory }) {
    this._dispatch = dispatch;
    this._clearWheelMemory = clearWheelMemory;
    this._changeEvent = { type: 'change' };
  }

  // Invalidate the wheel's zoom-undo memory for a non-wheel camera move. A
  // 'wheel' source is a no-op — the wheel preserves its own memory across its
  // own moves. Callers that clear only on actual movement (the jitter
  // guard) call this under their own `if (moved)` and dispatch unconditionally.
  invalidateWheelMemory(source) {
    if (source !== 'wheel') this._clearWheelMemory();
  }

  // Dispatch the `change` event on the controls instance.
  dispatch() {
    this._dispatch(this._changeEvent);
  }

  // Sugar for the common site: a camera move that unconditionally invalidates
  // (for non-wheel sources) and dispatches together.
  commitMove(source) {
    this.invalidateWheelMemory(source);
    this.dispatch();
  }
}
