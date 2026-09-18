import { describe, it, expect, vi } from 'vitest';
import {
  AssetLoadTracker,
  EMPTY_ASSET_LOAD_SUMMARY,
  LOAD_STATUS
} from '@/asset-load-tracker';

const flush = () => new Promise((resolve) => queueMicrotask(resolve));

function makeTracker(overrides = {}) {
  let t = 0;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const tracker = new AssetLoadTracker({
    now: clock.now,
    timeoutMs: 1000,
    ...overrides
  });
  return { tracker, clock };
}

describe('AssetLoadTracker', () => {
  it('starts empty and idle', () => {
    const { tracker } = makeTracker();
    expect(tracker.getSummary()).toBe(EMPTY_ASSET_LOAD_SUMMARY);
    expect(tracker.get('nothing')).toBeNull();
  });

  it('counts deterministic loads through pending → loaded', () => {
    const { tracker } = makeTracker();
    const a = {};
    const b = {};
    tracker.begin(a, { kind: 'model', src: 'a.glb' });
    tracker.begin(b, { kind: 'model', src: 'b.glb' });
    let s = tracker.getSummary();
    expect(s).toMatchObject({ total: 2, pending: 2, settled: 0, done: false });
    expect(s.progress).toBe(0);

    expect(tracker.settle(a, LOAD_STATUS.LOADED)).toBe(true);
    s = tracker.getSummary();
    expect(s).toMatchObject({ total: 2, pending: 1, loaded: 1, settled: 1 });
    expect(s.progress).toBe(0.5);
    expect(s.done).toBe(false);

    tracker.settle(b, LOAD_STATUS.ERROR);
    s = tracker.getSummary();
    expect(s).toMatchObject({
      pending: 0,
      loaded: 1,
      error: 1,
      settled: 2,
      progress: 1,
      done: true
    });
    expect(s.failures.map((f) => f.src)).toEqual(['b.glb']);
  });

  it('ignores settle for keys that never began (batched duplicates)', () => {
    const { tracker } = makeTracker();
    expect(tracker.settle({}, LOAD_STATUS.LOADED)).toBe(false);
    expect(tracker.getSummary().total).toBe(0);
  });

  it('rejects an unknown settle status', () => {
    const { tracker } = makeTracker();
    tracker.begin('x');
    expect(() => tracker.settle('x', 'pending')).toThrow(/bad status/);
  });

  it('returns a fresh entry object on every change and a stable one between', () => {
    const { tracker } = makeTracker();
    const key = {};
    tracker.begin(key);
    const first = tracker.get(key);
    expect(tracker.get(key)).toBe(first);
    tracker.settle(key, LOAD_STATUS.LOADED);
    const second = tracker.get(key);
    expect(second).not.toBe(first);
    expect(second.status).toBe(LOAD_STATUS.LOADED);
    // Summary identity is stable until the next change too.
    const summary = tracker.getSummary();
    expect(tracker.getSummary()).toBe(summary);
  });

  it('re-begin on a settled key makes it pending again (reload)', () => {
    const { tracker, clock } = makeTracker();
    tracker.begin('m', { src: 'old.glb' });
    tracker.settle('m', LOAD_STATUS.ERROR);
    clock.advance(10);
    tracker.begin('m', { src: 'new.glb' });
    const entry = tracker.get('m');
    expect(entry.status).toBe(LOAD_STATUS.PENDING);
    expect(entry.src).toBe('new.glb');
    expect(entry.startedAt).toBe(10);
    expect(tracker.getSummary()).toMatchObject({ pending: 1, error: 0 });
  });

  it('times out pending loads on tick and lets a late settle override', () => {
    const { tracker, clock } = makeTracker();
    tracker.begin('slow');
    clock.advance(999);
    expect(tracker.tick()).toBe(false);
    clock.advance(1);
    expect(tracker.tick()).toBe(true);
    expect(tracker.get('slow').status).toBe(LOAD_STATUS.TIMED_OUT);
    expect(tracker.getSummary()).toMatchObject({
      timedOut: 1,
      pending: 0,
      done: true
    });
    tracker.settle('slow', LOAD_STATUS.LOADED);
    expect(tracker.getSummary()).toMatchObject({ timedOut: 0, loaded: 1 });
  });

  it('forgets keys that are no longer alive on tick', () => {
    const alive = new Set(['a', 'b']);
    const { tracker } = makeTracker({ isAlive: (k) => alive.has(k) });
    tracker.begin('a');
    tracker.begin('b');
    tracker.setStreaming('b', true);
    alive.delete('a');
    expect(tracker.tick()).toBe(true);
    expect(tracker.get('a')).toBeNull();
    expect(tracker.getSummary()).toMatchObject({ total: 1, streams: 1 });
    alive.delete('b');
    tracker.tick();
    expect(tracker.getSummary().streams).toBe(0);
  });

  it('keeps streams out of the deterministic count', () => {
    const { tracker } = makeTracker();
    const splat = {};
    tracker.setStreaming(splat, true, { kind: 'splat' });
    let s = tracker.getSummary();
    expect(s).toMatchObject({
      total: 0,
      done: false,
      streams: 1,
      streamsActive: 1
    });
    expect(tracker.get(splat)).toMatchObject({
      streaming: true,
      active: true,
      kind: 'splat'
    });
    tracker.setStreaming(splat, false);
    s = tracker.getSummary();
    expect(s.streamsActive).toBe(0);
    expect(s.streams).toBe(1);
    // Same state again is a no-op (no new object).
    const rec = tracker.get(splat);
    tracker.setStreaming(splat, false);
    expect(tracker.get(splat)).toBe(rec);
  });

  it('forget and reset drop state', () => {
    const { tracker } = makeTracker();
    tracker.begin('a');
    tracker.setStreaming('s', true);
    tracker.forget('a');
    expect(tracker.get('a')).toBeNull();
    expect(tracker.getSummary().streams).toBe(1);
    tracker.reset();
    expect(tracker.getSummary()).toMatchObject({ total: 0, streams: 0 });
  });

  it('notifies subscribers once per microtask, however many changes', async () => {
    const { tracker } = makeTracker();
    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);
    tracker.begin('a');
    tracker.begin('b');
    tracker.settle('a', LOAD_STATUS.LOADED);
    expect(listener).not.toHaveBeenCalled();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    tracker.settle('b', LOAD_STATUS.LOADED);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
