import { describe, it, expect, afterEach, vi } from 'vitest';
import Events from '../../src/editor/lib/Events';
import { notifyActiveVertexChanged } from '../../src/editor/lib/notifyActiveVertexChanged.js';

// The SHIPPED function, imported directly — not a hand-copied notifier, which
// would stay correct while the real one was unwrapped. That is possible here
// only because this module's sole import is the event emitter: the controls
// class that calls it reaches the store through a path alias the runner does
// not resolve, so nothing defined in that file can be imported at all.
describe('notifyActiveVertexChanged', () => {
  const listeners = [];
  const listen = () => {
    const fn = vi.fn();
    Events.on('shapevertexactivechanged', fn);
    listeners.push(fn);
    return fn;
  };

  afterEach(() => {
    for (const fn of listeners) Events.off('shapevertexactivechanged', fn);
    listeners.length = 0;
  });

  // The deferral is the only thing keeping the readout renderer's teardown out
  // of a scene traversal already in flight: the sub-selection is cleared from
  // inside the controls layer's per-frame hook, which runs under
  // scene.updateMatrixWorld. Unwrapping "an emit inside a microtask for no
  // visible reason" reopens that, and this assertion is what stops it.
  it('does not fire synchronously', async () => {
    const fn = listen();
    notifyActiveVertexChanged();
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated calls in one turn into a single emit', async () => {
    const fn = listen();
    notifyActiveVertexChanged();
    notifyActiveVertexChanged();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is armed again on the next turn', async () => {
    const fn = listen();
    notifyActiveVertexChanged();
    await Promise.resolve();
    notifyActiveVertexChanged();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
