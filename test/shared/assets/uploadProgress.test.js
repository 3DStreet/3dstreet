import { describe, it, expect, vi } from 'vitest';
import { createAggregateProgress } from '../../../src/shared/assets/uploadProgress.js';

describe('createAggregateProgress', () => {
  it('weights each file by its byte size', () => {
    const emit = vi.fn();
    const report = createAggregateProgress([100, 300], emit);
    report(0, 100); // the small file finishes first
    expect(emit).toHaveBeenLastCalledWith(25);
    report(1, 50);
    expect(emit).toHaveBeenLastCalledWith(62.5);
    report(1, 100);
    expect(emit).toHaveBeenLastCalledWith(100);
  });

  it('never reports 100 until every file is done (#1989)', () => {
    const emit = vi.fn();
    const report = createAggregateProgress([90_000_000, 10_000_000], emit);
    report(0, 100);
    expect(emit).toHaveBeenLastCalledWith(90);
  });

  it('ignores a zero-size slot (no optimized variant)', () => {
    const emit = vi.fn();
    const report = createAggregateProgress([500, 0], emit);
    report(0, 40);
    expect(emit).toHaveBeenLastCalledWith(40);
  });

  it('clamps out-of-range per-file values', () => {
    const emit = vi.fn();
    const report = createAggregateProgress([100, 100], emit);
    report(0, 140);
    report(1, -5);
    expect(emit).toHaveBeenLastCalledWith(50);
  });
});
