/* global AFRAME, THREE */

/**
 * street-path: makes a drawn polyline (shape) usable as the centerline path
 * of a managed street. The curve controls (curveType/filletRadius) live on
 * the `shape` component itself — a curve is a property of the drawing, street
 * or no street — and this schema-less role component reads them from there
 * (getCurveOptions) for its followers.
 *
 * Assignment lives on the street side (`managed-street.path` = '#shapeId');
 * assigning auto-attaches this component to the shape when missing. The
 * component re-emits `street-path-changed` (throttled) whenever the path's
 * vertices, its curve settings, or its transform change (curve-setting edits
 * arrive as shape-geometry-changed, via the shape's re-derive); following
 * streets listen and rebuild their curved layout.
 *
 * This file also registers the `street-ribbon` A-Frame geometry — the curved
 * equivalent of the straight below-box — and the placement helpers the
 * street-generated-* components use to bend their content. The pure curve
 * math lives in lib/street-path-utils.js.
 */
import {
  buildRibbonGeometry,
  mapStraightPoint
} from '../tested/street-path-utils.js';

const CHANGE_THROTTLE_MS = 250;

// The shape system ticks even while entities are paused (as they are in the
// editor), so transform watching lives in a system here for the same reason.
AFRAME.registerSystem('street-path', {
  init: function () {
    this.paths = new Set();
    this.followers = new Set(); // managed-street components with active paths
  },
  registerPath: function (comp) {
    this.paths.add(comp);
  },
  unregisterPath: function (comp) {
    this.paths.delete(comp);
  },
  registerFollower: function (comp) {
    this.followers.add(comp);
  },
  unregisterFollower: function (comp) {
    this.followers.delete(comp);
  },
  tick: function () {
    // A path's world vertices move when the whole shape entity is dragged
    // (no vertex event fires), and a street's local-space curve goes stale
    // when the street itself is dragged. Watch both matrices.
    this.paths.forEach((comp) => {
      if (matrixWorldChanged(comp)) comp.emitChanged();
    });
    this.followers.forEach((comp) => {
      if (matrixWorldChanged(comp)) comp.rebuildPathCurve();
    });
  }
});

function matrixWorldChanged(comp) {
  const m = comp.el.object3D.matrixWorld;
  if (!comp._lastMatrixWorld) {
    comp._lastMatrixWorld = m.clone();
    return false;
  }
  if (comp._lastMatrixWorld.equals(m)) return false;
  comp._lastMatrixWorld.copy(m);
  return true;
}

AFRAME.registerComponent('street-path', {
  init: function () {
    this.emitChanged = this.emitChanged.bind(this);
    this._pendingEmit = null;
    this._lastEmit = 0;
    // shape re-derives (and emits) on every vertex or curve-setting edit
    this.el.addEventListener('shape-geometry-changed', this.emitChanged);
    this.system.registerPath(this);
  },

  remove: function () {
    this.el.removeEventListener('shape-geometry-changed', this.emitChanged);
    this.system.unregisterPath(this);
    if (this._pendingEmit) clearTimeout(this._pendingEmit);
    // one final notification so followers straighten out / re-resolve
    this.el.emit('street-path-changed', null, false);
  },

  // Throttled (leading + trailing) so a per-frame vertex drag doesn't rebuild
  // whole streets per frame.
  emitChanged: function () {
    const now = Date.now();
    if (now - this._lastEmit >= CHANGE_THROTTLE_MS) {
      this._lastEmit = now;
      this.el.emit('street-path-changed', null, false);
      return;
    }
    if (this._pendingEmit) return;
    this._pendingEmit = setTimeout(
      () => {
        this._pendingEmit = null;
        this._lastEmit = Date.now();
        this.el.emit('street-path-changed', null, false);
      },
      CHANGE_THROTTLE_MS - (now - this._lastEmit)
    );
  },

  /** World-space path vertices, in draw order. */
  getWorldPathPoints: function () {
    const shape = this.el.components.shape;
    if (shape && typeof shape.getVertexEls === 'function') {
      return shape
        .getVertexEls()
        .map((el) => el.object3D.getWorldPosition(new THREE.Vector3()));
    }
    return [];
  },

  isClosed: function () {
    return !!this.el.components.shape?.data?.closed;
  },

  // The shape's curve settings, in the option shape buildCenterlinePoints
  // takes. Fallbacks match the shape schema defaults, for the window before
  // the shape component has initialized.
  getCurveOptions: function () {
    const d = this.el.components.shape?.data;
    return {
      curveType: d?.curveType ?? 'linear',
      filletRadius: d?.filletRadius ?? 20
    };
  }
});

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
