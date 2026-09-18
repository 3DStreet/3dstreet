import { describe, it, expect } from 'vitest';
import {
  chevronLayout,
  computeDodge,
  decideEasyPress,
  elevationAngleDegrees,
  latchByHysteresis,
  squareSideMetres
} from '@/editor/lib/gizmos/easyGizmoMath.js';
import {
  ARC_NEAR_FRAC,
  ARC_REACH_FRAC,
  SQUARE_MIN_METRES,
  STRIP_HALF_FRAC
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

describe('the dodge rules', () => {
  // Every threshold is a fraction of S, and S runs about 1.5 m at an 8 m camera
  // to 6.3 m at 150 m — so each rule is run at both ends of that range and the
  // trigger distance must scale with it. A metres-hardcoded build fires at the
  // same absolute gap in both and flips these; a single fixture at S = 1 could
  // not tell the two apart.
  const SMALL = 1.5;
  const LARGE = 6.3;

  const dodge = (S, gapBelow, gapAbove) =>
    computeDodge({ S, gapBelow, gapAbove, latches: null });

  it('flips the arc above for a bar within the arc reach below, at both scales', () => {
    for (const S of [SMALL, LARGE]) {
      expect(dodge(S, ARC_REACH_FRAC * S * 0.6, null).flipArc).toBe(true);
      expect(dodge(S, ARC_REACH_FRAC * S * 1.4, null).flipArc).toBe(false);
    }
  });

  it('does not flip when a bar is in reach on both sides', () => {
    // No side is clear, so the design takes the side it would have taken
    // anyway rather than trading one occlusion for another.
    for (const S of [SMALL, LARGE]) {
      const gap = ARC_REACH_FRAC * S * 0.6;
      expect(dodge(S, gap, gap).flipArc).toBe(false);
    }
  });

  it('closes the band between the two thresholds above the base', () => {
    // A bar between the strip's scale and the arc's reach ABOVE the base fires
    // neither shift rule, and a flip keyed on anything looser than the arc's
    // own reach would seat the arc straight onto it.
    for (const S of [SMALL, LARGE]) {
      const above = ((ARC_NEAR_FRAC + ARC_REACH_FRAC) / 2) * S;
      expect(dodge(S, ARC_REACH_FRAC * S * 0.6, above).flipArc).toBe(false);
    }
  });

  it('shifts the handle up off a bar close below, and down off one close above', () => {
    for (const S of [SMALL, LARGE]) {
      const gap = ARC_NEAR_FRAC * S * 0.5;
      expect(dodge(S, gap, null).shift).toBeCloseTo(ARC_NEAR_FRAC * S - gap, 9);
      expect(dodge(S, null, gap).shift).toBeCloseTo(
        -(ARC_NEAR_FRAC * S - gap),
        9
      );
    }
  });

  it('lets the nearer bar win when both shift rules apply', () => {
    const S = SMALL;
    const near = ARC_NEAR_FRAC * S * 0.3;
    const far = ARC_NEAR_FRAC * S * 0.9;
    expect(dodge(S, near, far).shift).toBeGreaterThan(0);
    expect(dodge(S, far, near).shift).toBeLessThan(0);
  });

  it('clamps the shift so it never seats the handle on the bar it did not dodge', () => {
    // The winning shift moves the handle TOWARD the loser's bar by up to the
    // strip's own scale, and with bars a few centimetres either side — the
    // configuration the small landing gate makes common — that is the ordinary
    // case rather than a corner.
    const S = SMALL;
    const below = 0.02;
    const above = 0.5 * S;
    const { shift } = dodge(S, below, above);
    expect(below + shift).toBeGreaterThanOrEqual(STRIP_HALF_FRAC * S - 1e-9);
    expect(above - shift).toBeGreaterThanOrEqual(STRIP_HALF_FRAC * S - 1e-9);
  });

  it('clears the nearer bar when no position clears both', () => {
    const S = SMALL;
    const below = 0.02;
    const above = 0.05;
    const { shift } = dodge(S, below, above);
    expect(below + shift).toBeCloseTo(STRIP_HALF_FRAC * S, 9);
  });

  it('is hysteretic, so a bar hovering on a threshold does not chatter', () => {
    const S = SMALL;
    const onThreshold = ARC_REACH_FRAC * S * 1.05;
    const engaged = computeDodge({
      S,
      gapBelow: ARC_REACH_FRAC * S * 0.5,
      gapAbove: null,
      latches: null
    });
    const held = computeDodge({
      S,
      gapBelow: onThreshold,
      gapAbove: null,
      latches: engaged.latches
    });
    expect(held.flipArc).toBe(true);
  });

  it('offers no shift with nothing near the base', () => {
    expect(dodge(SMALL, null, null).shift).toBe(0);
    expect(dodge(SMALL, null, null).flipArc).toBe(false);
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
