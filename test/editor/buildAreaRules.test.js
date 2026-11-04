import { describe, it, expect } from 'vitest';
import {
  parsePalette,
  serializePalette,
  canPlace,
  pointInRingXZ,
  mergePalettes,
  chooseTapArea
} from '../../src/aframe-components/play/build-area-rules.js';

describe('build-area rules', () => {
  describe('parsePalette', () => {
    it('splits, trims and dedupes', () => {
      expect(parsePalette(' tree3, bench ,tree3,, planter ')).toEqual([
        'tree3',
        'bench',
        'planter'
      ]);
    });
    it('returns [] for empty or non-string input', () => {
      expect(parsePalette('')).toEqual([]);
      expect(parsePalette('   ')).toEqual([]);
      expect(parsePalette(undefined)).toEqual([]);
      expect(parsePalette(null)).toEqual([]);
    });
    it('round-trips through serializePalette', () => {
      expect(serializePalette(['a', ' b', 'a'])).toBe('a,b');
      expect(parsePalette(serializePalette(['x', 'y']))).toEqual(['x', 'y']);
    });
  });

  describe('canPlace', () => {
    it('enforces the cap', () => {
      expect(canPlace(0, 3)).toBe(true);
      expect(canPlace(2, 3)).toBe(true);
      expect(canPlace(3, 3)).toBe(false);
    });
    it('treats 0 / non-finite as unlimited', () => {
      expect(canPlace(999, 0)).toBe(true);
      expect(canPlace(999, NaN)).toBe(true);
      expect(canPlace(999, undefined)).toBe(true);
    });
  });

  describe('pointInRingXZ', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 }
    ];
    it('detects inside and outside of a square', () => {
      expect(pointInRingXZ({ x: 5, z: 5 }, square)).toBe(true);
      expect(pointInRingXZ({ x: 11, z: 5 }, square)).toBe(false);
      expect(pointInRingXZ({ x: -1, z: -1 }, square)).toBe(false);
    });
    it('handles a concave ring', () => {
      // L shape: the notch at top-right is outside.
      const ell = [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 5 },
        { x: 5, z: 5 },
        { x: 5, z: 10 },
        { x: 0, z: 10 }
      ];
      expect(pointInRingXZ({ x: 2, z: 8 }, ell)).toBe(true);
      expect(pointInRingXZ({ x: 8, z: 8 }, ell)).toBe(false);
      expect(pointInRingXZ({ x: 8, z: 2 }, ell)).toBe(true);
    });
    it('ignores y and rejects degenerate rings', () => {
      expect(pointInRingXZ({ x: 5, y: 100, z: 5 }, square)).toBe(true);
      expect(pointInRingXZ({ x: 5, z: 5 }, square.slice(0, 2))).toBe(false);
      expect(pointInRingXZ(null, square)).toBe(false);
    });
  });

  describe('mergePalettes', () => {
    it('unions enabled areas in first-seen order', () => {
      expect(
        mergePalettes([
          { enabled: true, palette: 'tree3,bench' },
          { enabled: false, palette: 'car' },
          { enabled: true, palette: 'bench,planter' }
        ])
      ).toEqual(['tree3', 'bench', 'planter']);
    });
    it('is empty with no areas', () => {
      expect(mergePalettes([])).toEqual([]);
      expect(mergePalettes(undefined)).toEqual([]);
    });
  });
});

import {
  footprintRadius,
  findFreeSpotXZ
} from '../../src/aframe-components/play/build-area-rules.js';

