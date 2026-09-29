// Shared endpoint / span math for managed streets (#1930 phase 0).
import { describe, it, expect } from 'vitest';
import {
  zStartForAlign,
  endpointLocalZ,
  centerlineX,
  getStreetNodes,
  getLongitudinalSpan
} from '@/tested/street-nodes-utils.js';

describe('zStartForAlign / endpointLocalZ', () => {
  it('middle centers the street on its origin', () => {
    expect(zStartForAlign(60, 'middle')).toBe(-30);
    expect(endpointLocalZ(60, 'middle')).toEqual({ start: -30, end: 30 });
  });

  it('start spans [-L, 0] and end spans [0, L]', () => {
    expect(endpointLocalZ(60, 'start')).toEqual({ start: -60, end: 0 });
    expect(endpointLocalZ(60, 'end')).toEqual({ start: 0, end: 60 });
  });

  it('defaults to middle (the street-align schema default) for unknown values', () => {
    expect(zStartForAlign(10)).toBe(-5);
    expect(zStartForAlign(10, undefined)).toBe(-5);
    expect(zStartForAlign(10, 'bogus')).toBe(-5);
  });

  it('treats a missing length as 0', () => {
    expect(endpointLocalZ(undefined, 'start')).toEqual({ start: 0, end: 0 });
  });
});

describe('centerlineX', () => {
  it('center is 0, left is +W/2, right is -W/2', () => {
    expect(centerlineX(12, 'center')).toBe(0);
    expect(centerlineX(12, 'left')).toBe(6);
    expect(centerlineX(12, 'right')).toBe(-6);
    expect(centerlineX(12)).toBe(0);
  });
});

describe('getStreetNodes', () => {
  it('places both nodes on the centerline with outward directions', () => {
    const nodes = getStreetNodes({
      length: 40,
      lengthAlign: 'middle',
      widthAlign: 'left',
      totalWidth: 10
    });
    expect(nodes.centerX).toBe(5);
    expect(nodes.start).toMatchObject({ key: 'start', x: 5, z: -20 });
    expect(nodes.end).toMatchObject({ key: 'end', x: 5, z: 20 });
    expect(nodes.start.dir).toEqual({ x: 0, z: -1 });
    expect(nodes.end.dir).toEqual({ x: 0, z: 1 });
    expect(nodes.end.right).toEqual({ x: 1, z: 0 });
  });

  it('matches the endpoint gizmo math for every alignment', () => {
    for (const [align, expected] of [
      ['start', { start: -40, end: 0 }],
      ['middle', { start: -20, end: 20 }],
      ['end', { start: 0, end: 40 }]
    ]) {
      const nodes = getStreetNodes({ length: 40, lengthAlign: align });
      expect(nodes.start.z).toBe(expected.start);
      expect(nodes.end.z).toBe(expected.end);
    }
  });
});

describe('getLongitudinalSpan', () => {
  it('is the segment-centered ±L/2 span with zero insets', () => {
    expect(getLongitudinalSpan(60)).toEqual({
      zStart: -30,
      zEnd: 30,
      length: 60
    });
  });

  it('pulls each end inward by its inset', () => {
    const span = getLongitudinalSpan(60, { insetStart: 4, insetEnd: 6 });
    expect(span).toEqual({ zStart: -26, zEnd: 24, length: 50 });
  });

  it('never crosses: oversized insets share the remaining length', () => {
    const span = getLongitudinalSpan(10, { insetStart: 30, insetEnd: 10 });
    expect(span.length).toBeCloseTo(0);
    expect(span.zStart).toBeLessThanOrEqual(span.zEnd + 1e-9);
    // 3:1 ratio of the requested insets is kept
    expect(span.zStart).toBeCloseTo(-5 + 7.5);
  });

  it('ignores negative insets and lengths', () => {
    expect(getLongitudinalSpan(20, { insetStart: -5 })).toEqual({
      zStart: -10,
      zEnd: 10,
      length: 20
    });
    expect(getLongitudinalSpan(-3)).toEqual({ zStart: 0, zEnd: 0, length: 0 });
  });
});
