/* global describe, it */

const assert = require('assert');
const {
  pickReverseGeocodeResult
} = require('../../public/functions/reverse-geocode.js');

// Bogotá city center, as Google geocodes the search "bogota" (#2113).
const LAT = 4.7109886;
const LON = -74.072092;

const result = (name, lat, lng, half = 0.0013) => ({
  formatted_address: name,
  geometry: {
    location: { lat, lng },
    viewport: {
      northeast: { lat: lat + half, lng: lng + half },
      southwest: { lat: lat - half, lng: lng - half }
    }
  }
});

// Trimmed from Google's real response for the point above: a Hanoi street
// address comes back ahead of the Bogotá ones.
const hanoi = result('87 Đ. Vân Nội, Hà Nội, Vietnam', 21.1587418, 105.8157075);
const carrera = result(
  'Cra. 70a #73-92, Bogotá, Colombia',
  4.7110448,
  -74.0723361
);

describe('pickReverseGeocodeResult', () => {
  it('skips a result from the other side of the world', () => {
    assert.strictEqual(
      pickReverseGeocodeResult([hanoi, carrera], LAT, LON),
      carrera
    );
  });

  it('keeps a large area whose viewport holds the point', () => {
    // A locality centroid can sit kilometers from the point.
    const city = result('Bogotá, Colombia', 4.6, -74.1, 0.3);
    assert.strictEqual(pickReverseGeocodeResult([hanoi, city], LAT, LON), city);
  });

  it('keeps a nearby result whose viewport just misses the point', () => {
    const nextDoor = result('Next door', LAT + 0.005, LON, 0.001);
    assert.strictEqual(
      pickReverseGeocodeResult([nextDoor], LAT, LON),
      nextDoor
    );
  });

  it('handles a viewport crossing the antimeridian', () => {
    const fiji = {
      geometry: {
        location: { lat: -17, lng: 179 },
        viewport: {
          northeast: { lat: -16, lng: -179 },
          southwest: { lat: -18, lng: 177 }
        }
      }
    };
    assert.strictEqual(pickReverseGeocodeResult([fiji], -17, -179.5), fiji);
    assert.strictEqual(pickReverseGeocodeResult([fiji], -17, 170), null);
  });

  it('returns null when nothing describes the point', () => {
    assert.strictEqual(pickReverseGeocodeResult([hanoi], LAT, LON), null);
    assert.strictEqual(pickReverseGeocodeResult(undefined, LAT, LON), null);
  });
});
