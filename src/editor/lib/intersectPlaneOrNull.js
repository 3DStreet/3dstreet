/* global THREE */

// Cursor client coordinates → the point where the cursor ray meets `plane`, in
// world space, or null when it does not meet it at all.
//
// Relationship to the older `pick-point-on-ground-plane.js`, which does the same
// job for the y=0 plane: that helper returns a fresh Vector3 on a miss, i.e.
// (0, 0, 0) — a real-looking point at the scene origin that callers cannot
// distinguish from a hit. This one returns null, so a miss is a miss. Prefer
// this module for new code. The old one is left alone because it has several
// call sites that may lean on the origin behaviour.
//
// UNGUARDED, deliberately: `Ray.intersectPlane` returns null only when the ray
// is exactly parallel to the plane or points away from it, so a near-edge-on
// camera still yields a valid hit that can be kilometres from the cursor.
// Whether such a hit is USABLE is a question about the interaction, not about
// the geometry, so it belongs to the caller (see shapeEditRules'
// rayPlaneHitIsUsable) rather than being baked in here — where it would change
// the behaviour of every existing caller.

import { rayFromClientXY } from './rayFromClientXY.js';

// A fresh Vector3 per call rather than shared scratch: callers keep the result
// (a placed vertex position, a grab anchor) well past the current handler, and
// one small allocation per pointer event is not worth the aliasing hazard.
export function intersectPlaneOrNull(clientX, clientY, plane) {
  const ray = rayFromClientXY(clientX, clientY);
  if (!ray) return null;
  const hit = new THREE.Vector3();
  return ray.intersectPlane(plane, hit) ? hit : null;
}
