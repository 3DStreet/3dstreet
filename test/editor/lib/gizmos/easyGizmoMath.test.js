import { describe, it, expect } from 'vitest';
import {
  chevronLayout,
  computeDodge,
  decideEasyPress,
  dodgeExtents,
  elevationAngleDegrees,
  flatArcLift,
  latchByHysteresis,
  offsetConvexPolygon,
  squareSideMetres
} from '@/editor/lib/gizmos/easyGizmoMath.js';
import {
  ARC_LIFT_SYMMETRIC,
  SQUARE_MIN_METRES
} from '@/editor/lib/gizmos/easyGizmoConstants.js';

describe('latchByHysteresis', () => {
  it('enters below the lower figure and leaves above the upper', () => {
    expect(latchByHysteresis(9, 10, 12, false)).toBe(true);
    expect(latchByHysteresis(13, 10, 12, true)).toBe(false);
  });

  it('holds between them, in either direction', () => {
    expect(latchByHysteresis(11, 10, 12, true)).toBe(true);
    expect(latchByHysteresis(11, 10, 12, false)).toBe(false);
  });

  it('seeds from a plain midpoint threshold when there is no previous state', () => {
    expect(latchByHysteresis(10.9, 10, 12, null)).toBe(true);
    expect(latchByHysteresis(11.1, 10, 12, undefined)).toBe(false);
  });
});

describe('the sizing law', () => {
  it('is a geometric mean, so doubling the camera distance grows it by root two', () => {
    // Both limbs are power laws in camera distance — a world-anchored size is
    // constant in it, a screen-anchored one linear — so their geometric mean is
    // a fixed exponent, and the ratio below holds wherever you start.
    const near = squareSideMetres(0.01);
    const far = squareSideMetres(0.02);
    expect(far / near).toBeCloseTo(Math.SQRT2, 6);
  });

  it('reports nothing usable rather than zero for a degenerate viewport', () => {
    // A zero would not merely draw a small square: S is the unit every dodge
    // threshold is expressed in, so all three would collapse and a shift would
    // become a negative offset.
    expect(squareSideMetres(0)).toBeNull();
    expect(squareSideMetres(NaN)).toBeNull();
  });

  it('clamps far outside any working zoom', () => {
    expect(squareSideMetres(1e-12)).toBe(SQUARE_MIN_METRES);
  });
});

describe('the regime anchor', () => {
  // Each subsystem decides from the angle to its OWN anchor, which is why a
  // flattened move square alongside an unflattened landing square is a correct
  // state rather than a defect. With the camera level the two differ by 14
  // degrees, and a build reading the camera's PITCH instead returns the same
  // answer for both — invisible to any check made in this scene.
  const camera = { x: 0, y: 0, z: 0 };

  it('flattens an object anchor two metres above the level camera', () => {
    const anchor = { x: 0, y: 2, z: -15 };
    expect(Math.abs(elevationAngleDegrees(camera, anchor))).toBeCloseTo(
      7.59,
      2
    );
  });

  it('leaves a landing anchor six metres below the same camera unflattened', () => {
    const anchor = { x: 0, y: -6, z: -15 };
    expect(Math.abs(elevationAngleDegrees(camera, anchor))).toBeCloseTo(
      21.8,
      2
    );
  });

  it('is symmetric, because looking up foreshortens as much as looking along', () => {
    const up = elevationAngleDegrees(camera, { x: 0, y: 5, z: -15 });
    const down = elevationAngleDegrees(camera, { x: 0, y: -5, z: -15 });
    expect(up).toBeCloseTo(-down, 9);
  });
});

describe('the dodge extents', () => {
  it('keeps a flattened landing bar 0.26 S from the strip, at both scales', () => {
    for (const S of [1.5, 6.3]) {
      expect(dodgeExtents(S, 0, 1).stripClear).toBeCloseTo(0.26 * S, 12);
    }
  });

  it('clears the flattened arc by the arrowheads, its own heads and a gap', () => {
    // Flattened arrowheads are 0.4 S across, the arc's heads 0.16/0.05 of a
    // tube of 0.06 S, and the gap 0.04 S.
    const S = 1.5;
    expect(dodgeExtents(S, 0, 1).clearance).toBeCloseTo(
      (0.2 + 0.04 + 0.192) * S,
      12
    );
  });

  it('follows the tube to its pixel minimum when zoomed far out', () => {
    const S = 1.5;
    const mpp = 0.1; // 3 px of tube is 0.3 m, well over 0.06 S
    const { tubeWorld, clearance } = dodgeExtents(S, mpp, 1);
    expect(tubeWorld).toBeCloseTo(0.3, 12);
    expect(clearance).toBeCloseTo(0.24 * S + (0.16 / 0.05) * 0.3, 12);
  });
});

