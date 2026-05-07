import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModifierState } from '../../../../src/editor/lib/nav-experimental/modifierState.js';

describe('ModifierState', () => {
  let dom;
  let state;

  beforeEach(() => {
    dom = document.createElement('div');
    document.body.appendChild(dom);
    state = new ModifierState(dom);
  });

  afterEach(() => {
    state.dispose();
    dom.remove();
  });

  function fire(target, type, init) {
    const event =
      type.startsWith('mouse') || type === 'wheel'
        ? new MouseEvent(type, init)
        : type.startsWith('key')
          ? new KeyboardEvent(type, init)
          : new Event(type, init);
    target.dispatchEvent(event);
  }

  it('starts with all modifiers and buttons cleared', () => {
    expect(state.shift).toBe(false);
    expect(state.ctrl).toBe(false);
    expect(state.alt).toBe(false);
    expect(state.meta).toBe(false);
    expect(state.buttons).toBe(0);
    expect(state.isLeftDown()).toBe(false);
  });

  it('reads modifiers off keydown', () => {
    fire(window, 'keydown', { key: 'Shift', shiftKey: true });
    expect(state.shift).toBe(true);
    fire(window, 'keyup', { key: 'Shift', shiftKey: false });
    expect(state.shift).toBe(false);
  });

  it('tracks ctrl, alt, meta independently', () => {
    fire(window, 'keydown', {
      key: 'Control',
      ctrlKey: true,
      altKey: true,
      metaKey: true
    });
    expect(state.ctrl).toBe(true);
    expect(state.alt).toBe(true);
    expect(state.meta).toBe(true);
  });

  it('sets and clears the LB bit on mousedown / mouseup', () => {
    fire(dom, 'mousedown', { button: 0 });
    expect(state.isLeftDown()).toBe(true);
    expect(state.buttons).toBe(1);
    fire(window, 'mouseup', { button: 0 });
    expect(state.isLeftDown()).toBe(false);
    expect(state.buttons).toBe(0);
  });

  it('tracks middle and right buttons via separate bits', () => {
    fire(dom, 'mousedown', { button: 1 });
    fire(dom, 'mousedown', { button: 2 });
    expect(state.isMiddleDown()).toBe(true);
    expect(state.isRightDown()).toBe(true);
    expect(state.buttons).toBe(0b110);
  });

  it('clears everything on window blur (stuck-modifier guard)', () => {
    fire(window, 'keydown', { shiftKey: true, ctrlKey: true });
    // Browser mouse events carry the current modifier state too; passing
    // it here matches reality (Shift is still held while the user clicks).
    fire(dom, 'mousedown', { button: 0, shiftKey: true, ctrlKey: true });
    expect(state.shift).toBe(true);
    expect(state.isLeftDown()).toBe(true);

    fire(window, 'blur');
    expect(state.shift).toBe(false);
    expect(state.ctrl).toBe(false);
    expect(state.alt).toBe(false);
    expect(state.meta).toBe(false);
    expect(state.buttons).toBe(0);
  });

  it('reads modifier state from mouse events too', () => {
    fire(dom, 'mousedown', { button: 0, shiftKey: true });
    expect(state.shift).toBe(true);
  });

  it('removes listeners on dispose', () => {
    state.dispose();
    fire(window, 'keydown', { shiftKey: true });
    expect(state.shift).toBe(false);
    fire(dom, 'mousedown', { button: 0 });
    expect(state.isLeftDown()).toBe(false);
  });
});
