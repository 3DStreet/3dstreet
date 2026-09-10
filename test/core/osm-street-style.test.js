/* global describe, it */

/**
 * OSM street styling + width heuristics (#1930 demo path): the class→width
 * table feeding both the MVT ground overlay and the click-to-upgrade
 * importer, and the per-feature style callback's hide rules.
 */

import assert from 'assert';
import {
  DEFAULT_ROAD_WIDTH_M,
  getRoadOverlayStyle,
  roadWidthMeters,
  strokeWidthPx
} from '../../src/tested/osm-street-style.js';

describe('roadWidthMeters', () => {
  it('orders widths by road class', () => {
    assert.ok(roadWidthMeters('motorway') > roadWidthMeters('primary'));
    assert.ok(roadWidthMeters('primary') > roadWidthMeters('minor'));
    assert.ok(roadWidthMeters('minor') > roadWidthMeters('path'));
  });

  it('falls back to the default for unknown classes', () => {
    assert.strictEqual(roadWidthMeters('hoverlane'), DEFAULT_ROAD_WIDTH_M);
    assert.strictEqual(roadWidthMeters(undefined), DEFAULT_ROAD_WIDTH_M);
  });
});

describe('strokeWidthPx', () => {
  it('scales width by canvas resolution and clamps both ends', () => {
    // z14 tile ≈ 1900 m on a 512px canvas ≈ 3.7 m/px.
    const motorway = strokeWidthPx('motorway');
    const path = strokeWidthPx('path');
    assert.ok(motorway <= 8, `motorway clamped: ${motorway}`);
    assert.ok(path >= 1.25, `path floor: ${path}`);
    assert.ok(motorway > strokeWidthPx('minor'));
    // Double resolution → double pixels for the same physical width.
    const hiRes = strokeWidthPx('minor', { resolution: 1024 });
    assert.ok(hiRes > strokeWidthPx('minor'));
  });
});

describe('getRoadOverlayStyle', () => {
  it('hides every non-transportation layer', () => {
    assert.strictEqual(getRoadOverlayStyle('water', {}).visible, false);
    assert.strictEqual(getRoadOverlayStyle('building', null).visible, false);
  });

  it('answers layer-order queries (null properties) with an order only', () => {
    const style = getRoadOverlayStyle('transportation', null);
    assert.strictEqual(typeof style.order, 'number');
    assert.strictEqual(style.visible, undefined);
  });

  it('hides tunnels and non-street classes', () => {
    assert.strictEqual(
      getRoadOverlayStyle('transportation', {
        class: 'minor',
        brunnel: 'tunnel'
      }).visible,
      false
    );
    assert.strictEqual(
      getRoadOverlayStyle('transportation', { class: 'ferry' }).visible,
      false
    );
  });

  it('strokes drawable classes with a width and order', () => {
    const style = getRoadOverlayStyle('transportation', { class: 'primary' });
    assert.ok(style.stroke.startsWith('#'));
    assert.ok(style.strokeWidth > 0);
    assert.ok(style.order > 0);
  });
});
