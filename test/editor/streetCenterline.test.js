// Owned centerline codec for managed-street.points (#1930 pillar 1).
import { describe, it, expect } from 'vitest';
import {
  formatCenterlinePoints,
  parseCenterlinePoints,
  hasCenterlinePoints,
  rotateY,
  parentPointsToStreetLocal,
  centroidOf,
  pointsRelativeTo,
  polylineLength,
  recenterPointsXZ
} from '@/tested/street-centerline.js';

describe('formatCenterlinePoints / parseCenterlinePoints', () => {
  it('round-trips points at millimeter precision', () => {
    const pts = [
      { x: -30.1234, y: 0, z: 0 },
      { x: 0, y: 1.5, z: 12.5 },
      { x: 30, y: 0, z: -7.0004 }
    ];
    const str = formatCenterlinePoints(pts);
    expect(str).toBe('-30.123 0 0, 0 1.5 12.5, 30 0 -7');
    const back = parseCenterlinePoints(str);
    expect(back).toHaveLength(3);
    expect(back[0].x).toBeCloseTo(-30.123, 3);
    expect(back[1]).toEqual({ x: 0, y: 1.5, z: 12.5 });
    expect(back[2].z).toBe(-7);
  });

  it('writes "0" rather than "-0" and drops trailing zeros', () => {
    expect(
      formatCenterlinePoints([
        { x: -0, y: 0, z: 10 },
        { x: 5, z: 0 }
      ])
    ).toBe('0 0 10, 5 0 0');
  });

  it('formats fewer than two points as empty (a straight street)', () => {
    expect(formatCenterlinePoints([])).toBe('');
    expect(formatCenterlinePoints([{ x: 1, y: 0, z: 2 }])).toBe('');
    expect(formatCenterlinePoints(null)).toBe('');
  });

  it('reads "x z" pairs as y = 0 and tolerates stray whitespace / trailing comma', () => {
    expect(parseCenterlinePoints('  0 0 ,  10 5 , ')).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 5 }
    ]);
  });

  it('reads anything malformed as straight instead of throwing', () => {
    expect(parseCenterlinePoints('1 2 x, 3 4 5')).toEqual([]);
    expect(parseCenterlinePoints('1 2 3 4, 5 6 7')).toEqual([]);
    expect(parseCenterlinePoints('1 2 3')).toEqual([]);
    expect(parseCenterlinePoints('')).toEqual([]);
    expect(parseCenterlinePoints(undefined)).toEqual([]);
    expect(hasCenterlinePoints('0 0 0, 1 0 1')).toBe(true);
    expect(hasCenterlinePoints('0 0 0')).toBe(false);
  });
});

describe('rotateY / parentPointsToStreetLocal', () => {
  it('rotateY follows the A-Frame yaw convention (+90° turns +Z onto +X)', () => {
    const r = rotateY({ x: 0, y: 0, z: 1 }, 90);
    expect(r.x).toBeCloseTo(1);
    expect(r.z).toBeCloseTo(0);
  });

  it('inverts a street transform: parent-space points → street-local', () => {
    // A street at (10, 0, 20) yawed 90°: its local +Z points along parent +X.
    const local = parentPointsToStreetLocal(
      [
        { x: 10, y: 0, z: 20 },
        { x: 40, y: 2, z: 20 }
      ],
      { x: 10, y: 0, z: 20 },
      90
    );
    expect(local[0].x).toBeCloseTo(0);
    expect(local[0].z).toBeCloseTo(0);
    expect(local[1].x).toBeCloseTo(0);
    expect(local[1].y).toBeCloseTo(2);
    expect(local[1].z).toBeCloseTo(30);
  });
});

describe('centroid / relative / length helpers', () => {
  const pts = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 30 },
    { x: 30, y: 0, z: 30 }
  ];
  it('centroidOf and pointsRelativeTo', () => {
    const c = centroidOf(pts);
    expect(c).toEqual({ x: 10, y: 0, z: 20 });
    const rel = pointsRelativeTo(pts, c);
    expect(rel[0]).toEqual({ x: -10, y: 0, z: -20 });
    expect(centroidOf([])).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('polylineLength open and closed', () => {
    expect(polylineLength(pts)).toBeCloseTo(60);
    expect(polylineLength(pts, true)).toBeCloseTo(60 + Math.hypot(30, 30));
  });
});

describe('recenterPointsXZ', () => {
  it('moves the XZ centroid to the origin and keeps elevation on the points', () => {
    const { offset, points } = recenterPointsXZ([
      { x: 400, y: 1, z: 0 },
      { x: 500, y: 3, z: 100 }
    ]);
    expect(offset).toEqual({ x: 450, y: 0, z: 50 });
    expect(points).toEqual([
      { x: -50, y: 1, z: -50 },
      { x: 50, y: 3, z: 50 }
    ]);
  });
});
