import { describe, expect, it } from 'vitest';
import {
  describeDroppedBoundaries,
  isBuildingBoundary,
  isBuildingMixin,
  isGeospatialActive,
  partitionBuildingBoundaries
} from '../../src/editor/lib/commands/geoBuildingGuard.js';

const fakeDoc = (geo) => ({
  querySelector: () => (geo ? { getAttribute: () => geo } : null)
});

describe('isGeospatialActive', () => {
  it('is true only with a street-geo on google3d', () => {
    expect(isGeospatialActive(fakeDoc(null))).toBe(false);
    expect(isGeospatialActive(fakeDoc({ maps: 'none' }))).toBe(false);
    expect(isGeospatialActive(fakeDoc({ maps: 'google3d' }))).toBe(true);
  });
});

describe('isBuildingBoundary', () => {
  it('flags building variants and passes fences/water through', () => {
    expect(
      isBuildingBoundary({ type: 'boundary', variant: 'brownstone' })
    ).toBe(true);
    expect(
      isBuildingBoundary({ type: 'boundary', variant: 'sp-big-box' })
    ).toBe(true);
    expect(isBuildingBoundary({ type: 'boundary', variant: 'grass' })).toBe(
      false
    );
    expect(isBuildingBoundary({ type: 'boundary', variant: 'water' })).toBe(
      false
    );
    expect(
      isBuildingBoundary({ type: 'drive-lane', variant: 'brownstone' })
    ).toBe(false);
    expect(isBuildingBoundary(undefined)).toBe(false);
  });
});

describe('isBuildingMixin', () => {
  const catalog = [
    { id: 'SM3D_Bld_Mixed_4fl', category: 'buildings' },
    { id: 'sedan-rig', category: 'vehicles-rigged' }
  ];
  it('uses the catalog category', () => {
    expect(isBuildingMixin('SM3D_Bld_Mixed_4fl', catalog)).toBe(true);
    expect(isBuildingMixin('sedan-rig', catalog)).toBe(false);
    expect(isBuildingMixin('unknown', catalog)).toBe(false);
    expect(isBuildingMixin('SM3D_Bld_Mixed_4fl', undefined)).toBe(false);
  });
});

describe('partitionBuildingBoundaries', () => {
  it('keeps order and reports input indices of the dropped ones', () => {
    const { kept, dropped } = partitionBuildingBoundaries([
      { type: 'boundary', variant: 'brownstone', side: 'left' },
      { type: 'sidewalk' },
      { type: 'drive-lane' },
      { type: 'boundary', variant: 'grass', side: 'right' },
      { type: 'boundary', variant: 'suburban', side: 'right' }
    ]);
    expect(kept.map((s) => s.type)).toEqual([
      'sidewalk',
      'drive-lane',
      'boundary'
    ]);
    expect(dropped).toEqual([
      { index: 0, variant: 'brownstone' },
      { index: 4, variant: 'suburban' }
    ]);
    expect(describeDroppedBoundaries(dropped)).toMatch(
      /segments\[0\] \(variant 'brownstone'\), segments\[4\]/
    );
  });
});
