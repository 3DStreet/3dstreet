/* global AFRAME, THREE */

/**
 * Curved-street rendering helpers + the shape → street copy-in.
 *
 * A managed street OWNS its centerline (`managed-street.points`, #1930
 * pillar 1): this file no longer links streets to shapes. A drawn shape is
 * an authoring tool — `shapeToStreetPoints` reads its vertices (and its
 * curve settings) into the street's local space, and the caller writes them
 * onto the street as `points` / `curveType` / `filletRadius` / `closed`.
 * From then on the street bends along its own data: it moves and rotates
 * with its own transform, and editing or deleting the shape changes nothing.
 *
 * The `street-path` component name is kept registered as an inert marker
 * so scenes saved while shapes carried it (the auto-fitted role component
 * of the linked-path prototype) load without an unknown-component warning.
 *
 * This file also registers the `street-ribbon` A-Frame geometry — the curved
 * equivalent of the straight below-box — and the placement helpers the
 * street-generated-* components use to bend their content. The pure curve
 * math lives in tested/street-path-utils.js.
 */
import {
  buildRibbonGeometry,
  mapStraightPoint
} from '../tested/street-path-utils.js';

AFRAME.registerComponent('street-path', {
  // Deprecated marker (pre-owned-centerline scenes). No behavior.
});

/**
 * Read a shape's vertices as centerline control points in `streetEl`'s
 * local space, with the shape's curve settings. Null when the shape has
 * fewer than two vertices.
 * @returns {{ points: Array<{x,y,z}>, curveType: string, filletRadius: number, closed: boolean } | null}
 */
export function shapeToStreetPoints(shapeEl, streetEl) {
  const shape = shapeEl?.components?.shape;
  if (!shape || typeof shape.getVertexEls !== 'function') return null;
  const worldPts = shape
    .getVertexEls()
    .map((el) => el.object3D.getWorldPosition(new THREE.Vector3()));
  if (worldPts.length < 2) return null;
  streetEl.object3D.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(streetEl.object3D.matrixWorld).invert();
  const points = worldPts.map((p) => {
    p.applyMatrix4(inv);
    return { x: p.x, y: p.y, z: p.z };
  });
  const d = shape.data || {};
  return {
    points,
    curveType: d.curveType ?? 'linear',
    filletRadius: d.filletRadius ?? 20,
    closed: !!d.closed && points.length >= 3
  };
}

// ---------------------------------------------------------------------------
// Curve lookup + placement helpers for street content
// ---------------------------------------------------------------------------

/**
 * The active street curve ({ sampler, zStart, closed, rev }) governing an
 * element (a street, a segment, or generated content inside one), or null.
 */
export function getStreetCurveFor(el) {
  const streetEl = el?.closest?.('[managed-street]');
  return streetEl?.components?.['managed-street']?.streetCurve || null;
}

/**
 * Bend a point computed in SEGMENT-local straight space onto the street
 * curve. Returns the new segment-local {x, y, z} (y is the curve's own
 * elevation, additive to the content's y) plus the yaw (degrees) to add so
 * content faces along the curve — or null when the street is straight.
 */
export function getCurvedPlacement(segmentEl, localX, localZ) {
  const curve = getStreetCurveFor(segmentEl);
  if (!curve) return null;
  const segPos = segmentEl.object3D.position;
  const mapped = mapStraightPoint(
    curve.sampler,
    curve.zStart,
    segPos.x + localX,
    segPos.z + localZ
  );
  return {
    x: mapped.x - segPos.x,
    y: mapped.y,
    z: mapped.z - segPos.z,
    yawDeg: mapped.yawDeg
  };
}

/**
 * Assemble the `geometry` attribute object for a street-ribbon spanning the
 * street's full run, expressed for content that hangs off `segmentEl`
 * (a street-segment or the street itself — pass opts.origin {x,z} to
 * override the default segment-position origin). Returns null when the
 * street is straight (caller falls back to its box/plane geometry).
 */
export function getRibbonGeometryAttr(segmentEl, opts = {}) {
  const streetEl = segmentEl?.closest?.('[managed-street]');
  const curve = streetEl?.components?.['managed-street']?.streetCurve;
  if (!curve || !streetEl.id) return null;
  const isStreet = segmentEl === streetEl;
  const segPos = isStreet ? { x: 0, z: 0 } : segmentEl.object3D.position;
  const origin = opts.origin ?? segPos;
  const sEnd =
    opts.sEnd ??
    (isStreet
      ? streetEl.components['managed-street'].data.length
      : (segmentEl.components['street-segment']?.data.length ??
        curve.sampler.totalLength));
  return {
    primitive: 'street-ribbon',
    skipCache: true,
    streetId: streetEl.id,
    rev: curve.rev,
    originX: origin.x,
    originZ: origin.z,
    lateralCenter: segPos.x + (opts.lateralOffset ?? 0),
    width: opts.width ?? 1,
    height: opts.height ?? 0,
    yTop: opts.yTop ?? 0,
    sStart: opts.sStart ?? 0,
    sEnd,
    slopeLeftDelta: opts.slopeLeftDelta ?? 0,
    slopeRightDelta: opts.slopeRightDelta ?? 0,
    closedLoop: !!curve.closed
  };
}

// ---------------------------------------------------------------------------
// street-ribbon geometry — curved extrusion along a street's active curve
// ---------------------------------------------------------------------------
// The curve itself can't ride through a serializable schema, so the geometry
// resolves it from the street entity by id at build time; `rev` is bumped by
// managed-street on every curve rebuild to force regeneration (always used
// with skipCache: true).

AFRAME.registerGeometry('street-ribbon', {
  schema: {
    streetId: { default: '', type: 'string' },
    rev: { default: 0, type: 'int' },
    lateralCenter: { default: 0 },
    width: { default: 1, min: 0 },
    height: { default: 0.2, min: 0 },
    yTop: { default: 0 },
    originX: { default: 0 },
    originZ: { default: 0 },
    sStart: { default: 0 },
    sEnd: { default: 1 },
    // cross-slope tilt of the top face (see buildRibbonGeometry): left =
    // lateral min (straight -x) edge, right = lateral max (straight +x)
    slopeLeftDelta: { default: 0 },
    slopeRightDelta: { default: 0 },
    closedLoop: { default: false }
  },

  init: function (data) {
    const streetEl = document.getElementById(data.streetId);
    const curve = streetEl?.components?.['managed-street']?.streetCurve;
    if (!curve) {
      // street got straightened (or not yet curved) — build nothing; the
      // owning component re-runs with box/plane geometry on the next change
      this.geometry = new THREE.BufferGeometry();
      return;
    }
    this.geometry = buildRibbonGeometry(curve.sampler, {
      lateralCenter: data.lateralCenter,
      width: data.width,
      height: data.height,
      yTop: data.yTop,
      sStart: data.sStart,
      sEnd: data.sEnd,
      slopeLeftDelta: data.slopeLeftDelta,
      slopeRightDelta: data.slopeRightDelta,
      origin: { x: data.originX, z: data.originZ },
      closedLoop: data.closedLoop
    });
  }
});
