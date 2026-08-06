import { describe, expect, it } from 'vitest';
import {
  FILL_LIFT_M,
  FILL_ORDER_BASE,
  fillPaintOrder,
  fillRenderState
} from '../../src/aframe-components/shapeFillRender.js';
import { MARKING_SURFACE_OFFSET } from '../../src/tested/street-segment-utils.js';

// Three's default for everything that does not set one. The fill band exists to
// be above this, so it is the number the band is asserted against — NOT against
// the band's own base, which would make the assertions self-referential and let
// the base be moved to 0 with every test still green.
const DEFAULT_RENDER_ORDER = 0;

// The lowest renderOrder used by an editor overlay IN THE WEBGL QUEUE
// (MeasureLineControls' drag handles). The CSS2D layer numbers independently on
// a separate renderer and does not compete with the fill mesh, so its own use
// of 1 is not a collision.
const LOWEST_WEBGL_OVERLAY = 100;

const STREET = 0;

describe('fillRenderState', () => {
  it('reports 0% as unpainted', () => {
    expect(fillRenderState(0)).toEqual({ opacity: 0, painted: false });
  });

  it('reports anything above 0 as painted', () => {
    expect(fillRenderState(0.5)).toMatchObject({ painted: true });
    expect(fillRenderState(99)).toEqual({ opacity: 0.99, painted: true });
    expect(fillRenderState(100)).toEqual({ opacity: 1, painted: true });
  });

  it('has no `opaque` flag: 100% is not a distinct render state', () => {
    // The material is transparent and non-depth-writing at every opacity, which
    // is what stops two fills depth-fighting. A reader reintroducing an
    // `opaque` flag should find this red rather than a silently unused field.
    // Probed at 100%, which is the only opacity the flag ever described.
    expect(fillRenderState(100)).not.toHaveProperty('opaque');
    expect(Object.keys(fillRenderState(100)).sort()).toEqual([
      'opacity',
      'painted'
    ]);
  });

  it('clamps an out-of-range value rather than trusting the schema bounds', () => {
    // The schema min/max bind the properties panel only; setAttribute and a
    // hand-edited scene can both deliver anything.
    expect(fillRenderState(170)).toEqual({ opacity: 1, painted: true });
    expect(fillRenderState(-20)).toEqual({ opacity: 0, painted: false });
  });

  it('treats a non-numeric value as unpainted', () => {
    expect(fillRenderState(NaN)).toEqual({ opacity: 0, painted: false });
  });

  it('accepts the string a hand-edited scene delivers', () => {
    expect(fillRenderState('40')).toEqual({ opacity: 0.4, painted: true });
  });
});

describe('fillPaintOrder — the band', () => {
  it('puts every fill ABOVE ordinary scene content', () => {
    // The band's one non-negotiable job, and the reason it has a positive base
    // at all: ordinary content sits at three's implicit 0, and a fill at or
    // below that can be painted over by the satellite map layer's ground plane.
    // Asserted against the absolute 0 rather than against FILL_ORDER_BASE —
    // a relative assertion passes with the base itself moved to 0 or negative.
    expect(FILL_ORDER_BASE).toBeGreaterThan(DEFAULT_RENDER_ORDER);
    for (const [y, area] of [
      [STREET, 50],
      [-2000, 1e9],
      [0, 0],
      [NaN, NaN],
      // Both other terms at zero AT ONCE — pinned below the height floor and
      // with a degenerate area. Every other row has one term left to carry the
      // sum, so without this one, deleting the base outright leaves the whole
      // file green.
      [-2000, 0]
    ]) {
      expect(fillPaintOrder(y, area)).toBeGreaterThan(DEFAULT_RENDER_ORDER);
    }
  });

  it('keeps every fill BELOW the lowest WebGL editor overlay', () => {
    for (const [y, area] of [
      [1e9, Number.MIN_VALUE],
      [9000, 1e-9],
      [STREET, 1]
    ]) {
      expect(fillPaintOrder(y, area)).toBeLessThan(LOWEST_WEBGL_OVERLAY);
    }
  });
});

