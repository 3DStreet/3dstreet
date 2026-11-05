import { describe, it, expect } from 'vitest';
import {
  ASSET_SORTS,
  formatBytes,
  getOptimizationDisplay,
  sortAssetItems
} from '../../../src/shared/assets/utils.js';

describe('formatBytes', () => {
  it('returns 0 B for falsy input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
  });

  it('formats bytes', () => expect(formatBytes(500)).toBe('500 B'));
  it('formats KB', () => expect(formatBytes(5_000)).toBe('5 KB'));
  it('formats MB', () => expect(formatBytes(5_000_000)).toBe('5.0 MB'));
  it('formats GB', () => expect(formatBytes(2_500_000_000)).toBe('2.50 GB'));
});

describe('getOptimizationDisplay', () => {
  it('returns origSize only when no optimizationMetadata', () => {
    const result = getOptimizationDisplay({ size: 10_000_000 });
    expect(result).toEqual({ origSize: 10_000_000 });
  });

  it('returns origSize only for null/undefined input', () => {
    expect(getOptimizationDisplay(null)).toEqual({ origSize: 0 });
    expect(getOptimizationDisplay(undefined)).toEqual({ origSize: 0 });
  });

  it('returns skipReason for already_optimized', () => {
    const result = getOptimizationDisplay({
      size: 5_000_000,
      optimizationMetadata: {
        optimizationSkipped: true,
        reason: 'already_optimized'
      }
    });
    expect(result).toEqual({
      origSize: 5_000_000,
      skipReason: 'Already optimized'
    });
  });

  it('returns skipReason for not_smaller', () => {
    const result = getOptimizationDisplay({
      size: 3_000_000,
      optimizationMetadata: {
        optimizationSkipped: true,
        reason: 'not_smaller'
      }
    });
    expect(result).toEqual({
      origSize: 3_000_000,
      skipReason: "Optimization didn't reduce size"
    });
  });

  it('returns generic skipReason for unknown reason', () => {
    const result = getOptimizationDisplay({
      size: 3_000_000,
      optimizationMetadata: { optimizationSkipped: true, reason: 'unknown' }
    });
    expect(result.skipReason).toBe('Optimization skipped');
  });

  it('returns optSize and savePct when optimization succeeded', () => {
    const result = getOptimizationDisplay({
      size: 10_000_000,
      optimizedSourceSize: 3_000_000,
      optimizationMetadata: { optimizationSkipped: false }
    });
    expect(result).toEqual({
      origSize: 10_000_000,
      optSize: 3_000_000,
      savePct: 70
    });
  });

  it('rounds savePct to nearest integer', () => {
    const result = getOptimizationDisplay({
      size: 10_000_000,
      optimizedSourceSize: 3_333_333,
      optimizationMetadata: { optimizationSkipped: false }
    });
    expect(result.savePct).toBe(67);
  });

  it('falls back to origSize only when optimizedSourceSize >= size', () => {
    const result = getOptimizationDisplay({
      size: 3_000_000,
      optimizedSourceSize: 4_000_000,
      optimizationMetadata: { optimizationSkipped: false }
    });
    expect(result).toEqual({ origSize: 3_000_000 });
  });

  it('falls back to origSize only when optimizedSourceSize is 0', () => {
    const result = getOptimizationDisplay({
      size: 5_000_000,
      optimizedSourceSize: 0,
      optimizationMetadata: { optimizationSkipped: false }
    });
    expect(result).toEqual({ origSize: 5_000_000 });
  });
});

describe('sortAssetItems', () => {
  // Newest first, as Firestore returns them.
  const items = [
    { id: '3', name: 'plaza 10' },
    { id: '2', name: 'Bench' },
    { id: '1', name: 'plaza 9' }
  ];
  const ids = (sort) => sortAssetItems(items, sort).map((i) => i.id);

  it('keeps the query order for newest', () =>
    expect(ids(ASSET_SORTS.NEWEST)).toEqual(['3', '2', '1']));
  it('reverses it for oldest', () =>
    expect(ids(ASSET_SORTS.OLDEST)).toEqual(['1', '2', '3']));
  it('sorts names ignoring case, numbers in numeric order', () =>
    expect(ids(ASSET_SORTS.NAME_ASC)).toEqual(['2', '1', '3']));
  it('reverses the name order for Z-A', () =>
    expect(ids(ASSET_SORTS.NAME_DESC)).toEqual(['3', '1', '2']));
  it('does not mutate its input', () => {
    sortAssetItems(items, ASSET_SORTS.OLDEST);
    expect(items[0].id).toBe('3');
  });
});
