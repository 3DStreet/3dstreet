/* global THREE */
import { getTravelledWaySegments } from '@/aframe-components/street-layout-utils';

// Focus framing for a managed street (#1213): look along the street's
// length from just beyond its near end (the same vantage focus always used)
// at a distance derived from the camera's horizontal fov, so the roadway's
// cross-section fills FILL of the viewport width. The generic focus fits the
// bounding sphere, which a long street's length dominates — the camera
// backed off so far the street was a sliver.
//
// Pure of controls state: returns positions in the street's LOCAL frame, or
// null when the entity isn't a managed street with a measurable travelled
// way. Callers transform into world space with the street's matrixWorld.

export const STREET_FOCUS_FILL = 0.9;
// Elevation of the camera above the near-end center, measured from the
// roadway plane; higher shows more of the street's length.
export const STREET_FOCUS_PITCH_DEG = 27;
// Where along the street (0 = near end, 1 = far end) the camera aims. Aiming
// past the near end drops the cross-section into the lower third of the
// frame and keeps the far end in view (the reference composition in #1213).
export const STREET_FOCUS_AIM = 0.2;

// Camera-independent core, unit-tested: how far back (depth, along the
// view) a cross-section of `width` sits to span FILL of the view width.
export function fitDepthForWidth(
  width,
  fovDeg,
  aspect,
  fill = STREET_FOCUS_FILL
) {
  const halfHFovTan = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * aspect;
  return width / (2 * fill * halfHFovTan);
}

// Local-frame layout of the travelled way, mirroring street-align's rules:
// width alignment sets the x extent, length alignment the z extent (see
// managed-street.computeZStart).
export function travelledWayLocalFrame(streetEl) {
  const street = streetEl?.components?.['managed-street'];
  if (!street) return null;
  // A path-following street is laid out along its curve in world space, not
  // in this straight-space frame — the fit would aim at empty ground. Let
  // the generic bounding-box framing handle it.
  if (street.streetCurve) return null;
  const width = getTravelledWaySegments(streetEl).reduce(
    (sum, seg) => sum + (seg.getAttribute('street-segment')?.width || 0),
    0
  );
  if (!(width > 0)) return null;
  const length = street.data.length || 0;
  const align = streetEl.getAttribute('street-align') || {};
  const xCenter =
    align.width === 'left'
      ? width / 2
      : align.width === 'right'
        ? -width / 2
        : 0;
  const zStart =
    align.length === 'start'
      ? -length
      : align.length === 'end'
        ? 0
        : -length / 2;
  return { width, length, xCenter, zStart, zNear: zStart + length };
}

// { position, lookAt } in the street's local frame, or null.
export function streetFocusPoseLocal(streetEl, camera) {
  const frame = travelledWayLocalFrame(streetEl);
  if (!frame || !camera?.isPerspectiveCamera) return null;
  const depth = fitDepthForWidth(frame.width, camera.fov, camera.aspect || 1);
  const pitch = THREE.MathUtils.degToRad(STREET_FOCUS_PITCH_DEG);
  const near = new THREE.Vector3(frame.xCenter, 0, frame.zNear);
  const lookAt = new THREE.Vector3(
    frame.xCenter,
    0,
    frame.zNear - frame.length * STREET_FOCUS_AIM
  );
  // Camera sits behind and above the near end along `dir`. The width fit is
  // defined at the near edge's view-space depth, which depends on the view
  // direction (toward lookAt), which depends on where the camera is — a
  // couple of fixed-point rounds converge to well under a centimetre.
  const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const position = new THREE.Vector3();
  const view = new THREE.Vector3();
  let dist = depth;
  for (let i = 0; i < 4; i++) {
    position.copy(near).addScaledVector(dir, dist);
    view.subVectors(lookAt, position).normalize();
    // depth of `near` along the view = dist * (-dir · view)
    dist = depth / Math.max(0.2, -dir.dot(view));
  }
  position.copy(near).addScaledVector(dir, dist);
  return { position, lookAt };
}

// World-space { position, lookAt } for a managed street, or null.
export function streetFocusPose(streetEl, camera, worldPos, worldQuat) {
  const local = streetFocusPoseLocal(streetEl, camera);
  if (!local) return null;
  return {
    position: local.position.applyQuaternion(worldQuat).add(worldPos),
    lookAt: local.lookAt.applyQuaternion(worldQuat).add(worldPos)
  };
}
