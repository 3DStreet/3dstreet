// The camera-write funnel. Every camera-moving path ends the same way: it
// resolves the letterbox mode indicator, dispatches the `change` event, and — if
// the move was NOT the wheel's own — invalidates the wheel's transient zoom-undo
// memory (a non-wheel move must not be reversible by a later swoop-out).
// Concentrating that postlude here replaces scattered clear-then-dispatch pairs
// (and the formerly hand-placed letterbox re-eval calls) with one edge that is
// impossible to forget, and keeps the `change` event firing on the controls
// instance (the frozen external contract) via the injected bound `dispatch`.
//
// Two orthogonal responsibilities, kept as separate injected callbacks so
// neither is overloaded onto the `source` string:
//   - `clearWheelMemory` — the wheel owns its zoom-undo memory; the actual clear
//     is injected (a 'wheel' source is a no-op — the wheel preserves its own
//     memory across its own moves).
//   - `resolveLetterbox(useHysteresis)` — recompute the letterbox sub-mode from
//     the live camera and emit a modechange on transition. `useHysteresis` picks
//     the eval mode: exact-T for every real-time write and every settle, a
//     dead-band δ only for a committed-motion-runner tween frame (so a tween that
//     settles on / runs along the tilt threshold can't strobe the indicator).
export class CameraWriteFunnel {
  constructor({ dispatch, clearWheelMemory, resolveLetterbox }) {
    this._dispatch = dispatch;
    this._clearWheelMemory = clearWheelMemory;
    this._resolveLetterbox = resolveLetterbox;
    this._changeEvent = { type: 'change' };
  }

  // Invalidate the wheel's zoom-undo memory for a non-wheel camera move. A
  // 'wheel' source is a no-op. Callers that clear only on actual movement (the
  // zero-motion guard) call this under their own `if (moved)` and dispatch
  // unconditionally.
  invalidateWheelMemory(source) {
    if (source !== 'wheel') this._clearWheelMemory();
  }

  // Fire the `change` event on the controls instance. First resolve the letterbox
  // at EXACT T (no dead-band) and emit any modechange — modechange must precede
  // change. This is the resolution for every real-time camera write (drag, wheel,
  // WASD, compass, reset, action-bar, focus) AND for every committed-motion
  // settle: whenever a tween is not the thing writing, the indicator tracks the
  // always-exact-T control regime.
  dispatch() {
    this._resolveLetterbox(false);
    this._dispatch(this._changeEvent);
  }

  // A committed-motion-runner TWEEN frame: invalidate wheel memory (a non-wheel
  // move), resolve the letterbox with HYSTERESIS (dead-band δ), then fire change.
  // Fires change itself rather than delegating to dispatch() so a tween frame
  // resolves the indicator exactly once (hysteresis) — never also exact-T. Used
  // ONLY by the two committed-motion-runner doors' per-tick onTick.
  commitTween(source) {
    this.invalidateWheelMemory(source);
    this._resolveLetterbox(true);
    this._dispatch(this._changeEvent);
  }

  // Sugar for the common real-time site: invalidate (for non-wheel sources) then
  // dispatch (which resolves letterbox exact-T and fires change).
  commitMove(source) {
    this.invalidateWheelMemory(source);
    this.dispatch();
  }
}
