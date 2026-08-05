/* global THREE */
import { describe, it, expect, beforeEach } from 'vitest';
import ShapeReadouts from '../../src/editor/lib/ShapeReadouts.js';

// A stand-in for the shape entity: the renderer only ever reads `object3D` to
// parent its group into.
function stubEntity() {
  return { object3D: new THREE.Group() };
}

const p = (x, z) => new THREE.Vector3(x, 0, z);

// A regular n-gon, so every segment has a real length and every corner a real
// angle — the renderer skips degenerate ones and would otherwise under-count.
function polygon(n, radius = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push(p(radius * Math.cos(t), radius * Math.sin(t)));
  }
  return pts;
}

describe('ShapeReadouts.renderAll — the label cap', () => {
  let readouts;

  beforeEach(() => {
    readouts = new ShapeReadouts(stubEntity());
  });

  it('labels every segment at or below the cap, cursor or no cursor', () => {
    readouts.renderAll(polygon(12), 12, null, true);
    // One length label per segment plus one angle label per corner.
    expect(readouts.labels.length).toBe(24);
  });

  // The mechanism that made the once-only listener binding fatal rather than
  // merely degraded: above the cap with no cursor position, this clears the
  // labels and draws nothing at all. Whatever decides to track the cursor must
  // therefore stay in agreement with the vertex count for the life of a
  // selection — a shape that grows past the cap while selected must not end up
  // on this branch with nothing feeding it.
  it('draws NOTHING above the cap when no cursor position is supplied', () => {
    readouts.renderAll(polygon(13), 12, null, true);
    expect(readouts.labels.length).toBe(0);
  });

  it('labels the segment nearest the cursor above the cap', () => {
    readouts.renderAll(polygon(13), 12, p(10, 0), true);
    // One length label for the nearest segment, one angle at its nearer end.
    expect(readouts.labels.length).toBe(2);
  });

  // Crossing the cap is the transition that matters, and it is reversible:
  // the count is re-read on every render, so shrinking back restores the full
  // set without needing the shape to be reselected.
  it('restores the full set when the shape drops back below the cap', () => {
    readouts.renderAll(polygon(13), 12, p(10, 0), true);
    expect(readouts.labels.length).toBe(2);
    readouts.renderAll(polygon(12), 12, p(10, 0), true);
    expect(readouts.labels.length).toBe(24);
  });
});
