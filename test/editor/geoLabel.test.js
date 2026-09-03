import { describe, expect, it } from 'vitest';
import {
  endpointReadoutText,
  formatBearing,
  formatGeoLoc,
  formatLatLon
} from '../../src/editor/lib/geo/geoLabel.js';

describe('geo readout text', () => {
  it('formats lat/lon to six places', () => {
    expect(formatLatLon(37.7749, -122.4194)).toBe('37.774900, -122.419400');
  });

  it('formats a true bearing as three digits with a T suffix', () => {
    expect(formatBearing(89.6)).toBe('090° T');
    expect(formatBearing(7)).toBe('007° T');
    expect(formatBearing(-90)).toBe('270° T');
    expect(formatBearing(360)).toBe('000° T');
  });

  it('joins lat, lon and bearing on one line', () => {
    expect(formatGeoLoc(37.7749, -122.4194, 98)).toBe(
      '37.774900, -122.419400, 098° T'
    );
    expect(formatGeoLoc(37.7749, -122.4194)).toBe('37.774900, -122.419400');
  });

  it('shows lat/lon + true bearing + length when geo is live', () => {
    expect(
      endpointReadoutText({
        x: 1,
        z: 2,
        latitude: 37.7749,
        longitude: -122.4194,
        headingDeg: 90,
        lengthText: '60.00m'
      })
    ).toBe('37.774900, -122.419400\n090° T · 60.00m');
  });

  it('falls back to scene x/z and a plain angle without geo', () => {
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
