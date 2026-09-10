/**
 * Flat street ribbons from OSM way centerlines (#1930 demo path).
 *
 * Pure module (no AFRAME/THREE/DOM): turns way records with scene-local
 * `{x, z}` polylines into one merged triangle soup per tile, which
 * `osm-streets` uploads as a single vertex-colored mesh. Replaces the
 * rasterized MVTOverlay tint: crisp at any zoom, true class widths in
 * meters, and the same straight→curved ribbon idea the curved-street work
 * uses, so the mid-LOD ribbon and the upgraded managed street share a
 * centerline.
 *
 * Junctions are handled the cheap way: every way is a flat strip at a
 * class-ordered height (majors slightly above minors, so the higher class
 * wins where two overlap) with round caps at each polyline end so crossing
 * and meeting ways read as joined rather than butted. Overlaps of the same
 * class are coplanar and the same color, so they are invisible.
 */

import { ribbonStyleForClass, roadWidthMeters } from './osm-street-style.js';

// Vertical step between road-class orders, in meters — enough that the
// depth test separates them at streaming-camera distances, small enough
// to read as one surface.
export const CLASS_ORDER_STEP_M = 0.02;

// Round-cap / bend-disc tessellation.
const CAP_SEGMENTS = 10;
// Interior bends sharper than this get a disc to cover the miter pinch.
const BEND_DISC_MIN_DEG = 25;
// Miter length is clamped to this many half-widths at sharp bends.
const MITER_LIMIT = 2;

const EPS = 1e-6;

/** '#rrggbb' → [r, g, b] floats. Exported for tests. */
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.z - p.z) > EPS) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Accumulator for one tile's merged ribbon geometry. Call `addWay` per way
 * record, then read `positions` / `colors` / `indices` (plain arrays;
 * the caller wraps them in typed arrays).
 */
export class RibbonBatch {
  constructor({ baseY = 0 } = {}) {
    this.baseY = baseY;
    this.positions = [];
    this.colors = [];
    this.indices = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  pushVertex(x, y, z, rgb) {
    this.positions.push(x, y, z);
    this.colors.push(rgb[0], rgb[1], rgb[2]);
    return this.vertexCount - 1;
  }

  /**
   * @param {Object} way record with `class` and local `polylines`
   *   ([{x, z}, ...][]).
   * @param {Object} [opts] `width` (m), `y` and `color` ('#rrggbb')
   *   override the class defaults.
   */
  addWay(way, opts = {}) {
    const style = ribbonStyleForClass(way.class);
    const width = opts.width ?? roadWidthMeters(way.class);
    const y = opts.y ?? this.baseY + style.order * CLASS_ORDER_STEP_M;
    const rgb = hexToRgb(opts.color ?? style.color);
    for (const line of way.polylines) {
      this.addPolyline(dedupe(line), width / 2, y, rgb);
    }
  }

  addPolyline(pts, halfWidth, y, rgb) {
    const n = pts.length;
    if (n < 2) return;

    // Unit tangents per segment and left-hand perpendiculars.
    const tx = [];
    const tz = [];
    for (let i = 0; i < n - 1; i++) {
      let dx = pts[i + 1].x - pts[i].x;
      let dz = pts[i + 1].z - pts[i].z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      tx.push(dx);
      tz.push(dz);
    }

    // One left/right vertex pair per polyline point (mitered at bends).
    // Ring vertices must stay contiguous for the index math below, so
    // bend discs are collected here and emitted after the strip.
    const bendDiscs = [];
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const s0 = Math.max(i - 1, 0);
      const s1 = Math.min(i, n - 2);
      // perpendicular of the incoming and outgoing segments: (-tz, tx)
      const p0x = -tz[s0];
      const p0z = tx[s0];
      const p1x = -tz[s1];
      const p1z = tx[s1];
      let mx = p0x + p1x;
      let mz = p0z + p1z;
      const mlen = Math.hypot(mx, mz);
      let scale = halfWidth;
      if (mlen < EPS) {
        // 180° reversal: fall back to the incoming perpendicular.
        mx = p0x;
        mz = p0z;
      } else {
        mx /= mlen;
        mz /= mlen;
        const cosHalf = mx * p0x + mz * p0z;
        scale = halfWidth / Math.max(cosHalf, 1 / MITER_LIMIT);
      }
      const p = pts[i];
      this.pushVertex(p.x + mx * scale, y, p.z + mz * scale, rgb);
      this.pushVertex(p.x - mx * scale, y, p.z - mz * scale, rgb);

      if (i > 0 && i < n - 1) {
        const dot = tx[s0] * tx[s1] + tz[s0] * tz[s1];
        const turnDeg =
          (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
        if (turnDeg > BEND_DISC_MIN_DEG) {
          bendDiscs.push(p);
        }
      }
    }
    // Quads between consecutive pairs, wound to face +y.
    for (let i = 0; i < n - 1; i++) {
      const l0 = base + i * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      this.indices.push(l0, l1, r0, r0, l1, r1);
    }
    for (const p of bendDiscs) this.addDisc(p, halfWidth, y, rgb);
    this.addDisc(pts[0], halfWidth, y, rgb);
    this.addDisc(pts[n - 1], halfWidth, y, rgb);
  }

  addDisc(center, radius, y, rgb) {
    const c = this.pushVertex(center.x, y, center.z, rgb);
    const ring = [];
    for (let k = 0; k < CAP_SEGMENTS; k++) {
      const a = (k / CAP_SEGMENTS) * Math.PI * 2;
      ring.push(
        this.pushVertex(
          center.x + Math.cos(a) * radius,
          y,
          center.z + Math.sin(a) * radius,
          rgb
        )
      );
    }
    for (let k = 0; k < CAP_SEGMENTS; k++) {
      // (center, next, current) faces +y for a CCW ring in x/z.
      this.indices.push(c, ring[(k + 1) % CAP_SEGMENTS], ring[k]);
    }
  }
}

/**
 * Merged ribbon geometry for a set of way records.
 *
 * @returns {{positions: Float32Array, colors: Float32Array,
 *   indices: Uint32Array}} — empty arrays when there is nothing to draw.
 */
export function buildWayRibbons(ways, { baseY = 0, ...wayOpts } = {}) {
  const batch = new RibbonBatch({ baseY });
  for (const way of ways) batch.addWay(way, wayOpts);
  return {
    positions: new Float32Array(batch.positions),
    colors: new Float32Array(batch.colors),
    indices: new Uint32Array(batch.indices)
  };
}
