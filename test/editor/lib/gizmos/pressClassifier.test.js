import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  PressClassifier
} from '@/editor/lib/gizmos/pressClassifier.js';

// A pointer event as far as the classifier reads one.
function sample(clientX, clientY, { timeStamp = 0, coalesced } = {}) {
  const event = { clientX, clientY, timeStamp };
  if (coalesced) {
    event.getCoalescedEvents = () =>
      coalesced.map(([x, y]) => ({ clientX: x, clientY: y, timeStamp }));
  }
  return event;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('telling a click from a drag', () => {
  it('uses a 2 px threshold', () => {
    expect(DRAG_THRESHOLD_PX).toBe(2);
    const press = new PressClassifier(100, 100);
    expect(press.track(sample(101.5, 101.3))).toBe(false);
    expect(press.track(sample(102, 100))).toBe(true);
  });

  it('calls a still two-second press a click, by event time and by the clock, rather than timing it out', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] });
    const press = new PressClassifier(100, 100);
    vi.advanceTimersByTime(1000);
    expect(press.track(sample(100.5, 100.6, { timeStamp: 1000 }))).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(press.track(sample(100.8, 100, { timeStamp: 2000 }))).toBe(false);
    expect(press.isDrag()).toBe(false);
  });

  it('remembers the furthest point, so out 3 px and back is a drag, where press and release positions alone would say click', () => {
    const press = new PressClassifier(100, 100);
    press.track(sample(103, 100));
    expect(press.track(sample(100, 100))).toBe(true);
    expect(press.maxDistance).toBe(3);
  });

  it('counts the samples the browser coalesced into one event, not only the event itself', () => {
    const press = new PressClassifier(100, 100);
    expect(press.track(sample(100, 100, { coalesced: [[101.5, 101.5]] }))).toBe(
      true
    );
  });

  it('reads an event with no coalesced samples', () => {
    const press = new PressClassifier(0, 0);
    expect(press.track({ clientX: 0, clientY: 1 })).toBe(false);
  });
});
