import { describe, it, expect } from 'vitest';
import {
  parsePalette,
  serializePalette,
  canPlace,
  pointInRingXZ,
  mergePalettes
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
