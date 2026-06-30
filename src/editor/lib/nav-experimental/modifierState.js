// Tracks Shift/Ctrl/Alt/Meta keyboard state and current mouse-button bitmask
// in one place so future phases don't each re-read event.shiftKey etc.
//
// On window blur, all modifiers and buttons clear — this prevents the
// classic "Ctrl-Tab away while dragging, release Ctrl elsewhere, return"
// stuck-modifier bug.

export class ModifierState {
  constructor(domElement) {
    this.domElement = domElement;
    this.shift = false;
    this.ctrl = false;
    this.alt = false;
    this.meta = false;
    this.buttons = 0;

    this._onKeyDown = this._readKeyEvent.bind(this);
    this._onKeyUp = this._readKeyEvent.bind(this);
    this._onBlur = this._reset.bind(this);
    this._onMouseDown = this._mouseDown.bind(this);
    this._onMouseUp = this._mouseUp.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    domElement.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _readKeyEvent(event) {
    this.shift = !!event.shiftKey;
    this.ctrl = !!event.ctrlKey;
    this.alt = !!event.altKey;
    this.meta = !!event.metaKey;
  }

  _reset() {
    this.shift = false;
    this.ctrl = false;
    this.alt = false;
    this.meta = false;
    this.buttons = 0;
  }

  _mouseDown(event) {
    this._readKeyEvent(event);
    this.buttons |= 1 << event.button;
  }

  _mouseUp(event) {
    this._readKeyEvent(event);
    this.buttons &= ~(1 << event.button);
  }

  isLeftDown() {
    return (this.buttons & 1) !== 0;
  }
  isMiddleDown() {
    return (this.buttons & 2) !== 0;
  }
  isRightDown() {
    return (this.buttons & 4) !== 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.domElement.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
  }
}
