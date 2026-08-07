/* global THREE */
import { describe, it, expect, beforeEach } from 'vitest';
import ShapeReadouts from '../../src/editor/lib/ShapeReadouts.js';
import { MIN_TAP_TARGET_PX } from '../../src/editor/lib/shapeEditRules.js';

// SCOPE NOTE for everything below. jsdom evaluates no stylesheet, and vitest
// never sees the SCSS at all, so nothing here may assert a computed colour,
// background or size — such an assertion could not tell a pass from a
// did-not-run and would be vacuous forever. What these tests own is the CLASS,
// ATTRIBUTE and INLINE-STYLE contract. The visual states (the hover fill, the
// revealed outline, the muted background) are manual-test territory.
//
// This is also why `pointer-events` is written inline in the renderer rather
// than in the stylesheet: its failure mode is that the draw tool stops
// accepting points, which is the last property that should be left with no
// check that can fail.

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

describe('ShapeReadouts.renderAll — pinned segments', () => {
  let readouts;

  beforeEach(() => {
    readouts = new ShapeReadouts(stubEntity());
  });

  // The requirement in one assertion: a pin must be applied BEFORE the cap
  // logic, not inside its cursor-dependent branch. Written the wrong way round
  // it inherits the early return above and the pinned captions — which have an
  // on-canvas control standing beside them — go with it.
  it('draws exactly the pinned lengths above the cap with no cursor', () => {
    readouts.renderAll(polygon(13), 12, null, true, [0, 5]);
    expect(readouts.labels.length).toBe(2);
  });

  it('adds nothing below the cap, where every segment is drawn anyway', () => {
    readouts.renderAll(polygon(6), 12, null, true);
    const withoutPin = readouts.labels.length;
    readouts.renderAll(polygon(6), 12, null, true, [0, 5]);
    expect(readouts.labels.length).toBe(withoutPin);
  });

  it('does not double-label the nearest segment when it is also pinned', () => {
    // The cursor sits on segment 0, which is pinned. Without the skip that
    // segment gets two identical captions stacked on one point.
    readouts.renderAll(polygon(13), 12, p(10, 0), true, [0]);
    const pinnedAndHovered = readouts.labels.length;
    readouts.renderAll(polygon(13), 12, p(10, 0), true, [6]);
    expect(pinnedAndHovered).toBe(readouts.labels.length - 1);
  });

  it('ignores out-of-range and negative indices rather than throwing', () => {
    readouts.renderAll(polygon(5), 12, null, true, [-1, 99, 2]);
    // The one valid index is already covered by the below-cap pass, so the
    // assertion that matters is simply that nothing threw and no stray label
    // was produced for an index with no segment.
    readouts.renderAll(polygon(5), 12, null, true);
    const unpinned = readouts.labels.length;
    readouts.renderAll(polygon(5), 12, null, true, [-1, 99, 2]);
    expect(readouts.labels.length).toBe(unpinned);
  });
});