describe('the dodge rules', () => {
  // The clearance is a fraction of S, and S runs about 1.5 m at an 8 m camera
  // to 6.3 m at 150 m — so each rule is run at both ends of that range and the
  // trigger distance must scale with it.
  const SMALL = 1.5;
  const LARGE = 6.3;
  const clear = (S) => dodgeExtents(S, 0, 1).stripClear;

  const dodge = (S, gapBelow, gapAbove, flipArc = null) =>
    computeDodge({
      stripClear: clear(S),
      gapBelow,
      gapAbove,
      latches: flipArc === null ? null : { flipArc }
    });

  it('shifts the handle up off a bar close below, and down off one close above', () => {
    for (const S of [SMALL, LARGE]) {
      const gap = clear(S) * 0.5;
      expect(dodge(S, gap, null).shift).toBeCloseTo(clear(S) - gap, 9);
      expect(dodge(S, null, gap).shift).toBeCloseTo(-(clear(S) - gap), 9);
    }
  });

  it('leaves the handle where it is once a bar is clear of the strip', () => {
    for (const S of [SMALL, LARGE]) {
      expect(dodge(S, clear(S) * 1.01, null).shift).toBe(0);
      expect(dodge(S, null, clear(S) * 1.01).shift).toBe(0);
    }
  });

  it('lets the nearer bar win when both are close', () => {
    const S = SMALL;
    const near = clear(S) * 0.3;
    const far = clear(S) * 0.9;
    expect(dodge(S, near, far).shift).toBeGreaterThan(0);
    expect(dodge(S, far, near).shift).toBeLessThan(0);
  });

  it('never seats the handle on the bar it did not dodge', () => {
    // With bars a few centimetres below and a little way above — the
    // configuration the small landing gate makes common — the dodge moves the
    // handle toward the upper bar, and must stop short of it.
    const S = SMALL;
    const below = 0.02;
    const above = 1.0 * S;
    const { shift } = dodge(S, below, above);
    expect(shift).toBeGreaterThan(0);
    expect(below + shift).toBeGreaterThanOrEqual(clear(S) - 1e-9);
    expect(above - shift).toBeGreaterThanOrEqual(clear(S) - 1e-9);
  });

  it('clears the nearer bar when no position clears both', () => {
    const S = SMALL;
    const below = 0.02;
    const above = 0.05;
    const { shift } = dodge(S, below, above);
    expect(below + shift).toBeCloseTo(clear(S), 9);
  });

  it('puts the arc above the strip with a bar only below, and below with a bar only above', () => {
    for (const S of [SMALL, LARGE]) {
      for (const previous of [false, true]) {
        expect(dodge(S, 0.15, null, previous).flipArc).toBe(true);
        expect(dodge(S, 5 * S, null, previous).flipArc).toBe(true);
        expect(dodge(S, null, 0.15, previous).flipArc).toBe(false);
      }
    }
  });

  it('returns the arc below the strip once there is no bar either side', () => {
    expect(dodge(SMALL, null, null, true).flipArc).toBe(false);
    expect(dodge(SMALL, null, null, false).flipArc).toBe(false);
    expect(dodge(SMALL, null, null).shift).toBe(0);
  });

  it('sends the arc toward the farther of two bars, past the hysteresis', () => {
    const S = SMALL;
    // Both bars clear of the strip, so there is no shift and the room each side
    // is its gap.
    expect(dodge(S, 1 * S, 2 * S, false).flipArc).toBe(true);
    expect(dodge(S, 1.9 * S, 2 * S, false).flipArc).toBe(false);
    expect(dodge(S, 2 * S, 1.6 * S, true).flipArc).toBe(false);
    expect(dodge(S, 2 * S, 1.9 * S, true).flipArc).toBe(true);
  });

  it('measures the room each side from where the dodge put the handle', () => {
    // S = 1 keeps the numbers readable: a strip clearance of 0.26, a bar 0.16
    // below and one 0.30 above. No position clears both, so the handle clears
    // the nearer bar and rises 0.10, which leaves 0.26 below and 0.20 above.
    // On the raw gaps the arc would have gone up.
    const result = computeDodge({
      stripClear: clear(1),
      gapBelow: 0.16,
      gapAbove: 0.3,
      latches: { flipArc: false }
    });
    expect(result.shift).toBeCloseTo(0.1, 9);
    expect(result.flipArc).toBe(false);
  });
});

describe('the flattened arc lift', () => {
  const S = 1.5;

  it('is zero within about 1.9 degrees of level, in either form', () => {
    for (const deg of [0, 1, -1, 1.9, -1.9]) {
      for (const side of [1, -1]) {
        expect(flatArcLift(S, deg, side, true)).toBe(0);
        expect(flatArcLift(S, deg, side, false)).toBe(0);
      }
    }
  });

  it('matches reference values at 6 and 12 degrees', () => {
    expect(flatArcLift(1, 6, 1)).toBeCloseTo(0.108, 3);
    expect(flatArcLift(1, 12, 1)).toBeCloseTo(0.269, 3);
    expect(flatArcLift(S, 12, 1)).toBeCloseTo(0.269 * S, 3);
  });

  it('is the same from above and below, on either side, in the symmetric form', () => {
    const lift = flatArcLift(S, 8, 1, true);
    expect(lift).toBeGreaterThan(0);
    for (const [deg, side] of [
      [-8, 1],
      [8, -1],
      [-8, -1]
    ]) {
      expect(flatArcLift(S, deg, side, true)).toBe(lift);
    }
  });

  it('applies only when the camera and the arc are on the same side, in the side-signed form', () => {
    // Outside the dead band, where the symmetric form does lift.
    expect(flatArcLift(1, 6, -1, true)).toBeCloseTo(0.108, 3);
    expect(flatArcLift(1, 6, -1, false)).toBe(0);
    expect(flatArcLift(1, -6, 1, false)).toBe(0);
    expect(flatArcLift(1, 6, 1, false)).toBe(flatArcLift(1, 6, 1, true));
    expect(flatArcLift(1, -6, -1, false)).toBe(flatArcLift(1, -6, -1, true));
  });

  it('takes its form from the shared setting by default', () => {
    expect(flatArcLift(1, 6, -1)).toBe(
      flatArcLift(1, 6, -1, ARC_LIFT_SYMMETRIC)
    );
  });

  it('stops growing past 30 degrees', () => {
    for (const deg of [30, 45, 80]) {
      expect(flatArcLift(1, deg, 1)).toBeCloseTo(0.816, 3);
    }
  });
});

