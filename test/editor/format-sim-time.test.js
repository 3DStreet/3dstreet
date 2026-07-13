import { describe, it, expect } from 'vitest';
import {
  formatSimTime,
  formatSimDelta
} from '../../src/aframe-components/play/format-sim-time.js';

describe('formatSimTime', () => {
  it('formats a plain duration as M:SS.CC', () => {
    expect(formatSimTime(12340)).toBe('0:12.34');
    expect(formatSimTime(0)).toBe('0:00.00');
    expect(formatSimTime(65000)).toBe('1:05.00');
  });

  it('clamps negative input to zero', () => {
    expect(formatSimTime(-500)).toBe('0:00.00');
  });

  it('never renders an illegal ":60.00" at a minute boundary', () => {
    // 119995ms naively floors to 1 minute with 59.995s -> "1:60.00".
    // Rounding to centiseconds first must carry to "2:00.00".
    expect(formatSimTime(119995)).toBe('2:00.00');
    expect(formatSimTime(59996)).toBe('1:00.00');
    expect(formatSimTime(59994)).toBe('0:59.99');
  });
});

describe('formatSimDelta', () => {
  it('signs best-time deltas', () => {
    expect(formatSimDelta(1500)).toBe('+0:01.50');
    expect(formatSimDelta(-1500)).toBe('-0:01.50');
    expect(formatSimDelta(0)).toBe('+0:00.00');
  });
});