// Every label is an outer/inner pair. A length label with a segment index is a
// control ONLY where the caller supplied an interaction object and that object
// says the side can take a point.
describe('ShapeReadouts — the label DOM contract', () => {
  let readouts;

  beforeEach(() => {
    readouts = new ShapeReadouts(stubEntity());
  });

  const allInsertable = (revealedSegment = null) => ({
    isInsertable: () => true,
    revealedSegment
  });

  const outers = () => readouts.labels.map((l) => l.outer);
  const interactive = () =>
    outers().filter((o) => o.classList.contains('shape-readout--interactive'));

  it('builds an outer/inner pair, with the visible chip on the inner', () => {
    readouts.renderAll(polygon(4), 12, null, true);
    expect(readouts.labels.length).toBeGreaterThan(0);
    for (const { outer, inner } of readouts.labels) {
      expect(outer.classList.contains('shape-readout')).toBe(true);
      expect(inner.classList.contains('shape-readout-label')).toBe(true);
      expect(inner.parentNode).toBe(outer);
      // CAPTION_HALF_PX points at the visible chip, so the chip must stay a
      // distinct element from the box that carries the hit area.
      expect(inner).not.toBe(outer);
    }
  });

  // THE DRAW-CONTEXT GUARANTEE, and the strongest assertion in this file. The
  // same renderer draws the live preview while a shape is being drawn. A chip
  // that took presses there would swallow the click that places a point and
  // would oscillate the preview: the pointer entering it leaves the canvas,
  // which fires the canvas pointerleave that destroys the chip, which returns
  // the pointer to the canvas. A failure here means the draw tool is broken.
  it('renderActive produces labels that are transparent to the pointer', () => {
    readouts.renderActive([p(0, 0), p(3, 0), p(3, 4)]);
    expect(readouts.labels.length).toBeGreaterThan(0);
    for (const outer of outers()) {
      expect(outer.style.pointerEvents).toBe('none');
      expect(outer.dataset.shapeSegment).toBeUndefined();
      expect(outer.style.minHeight).toBe('');
      expect(outer.classList.contains('shape-readout--interactive')).toBe(false);
      expect(outer.classList.contains('shape-readout--muted')).toBe(false);
    }
  });

  it('renderAll with no interaction produces the same', () => {
    readouts.renderAll(polygon(5), 12, null, true);
    expect(readouts.labels.length).toBeGreaterThan(0);
    for (const outer of outers()) {
      expect(outer.style.pointerEvents).toBe('none');
      expect(outer.dataset.shapeSegment).toBeUndefined();
      expect(outer.classList.contains('shape-readout--interactive')).toBe(false);
      expect(outer.classList.contains('shape-readout--muted')).toBe(false);
    }
  });

  it('marks insertable length labels as controls and stamps their segment', () => {
    readouts.renderAll(polygon(5), 12, null, true, null, allInsertable());
    const live = interactive();
    // A closed 5-gon has five sides and five corners.
    expect(live.length).toBe(5);
    expect(readouts.labels.length).toBe(10);
    expect(live.map((o) => Number(o.dataset.shapeSegment)).sort()).toEqual([
      0, 1, 2, 3, 4
    ]);
    for (const outer of live) {
      expect(outer.style.pointerEvents).toBe('auto');
      // The hit-box height comes from the constant, not from a literal typed
      // into a stylesheet no test can read.
      expect(outer.style.minHeight).toBe(`${MIN_TAP_TARGET_PX}px`);
    }
  });

  // Angle captions and the corners they annotate are never controls, whatever
  // the caller passed.
  it('never marks an angle label, even under an interaction', () => {
    readouts.renderAll(polygon(5), 12, null, true, null, allInsertable());
    const angles = outers().filter(
      (o) => !o.classList.contains('shape-readout--interactive')
    );
    expect(angles.length).toBe(5);
    for (const outer of angles) {
      expect(outer.style.pointerEvents).toBe('none');
      expect(outer.dataset.shapeSegment).toBeUndefined();
      expect(outer.classList.contains('shape-readout--muted')).toBe(false);
    }
  });

  // A side too short to take a point is marked and stays transparent — it does
  // whatever clicking that spot does today, which is the behavioural half of
  // "it is not a control".
  it('mutes a non-insertable side and leaves it transparent', () => {
    readouts.renderAll(polygon(5), 12, null, true, null, {
      isInsertable: (i) => i !== 3,
      revealedSegment: null
    });
    const muted = outers().filter((o) =>
      o.classList.contains('shape-readout--muted')
    );
    expect(muted.length).toBe(1);
    expect(muted[0].style.pointerEvents).toBe('none');
    expect(muted[0].dataset.shapeSegment).toBeUndefined();
    expect(muted[0].classList.contains('shape-readout--interactive')).toBe(
      false
    );
    expect(interactive().length).toBe(4);
  });

  // The reveal is one side at a time, and its caption is lifted a band out of
  // the ordinary caption band so a neighbour cannot draw over the number the
  // user must keep sight of while reaching for the button above it.
  it('marks exactly one revealed label and lifts its render order', () => {
    readouts.renderAll(polygon(5), 12, null, true, null, allInsertable(2));
    const revealed = readouts.labels.filter((l) =>
      l.outer.classList.contains('shape-readout--revealed')
    );
    expect(revealed.length).toBe(1);
    expect(Number(revealed[0].outer.dataset.shapeSegment)).toBe(2);
    expect(revealed[0].obj.renderOrder).toBe(1);
    for (const { obj, outer } of readouts.labels) {
      if (outer.classList.contains('shape-readout--revealed')) continue;
      expect(obj.renderOrder).toBe(0);
    }
  });

  // The cost argument for the callback: it is asked only about the sides
  // actually being labelled, so above the cap that is the pins plus the hovered
  // one — not every side of the shape.
  it('asks about the labelled sides only, not about every side', () => {
    const asked = [];
    readouts.renderAll(polygon(13), 12, p(10, 0), true, [0, 5], {
      isInsertable: (i) => {
        asked.push(i);
        return true;
      },
      revealedSegment: null
    });
    const stamped = interactive().map((o) => Number(o.dataset.shapeSegment));
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.length).toBeLessThan(13);
    expect([...asked].sort()).toEqual([...stamped].sort());
  });
});