describe('the chevron stack', () => {
  it('does not flicker its count when zoom oscillates around a half-step', () => {
    let count = chevronLayout(2, 1).count;
    for (const span of [2.49, 2.51, 2.48, 2.52]) {
      count = chevronLayout(span, 1, count).count;
      expect(count).toBe(2);
    }
    count = chevronLayout(2.7, 1, count).count;
    expect(count).toBe(3);
    expect(chevronLayout(2.49, 1, count).count).toBe(3);
    expect(chevronLayout(2.3, 1, count).count).toBe(2);
  });
  it('divides the gap rather than laying out from one end', () => {
    const { count, step } = chevronLayout(2, 0.5);
    expect(count).toBe(4);
    expect(count * step).toBeCloseTo(2, 9);
  });

  it('resolves to a single mark at the smallest gaps and caps at the largest', () => {
    expect(chevronLayout(0.05, 0.5).count).toBe(1);
    expect(chevronLayout(400, 0.5).count).toBe(8);
  });
});

describe('decideEasyPress', () => {
  const base = {
    targetIsCanvas: true,
    alreadyClaimed: false,
    otherAffordanceHit: false,
    hit: true,
    inert: false
  };

  it('ignores a press that is not on the canvas', () => {
    expect(decideEasyPress({ ...base, targetIsCanvas: false })).toBe('ignore');
  });

  it('ignores a press with another editing affordance under the cursor', () => {
    expect(decideEasyPress({ ...base, otherAffordanceHit: true })).toBe(
      'ignore'
    );
  });

  it('ignores a press while one is already claimed', () => {
    expect(decideEasyPress({ ...base, alreadyClaimed: true })).toBe('ignore');
  });

  it('ignores a press that hits nothing, so selection proceeds normally', () => {
    expect(decideEasyPress({ ...base, hit: false })).toBe('ignore');
  });

  it('swallows a press on a control that is mid-transition', () => {
    // It must not fall through: pressing the gizmo while it changes shape would
    // otherwise deselect the object.
    expect(decideEasyPress({ ...base, inert: true })).toBe('swallow');
  });

  it('claims a press on a live control', () => {
    expect(decideEasyPress(base)).toBe('claim');
  });
});

describe('offsetConvexPolygon', () => {
  /** Signed distance of point (x, y) from the line through a and b, positive
   * on the side away from `inside`. */
  function outwardDistance(ax, ay, bx, by, x, y, inside) {
    const len = Math.hypot(bx - ax, by - ay);
    const cross = (px, py) =>
      ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / len;
    return -Math.sign(cross(inside[0], inside[1])) * cross(x, y);
  }

  for (const [label, square] of [
    ['anticlockwise', [0, 0, 2, 0, 2, 2, 0, 2]],
    ['clockwise', [0, 0, 0, 2, 2, 2, 2, 0]]
  ]) {
    it(`moves each side by its own offset, ${label}`, () => {
      const offsets = [0.1, 0.2, -0.3, 0.4];
      const out = offsetConvexPolygon(square, offsets);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        // Both ends of offset side i lie on the original side i's line, moved
        // out by offsets[i].
        for (const k of [i, j]) {
          expect(
            outwardDistance(
              square[2 * i],
              square[2 * i + 1],
              square[2 * j],
              square[2 * j + 1],
              out[2 * k],
              out[2 * k + 1],
              [1, 1]
            )
          ).toBeCloseTo(offsets[i], 12);
        }
      }
    });
  }

  it('handles a triangle, and uses only the vertices it is told to', () => {
    const points = [0, 0, 4, 0, 2, 3, 99, 99];
    const out = offsetConvexPolygon(points, [0.5, 0.5, 0.5, 0], [], 3);
    expect(out).toHaveLength(6);
    expect(outwardDistance(0, 0, 4, 0, out[0], out[1], [2, 1])).toBeCloseTo(
      0.5,
      12
    );
    expect(outwardDistance(2, 3, 0, 0, out[0], out[1], [2, 1])).toBeCloseTo(
      0.5,
      12
    );
  });
});
