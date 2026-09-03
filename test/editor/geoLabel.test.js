import { describe, expect, it } from 'vitest';
import {
  endpointReadoutText,
  formatBearing,
  formatLatLon
} from '../../src/editor/lib/geo/geoLabel.js';

describe('geo readout text', () => {
  it('formats lat/lon to six places and bearings as whole degrees', () => {
    expect(formatLatLon(37.7749, -122.4194)).toBe('37.774900, -122.419400');
    expect(formatBearing(89.6)).toBe('90°');
  });

  it('shows lat/lon + bearing + length when geo is live', () => {
    expect(
      endpointReadoutText({
        x: 1,
        z: 2,
        latitude: 37.7749,
        longitude: -122.4194,
        headingDeg: 90,
        lengthText: '60.00m'
      })
    ).toBe('37.774900, -122.419400\n90° · 60.00m');
  });

  it('falls back to scene x/z when there is no geo layer', () => {
    expect(
      endpointReadoutText({
        x: 12.345,
        z: -4.5,
        headingDeg: 270,
        lengthText: '40.00m'
      })
    ).toBe('x 12.35  z -4.50\n270° · 40.00m');
  });

  it('omits the second line when nothing is known', () => {
    expect(endpointReadoutText({ x: 0, z: 0 })).toBe('x 0.00  z 0.00');
  });
});
