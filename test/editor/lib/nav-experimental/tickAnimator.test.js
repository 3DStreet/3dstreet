import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub AFRAME so registerComponent is a no-op; the test drives ticks by
// calling the fan-out directly.
globalThis.AFRAME = {
  registerComponent: () => {},
  components: {}
};

const { TickAnimator, _internals } =
  await import('../../../../src/editor/lib/nav-experimental/tickAnimator.js');

function makeSceneEl() {
  // Real DOM element so appendChild / parentNode behave normally.
  const el = document.createElement('a-scene');
  document.body.appendChild(el);
  return el;
}

// Drive ticks directly through the fan-out (bypassing the A-Frame
// scene-tick path, which jsdom does not provide).
function runTick(delta) {
  const snapshot = Array.from(_internals._registeredTickAnimators);
  for (const ta of snapshot) ta._tick(delta);
}

describe('TickAnimator', () => {
  let sceneEl;
  let ta;

  beforeEach(() => {
    sceneEl = makeSceneEl();
    ta = new TickAnimator(sceneEl);
  });

  afterEach(() => {
    ta.dispose();
  });

  it('subscribe() invokes callback on each tick with delta', () => {
    const cb = vi.fn();
    const unsub = ta.subscribe(cb);
    runTick(16);
    runTick(33);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith(16);
    expect(cb).toHaveBeenLastCalledWith(33);
    unsub();
    runTick(16);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('animate() drives onTick from 0 to 1 over durationMs', () => {
    const ticks = [];
    const done = vi.fn();
    ta.animate({
      durationMs: 100,
      ease: (t) => t, // linear for predictable values
      onTick: (eased, raw) => ticks.push({ eased, raw }),
      onDone: done
    });
    runTick(25);
    runTick(25);
    runTick(25);
    expect(done).not.toHaveBeenCalled();
    runTick(25);
    expect(done).toHaveBeenCalledTimes(1);
    expect(ticks[0].raw).toBeCloseTo(0.25);
    expect(ticks[1].raw).toBeCloseTo(0.5);
    expect(ticks[2].raw).toBeCloseTo(0.75);
    expect(ticks[3].raw).toBe(1);
  });

  it('default ease is easeInOutQuad and ends at 1', () => {
    expect(_internals.easeInOutQuad(0)).toBe(0);
    expect(_internals.easeInOutQuad(1)).toBe(1);
    expect(_internals.easeInOutQuad(0.5)).toBeCloseTo(0.5);
    expect(_internals.easeInOutQuad(0.25)).toBeCloseTo(0.125);
  });

  it('cancel() stops the in-flight tween and prevents onDone', () => {
    const onTick = vi.fn();
    const onDone = vi.fn();
    const handle = ta.animate({
      durationMs: 100,
      ease: (t) => t,
      onTick,
      onDone
    });
    runTick(25);
    handle.cancel();
    runTick(100);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(ta.isAnimating()).toBe(false);
  });

  it('animate() while another tween is active cancels the prior tween', () => {
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    ta.animate({
      durationMs: 100,
      ease: (t) => t,
      onTick: () => {},
      onDone: firstDone
    });
    runTick(25);
    ta.animate({
      durationMs: 50,
      ease: (t) => t,
      onTick: () => {},
      onDone: secondDone
    });
    runTick(50);
    expect(firstDone).not.toHaveBeenCalled();
    expect(secondDone).toHaveBeenCalledTimes(1);
  });

  it('subscriber that throws does not break sibling subscribers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    ta.subscribe(() => {
      throw new Error('boom');
    });
    ta.subscribe(good);
    runTick(16);
    expect(good).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('dispose() removes the animator from the global tick fanout', () => {
    const cb = vi.fn();
    ta.subscribe(cb);
    ta.dispose();
    runTick(16);
    expect(cb).not.toHaveBeenCalled();
  });

  it('two animators receive ticks independently', () => {
    const ta2 = new TickAnimator(makeSceneEl());
    const a = vi.fn();
    const b = vi.fn();
    ta.subscribe(a);
    ta2.subscribe(b);
    runTick(10);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ta2.dispose();
  });
});