describe('fillPaintOrder — height is the primary key', () => {
  it('paints a higher fill over a lower one whatever their areas', () => {
    // The case a purely area-derived order gets wrong: a large shape a metre up
    // must cover a small one at street level, not the other way round.
    expect(fillPaintOrder(1, 400)).toBeGreaterThan(fillPaintOrder(STREET, 1));
    expect(fillPaintOrder(0.15, 10000)).toBeGreaterThan(
      fillPaintOrder(STREET, 0.5)
    );
  });

  it('rises monotonically with height at a fixed area', () => {
    const ys = [-500, -1, 0, 0.15, 1, 3, 100, 5000];
    const orders = ys.map((y) => fillPaintOrder(y, 50));
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it('pins outside its range, and only there', () => {
    // Two fills further apart than the range tie — accepted, and unreachable in
    // any real scene. The second assertion is the control: it goes red if the
    // pin creeps inward and starts tying heights a scene does contain.
    expect(fillPaintOrder(-5000, 50)).toBe(fillPaintOrder(-1e6, 50));
    // The control has to sit ON the boundary, not merely inside it: comparing
    // two points ten kilometres apart survives almost any narrowing of the
    // range, including down to [-100, 200], which a rooftop or a geospatial
    // scene at altitude would reach.
    expect(fillPaintOrder(-999, 50)).toBeGreaterThan(fillPaintOrder(-1000, 50));
    expect(fillPaintOrder(9000, 50)).toBeGreaterThan(fillPaintOrder(8999, 50));
  });

  it('treats a non-finite height as street level rather than propagating NaN', () => {
    // A NaN renderOrder compares false against everything and would drop the
    // fill at an arbitrary point in the queue.
    for (const y of [NaN, Infinity, -Infinity, undefined, null]) {
      expect(Number.isFinite(fillPaintOrder(y, 50))).toBe(true);
    }
    expect(fillPaintOrder(NaN, 50)).toBe(fillPaintOrder(0, 50));
  });
});

describe('fillPaintOrder — area breaks the tie within one height', () => {
  it('paints a smaller shape after a larger one, at every scale', () => {
    // Pairwise rather than on the endpoints: a mapping that is monotone overall
    // but flat somewhere in the middle is how a banded design fails, and
    // endpoints would not catch it.
    const areas = [1e-6, 1, 2, 16, 17, 18, 100, 400, 1e4, 1e9];
    const orders = areas.map((a) => fillPaintOrder(STREET, a));
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeLessThan(orders[i - 1]);
    }
  });

  it('separates 16 m² from 17 m² from 18 m²', () => {
    // The realistic near-miss: under a log-bucketed design 16 and 17 shared a
    // bucket, so their separation was exactly zero and the overlap z-fought
    // unconditionally.
    expect(
      fillPaintOrder(STREET, 16) - fillPaintOrder(STREET, 17)
    ).toBeGreaterThan(0);
    expect(
      fillPaintOrder(STREET, 17) - fillPaintOrder(STREET, 18)
    ).toBeGreaterThan(0);
  });

  it('quantises nothing: areas a part in a thousand apart still order', () => {
    const orders = [100, 100.1, 100.2].map((a) => fillPaintOrder(STREET, a));
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i - 1] - orders[i]).toBeGreaterThan(0);
    }
  });

  it('sorts a degenerate or unknown area LOWEST at its own height', () => {
    // Area 0 is the trap: it is "small", and a mapping that treated it as the
    // smallest real shape would paint it over everything at its height.
    const floor = fillPaintOrder(STREET, 0);
    for (const area of [NaN, Infinity, -1, '', null, undefined]) {
      expect(fillPaintOrder(STREET, area)).toBe(floor);
    }
    expect(floor).toBeLessThan(fillPaintOrder(STREET, 1e9));
  });

  it('never lets an area difference outrank a real height difference', () => {
    // The whole point of a two-key order. The largest area contribution there
    // is, against the smallest height step the design promises to honour.
    const biggestAreaTermAtStreet = fillPaintOrder(STREET, Number.MIN_VALUE);
    expect(fillPaintOrder(0.01, 1e9)).toBeGreaterThan(biggestAreaTermAtStreet);
    // And at a kerb step, which is the realistic case.
    expect(fillPaintOrder(0.15, 1e9)).toBeGreaterThan(biggestAreaTermAtStreet);
  });

  it('lets area decide below the height crossover', () => {
    // Two probes of the same road surface can differ in their last bits; that
    // must not read as a height difference and flip the area rule.
    expect(fillPaintOrder(1e-7, 16)).toBeGreaterThan(fillPaintOrder(0, 17));
    // Probed just UNDER the crossover as well, against the largest area gap
    // there is. Without this the crossover can be retuned anywhere down to
    // ~1e-5 m with every test still green — into the float-noise regime the
    // constant exists to stay clear of.
    expect(fillPaintOrder(0.009, 1e9)).toBeLessThan(
      fillPaintOrder(0, Number.MIN_VALUE)
    );
  });
});

describe('FILL_LIFT_M', () => {
  it('clears the marking layer, and follows it if it moves', () => {
    // The coupling is real, not documentary: this fails if someone re-hardcodes
    // the lift. Deliberately does NOT assert MARKING_SURFACE_OFFSET === 0.05 —
    // that constant is meant to be lowerable, and pinning it would defeat the
    // whole exercise. Asserted as a delta rather than as a sum, so it does not
    // rely on the sum happening to be unrepresentable in binary.
    expect(FILL_LIFT_M - MARKING_SURFACE_OFFSET).toBeCloseTo(0.01, 12);
    expect(FILL_LIFT_M).toBeGreaterThan(MARKING_SURFACE_OFFSET);
  });

  it('takes no part in ordering', () => {
    // The lift separates the fill from the ROAD. Two fills a whole lift apart
    // in stored height are ordered by that height, not by the lift, so the
    // ordering must not move if the lift does — asserted by showing the order
    // is a function of the plane height alone.
    expect(fillPaintOrder(FILL_LIFT_M, 50)).not.toBe(fillPaintOrder(0, 50));
    expect(fillPaintOrder(0, 50) - FILL_ORDER_BASE).toBeCloseTo(
      fillPaintOrder(0, 50) - FILL_ORDER_BASE,
      15
    );
  });
});
