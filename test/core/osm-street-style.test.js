/* global describe, it */

/**
 * OSM street styling + width heuristics (#1930 demo path): the class→width
 * table feeding both the ground ribbons and the click-to-upgrade importer,
 * and the per-class ribbon style.
 */

import assert from 'assert';
import {
  DEFAULT_ROAD_WIDTH_M,
  ribbonStyleForClass,
  roadWidthMeters
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

describe('ribbonStyleForClass', () => {
  it('gives every drawable class a color and a stacking order', () => {
    for (const cls of ['motorway', 'primary', 'minor', 'service', 'path']) {
      const style = ribbonStyleForClass(cls);
      assert.ok(style.color.startsWith('#'), cls);
      assert.ok(style.order > 0, cls);
    }
  });

  it('stacks higher classes above lower ones', () => {
    assert.ok(
      ribbonStyleForClass('motorway').order > ribbonStyleForClass('minor').order
    );
    assert.ok(
      ribbonStyleForClass('minor').order > ribbonStyleForClass('path').order
    );
  });

  it('falls back to a low-order style for unknown classes', () => {
    const style = ribbonStyleForClass('hoverlane');
    assert.ok(style.color.startsWith('#'));
    assert.strictEqual(style.order, 1);
  });
});
