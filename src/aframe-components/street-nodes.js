/* global THREE */
/**
 * Street end nodes, read off a live managed-street entity (#1930 pillar 1).
 *
 * The ONE DOM-facing reader of "where does this street start and end":
 * managed-intersection's arm collection and the derived `street-graph`
 * system both come here instead of re-deriving the endpoint math. The pure
 * part (length alignment, width alignment) is street-nodes-utils.js; this
 * module adds the curved case — a street that owns a centerline
 * (`managed-street.points`) has its nodes at the curve's end frames — and
 * the transform into world space.
 *
 * Node vectors, per end:
 *   position — the node point (centerline × travelled-way center)
 *   along    — unit direction from the node INTO the street body (the way
 *              the street extends away from that end). Intersection arms use
 *              exactly this as their `dir` ("from the intersection along the
 *              street", managed-intersection-utils.js).
 *   right    — the street-local +X analogue at that end (lateral axis),
 *              along which street-align width offsets apply.
 */
import { getTravelledWaySegments } from './street-layout-utils';
import { getStreetNodes } from '../tested/street-nodes-utils.js';

/** Travelled-way width (sum of non-boundary segment widths). */
export function travelledWayWidth(streetEl) {
  return getTravelledWaySegments(streetEl).reduce(
    (sum, seg) => sum + (seg.getAttribute('street-segment')?.width || 0),
    0
  );
}

/**
 * End nodes in STREET-LOCAL space, or null when the street has no usable
 * endpoints: a curved street whose curve hasn't resolved yet, or a closed
 * loop (no ends at all).
 *
 * @returns {{ curved: boolean, centerX: number, totalWidth: number,
 *   start: LocalNode, end: LocalNode } | null} where LocalNode is
 *   `{ key, position: THREE.Vector3, along: THREE.Vector3, right: THREE.Vector3 }`
 */
export function getStreetEndNodesLocal(streetEl) {
  const ms = streetEl?.components?.['managed-street'];
  if (!ms) return null;
  const align = streetEl.getAttribute('street-align') || {};
  const totalWidth = travelledWayWidth(streetEl);
  const straight = getStreetNodes({
    length: ms.data.length,
    lengthAlign: align.length,
    widthAlign: align.width,
    totalWidth
  });
  const centerX = straight.centerX;

  // A street is curved exactly when its owned centerline resolved to a
  // curve. `points` that collapse to under a metre of arc leave no curve,
  // and the street renders (and so reports its nodes) straight.
  const curve = ms.streetCurve;
  if (curve) {
    if (curve.closed) return null;
    const sampler = curve.sampler;
    const node = (key, s, sign) => {
      const frame = sampler.frameAtS(s);
      return {
        key,
        position: frame.position.clone().addScaledVector(frame.right, centerX),
        along: frame.tangent.clone().multiplyScalar(sign),
        right: frame.right.clone()
      };
    };
    return {
      curved: true,
      centerX,
      totalWidth,
      // The body extends along the tangent from s = 0 and against it at the
      // far end. The far end is the street's `length`, not the curve's arc
      // length: content spans s in [0, length], and a manual length edit
      // trims the street short of the curve's end or extends it straight
      // past it (frameAtS extrapolates along the end tangent).
      start: node('start', 0, 1),
      end: node('end', Number(ms.data.length) || 0, -1)
    };
  }

  const node = (n) => ({
    key: n.key,
    position: new THREE.Vector3(n.x, 0, n.z),
    // street-local +Z runs start → end
    along: new THREE.Vector3(0, 0, n.key === 'start' ? 1 : -1),
    right: new THREE.Vector3(1, 0, 0)
  });
  return {
    curved: false,
    centerX,
    totalWidth,
    start: node(straight.start),
    end: node(straight.end)
  };
}

/**
 * End nodes in WORLD space (positions transformed by the street's matrix;
 * `along` and `right` as horizontal unit directions). Same null cases as
 * getStreetEndNodesLocal.
 */
export function getStreetEndNodesWorld(streetEl) {
  const local = getStreetEndNodesLocal(streetEl);
  if (!local) return null;
  const obj = streetEl.object3D;
  obj.updateWorldMatrix(true, false);
  const toWorld = (n) => {
    const position = n.position.clone();
    obj.localToWorld(position);
    const along = n.along.clone().transformDirection(obj.matrixWorld);
    along.y = 0;
    if (along.lengthSq() > 1e-12) along.normalize();
    const right = n.right.clone().transformDirection(obj.matrixWorld);
    right.y = 0;
    if (right.lengthSq() > 1e-12) right.normalize();
    return { key: n.key, position, along, right };
  };
  return {
    curved: local.curved,
    centerX: local.centerX,
    totalWidth: local.totalWidth,
    start: toWorld(local.start),
    end: toWorld(local.end)
  };
}
