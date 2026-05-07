import { describe, it, expect, beforeEach } from 'vitest';
import { GestureLatch } from '../../../../src/editor/lib/nav-experimental/gestureLatch.js';

describe('GestureLatch', () => {
  let latch;

  beforeEach(() => {
    latch = new GestureLatch();
  });

  it('starts inactive', () => {
    expect(latch.isActive()).toBe(false);
    expect(latch.get('mode')).toBeUndefined();
    expect(latch.all()).toBeNull();
  });

  it('captures values at start() and exposes them via get()', () => {
    latch.start({ mode: 'pan', anchor: { x: 1, y: 2 } });
    expect(latch.isActive()).toBe(true);
    expect(latch.get('mode')).toBe('pan');
    expect(latch.get('anchor')).toEqual({ x: 1, y: 2 });
  });

  it('clears state on end()', () => {
    latch.start({ mode: 'rotate' });
    latch.end();
    expect(latch.isActive()).toBe(false);
    expect(latch.get('mode')).toBeUndefined();
  });

  it('snapshots the input object so caller mutations do not leak in', () => {
    const input = { mode: 'pan' };
    latch.start(input);
    input.mode = 'rotate';
    expect(latch.get('mode')).toBe('pan');
  });

  it('all() returns a fresh copy of the latched values', () => {
    latch.start({ mode: 'pan', count: 1 });
    const a = latch.all();
    const b = latch.all();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.mode = 'mutated';
    expect(latch.get('mode')).toBe('pan');
  });

  it('set() updates only when active', () => {
    latch.set('mode', 'pan');
    expect(latch.get('mode')).toBeUndefined();

    latch.start({});
    latch.set('mode', 'pan');
    expect(latch.get('mode')).toBe('pan');

    latch.end();
    latch.set('mode', 'rotate');
    expect(latch.get('mode')).toBeUndefined();
  });

  it('start() with no values yields an empty active latch', () => {
    latch.start();
    expect(latch.isActive()).toBe(true);
    expect(latch.all()).toEqual({});
  });
});