describe('tap-to-place spacing', () => {
  const square = [
    { x: -6, z: -6 },
    { x: 6, z: -6 },
    { x: 6, z: 6 },
    { x: -6, z: 6 }
  ];

  it('derives a footprint radius from model bounds', () => {
    expect(footprintRadius({ min: [-1, 0, -0.5], max: [1, 2, 0.5] })).toBe(1);
    expect(footprintRadius({ min: [-1, 0, -1], max: [1, 1, 1] }, 2)).toBe(2);
    expect(footprintRadius(null)).toBe(0.75);
  });

  it('uses the start point when it is free', () => {
    expect(findFreeSpotXZ({ x: 0, z: 0 }, square, [], 0.5)).toEqual({
      x: 0,
      z: 0
    });
  });

  it('fans repeated placements out instead of stacking them', () => {
    const occupied = [];
    for (let i = 0; i < 6; i++) {
      const spot = findFreeSpotXZ({ x: 0, z: 0 }, square, occupied, 0.5);
      expect(spot).not.toBeNull();
      for (const o of occupied) {
        const d = Math.hypot(spot.x - o.x, spot.z - o.z);
        expect(d).toBeGreaterThanOrEqual(1 + 0.25 - 1e-9);
      }
      occupied.push({ x: spot.x, z: spot.z, r: 0.5 });
    }
  });

  it('keeps spots inside the ring and gives up when the area is full', () => {
    const tiny = [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 }
    ];
    const occupied = [{ x: 0, z: 0, r: 1 }];
    expect(findFreeSpotXZ({ x: 0, z: 0 }, tiny, occupied, 0.5)).toBeNull();
    const spot = findFreeSpotXZ(
      { x: 5.5, z: 0 },
      square,
      [{ x: 5.5, z: 0, r: 0.5 }],
      0.5
    );
    expect(Math.abs(spot.x) <= 6 && Math.abs(spot.z) <= 6).toBe(true);
  });
});

import { interiorPointXZ } from '../../src/aframe-components/play/build-area-rules.js';

describe('interiorPointXZ', () => {
  it('lands inside an L-shaped ring whose corner-average is outside it', () => {
    // L: 10x10 square minus its top-right 8x8 quadrant (thin arms).
    const ell = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 2 },
      { x: 2, z: 2 },
      { x: 2, z: 10 },
      { x: 0, z: 10 }
    ];
    const avg = ell.reduce((a, p) => ({ x: a.x + p.x / 6, z: a.z + p.z / 6 }), {
      x: 0,
      z: 0
    });
    expect(pointInRingXZ(avg, ell)).toBe(false);
    const p = interiorPointXZ(ell);
    expect(pointInRingXZ(p, ell)).toBe(true);
  });

  it('lands near the middle of a convex ring', () => {
    const square = [
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: 4, z: 4 },
      { x: -4, z: 4 }
    ];
    const p = interiorPointXZ(square);
    expect(Math.abs(p.x) < 0.5 && Math.abs(p.z) < 0.5).toBe(true);
  });

  it('returns null for a degenerate ring', () => {
    expect(interiorPointXZ([{ x: 0, z: 0 }])).toBeNull();
  });
});

describe('chooseTapArea', () => {
  const area = (over) => ({
    offers: true,
    hasRoom: true,
    underCentre: false,
    visible: true,
    distance: 10,
    ...over
  });
  it('prefers the area under the view centre when it can take the object', () => {
    expect(
      chooseTapArea([area({ distance: 1 }), area({ underCentre: true })])
    ).toEqual({ index: 1 });
  });
  it('skips a centre area that does not offer the object', () => {
    expect(
      chooseTapArea([area({ underCentre: true, offers: false }), area()])
    ).toEqual({ index: 1 });
  });
  it('skips a full centre area when another has room', () => {
    expect(
      chooseTapArea([area({ underCentre: true, hasRoom: false }), area()])
    ).toEqual({ index: 1 });
  });
  it('picks the nearest visible area, never one out of view', () => {
    expect(
      chooseTapArea([
        area({ visible: false, distance: 1 }),
        area({ distance: 20 }),
        area({ distance: 5 })
      ])
    ).toEqual({ index: 2 });
  });
  it('refuses when only areas out of view could take the object', () => {
    expect(
      chooseTapArea([
        area({ visible: false }),
        area({ offers: false }),
        area({ hasRoom: false })
      ])
    ).toEqual({ reason: 'offscreen' });
  });
  it('explains a refusal', () => {
    expect(chooseTapArea([area({ offers: false })])).toEqual({
      reason: 'palette'
    });
    expect(
      chooseTapArea([area({ offers: false }), area({ hasRoom: false })])
    ).toEqual({ reason: 'full' });
    expect(chooseTapArea([])).toEqual({ reason: 'outside' });
  });
});
