// Generic gesture-latching helper. At gesture start the caller captures
// values that should be held constant for the gesture's duration (mode,
// rotation center, cursor anchor, etc.). The same values are exposed via
// get() until end() clears them.
//
// Used to avoid mid-drag mode flips when the camera or modifier state
// crosses a threshold during a gesture (see plan §3a, §3b).

export class GestureLatch {
  constructor() {
    this._active = false;
    this._values = null;
  }

  start(values) {
    this._active = true;
    this._values = values ? { ...values } : {};
  }

  end() {
    this._active = false;
    this._values = null;
  }

  isActive() {
    return this._active;
  }

  get(key) {
    if (!this._active || this._values == null) return undefined;
    return this._values[key];
  }

  set(key, value) {
    if (!this._active) return;
    if (this._values == null) this._values = {};
    this._values[key] = value;
  }

  all() {
    return this._active && this._values ? { ...this._values } : null;
  }
}
