import { describe, expect, it } from 'vitest';
import {
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
});
