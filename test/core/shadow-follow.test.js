/* global describe, it */
import assert from 'assert';
import {
  pickShadowStep,
  shadowFocus,
  shadowSettings,
  snapToShadowTexels
} from '../../src/tested/shadow-follow.js';

const v = (x, y, z) => ({ x, y, z });
const norm = (p) => {
  const l = Math.hypot(p.x, p.y, p.z);
  return v(p.x / l, p.y / l, p.z / l);
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('shadowFocus', () => {
  it('focuses on the ground point a downward camera looks at', () => {
    const out = shadowFocus(v(0, 10, 0), norm(v(1, -1, 0)), 21, 0, v(0, 0, 0));
    close(out.x, 10);
    close(out.y, 0);
    close(out.z, 0);
  });

  it('clamps the focus to the reach for a level or upward view', () => {
    for (const dir of [v(0, 0, -1), norm(v(0, 1, -1)), norm(v(0, -0.01, -1))]) {
      const out = shadowFocus(v(5, 2, 5), dir, 21, 0, v(0, 0, 0));
      close(out.x, 5);
      close(out.z, 5 - 21);
    }
  });

  it('focuses under a camera looking straight down or up', () => {
    for (const dir of [v(0, -1, 0), v(0, 1, 0)]) {
      const out = shadowFocus(v(3, 300, -4), dir, 21, 0, v(9, 9, 9));
      close(out.x, 3);
      close(out.y, 0);
      close(out.z, -4);
    }
  });

  it('falls back to the reach when the camera is below the ground', () => {
    const out = shadowFocus(v(0, -5, 0), norm(v(1, -1, 0)), 21, 0, v(0, 0, 0));
    close(out.x, 21);
  });
});

describe('snapToShadowTexels', () => {
  const lightDir = norm(v(40, -55, 43));
  const t = shadowSettings({ mobile: false }).steps[0].texelSize;

  it('moves a point less than one texel diagonal', () => {
    const p = v(12.3456, 0, -7.891);
    const out = snapToShadowTexels(p, lightDir, t, v(0, 0, 0));
    assert.ok(
      Math.hypot(...Object.values(sub(out, p))) <= t * Math.SQRT1_2 + 1e-9
    );
  });

  it('keeps the offset along the light direction', () => {
    const p = v(12.3456, 0, -7.891);
    const out = snapToShadowTexels(p, lightDir, t, v(0, 0, 0));
    close(dot(out, lightDir), dot(p, lightDir));
  });

  it('maps nearby points to the same texel and is idempotent', () => {
    // a sits at a texel centre, so a nudge of 0.1 texel stays in its texel.
    const a = snapToShadowTexels(v(1, 0, 1), lightDir, t, v(0, 0, 0));
    const b = snapToShadowTexels(
      v(a.x + t * 0.1, a.y, a.z),
      lightDir,
      t,
      v(0, 0, 0)
    );
    // Same texel: the two differ only along the light direction.
    const d = sub(b, a);
    const along = dot(d, lightDir);
    close(Math.hypot(d.x, d.y, d.z), Math.abs(along));
    const c = snapToShadowTexels(a, lightDir, t, v(0, 0, 0));
    for (const k of ['x', 'y', 'z']) close(a[k], c[k], 1e-6);
  });

  it('handles a sun straight overhead', () => {
    const out = snapToShadowTexels(v(0.1, 0, 0.1), v(0, -1, 0), t, v(0, 0, 0));
    assert.ok([out.x, out.y, out.z].every(Number.isFinite));
  });
});

describe('shadowSettings', () => {
  it('uses a 4096 map on desktop and 2048 on mobile over the same area', () => {
    const desktop = shadowSettings({ mobile: false });
    const mobile = shadowSettings({ mobile: true });
    assert.strictEqual(desktop.mapSize, 4096);
    assert.strictEqual(mobile.mapSize, 2048);
    const [near] = desktop.steps;
    assert.strictEqual(near.halfExtent, mobile.steps[0].halfExtent);
    close(near.texelSize, (2 * near.halfExtent) / 4096);
    assert.ok(near.texelSize < 0.035);
  });

  it('never exceeds the GPU maximum texture size', () => {
    const s = shadowSettings({ mobile: false, maxTextureSize: 2048 });
    assert.strictEqual(s.mapSize, 2048);
  });
});

describe('shadow steps', () => {
  const { steps } = shadowSettings({ mobile: false });

  it('grows the box with height: 30 m, 200 m, then off above 500 m', () => {
    assert.deepStrictEqual(
      steps.map((step) => step.upTo),
      [30, 200, 500]
    );
    assert.strictEqual(pickShadowStep(1.7, 0, steps), 0);
    assert.strictEqual(pickShadowStep(120, 0, steps), 1);
    assert.strictEqual(pickShadowStep(300, 0, steps), 2);
    assert.strictEqual(pickShadowStep(600, 0, steps), 3);
  });

  it('waits below a boundary before stepping back down', () => {
    assert.strictEqual(pickShadowStep(29, 1, steps), 1);
    assert.strictEqual(pickShadowStep(26, 1, steps), 0);
    assert.strictEqual(pickShadowStep(480, 3, steps), 3);
    assert.strictEqual(pickShadowStep(100, 3, steps), 1);
    assert.strictEqual(pickShadowStep(10, 3, steps), 0);
  });

  it('keeps every corner of the ground in front of the light', () => {
    // Ground across a box tilted toward a sun 40 degrees up spans about
    // halfExtent / tan(40) in depth either side of the focus.
    const spread = (h) => h / Math.tan((40 * Math.PI) / 180);
    for (const step of steps) {
      assert.ok(step.distance - spread(step.halfExtent) > 50);
      assert.ok(step.far - step.distance > spread(step.halfExtent));
    }
  });
});
