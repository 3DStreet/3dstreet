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
// Where the bottom of the cross-section (the width label hanging under the
// dirt block, CROSS_SECTION_DROP below the roadway) sits in the frame, as a
// fraction of the viewport height from the top. Pinning a screen position
// rather than an aim distance keeps the composition the same for a whole
// street and a narrow segment span: cross-section in the lower part of the
// frame, label just clear of the bottom toolbar, road running up the frame.
export const STREET_FOCUS_BOTTOM_Y = 0.88;
// street-ground dirt block (2 m) + street-label plane (2.5 m centered at -2).
export const CROSS_SECTION_DROP = 3.25;

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
// managed-street.computeZStart). `segments` are in cross-section order with
// their x centers, so a segment focus can pick a sub-span.
export function travelledWayLocalFrame(streetEl) {
  const street = streetEl?.components?.['managed-street'];
  if (!street) return null;
  // A path-following street is laid out along its curve in world space, not
  // in this straight-space frame — the fit would aim at empty ground. Let
  // the generic bounding-box framing handle it.
  if (street.streetCurve) return null;
  const segments = getTravelledWaySegments(streetEl).map((el) => ({
    el,
    width: el.getAttribute('street-segment')?.width || 0,
    x: el.getAttribute('position')?.x || 0
  }));
  const width = segments.reduce((sum, seg) => sum + seg.width, 0);
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
  return {
    width,
    length,
    xCenter,
    zStart,
    zNear: zStart + length,
    segments
  };
}

// A segment focus shows the segment, its two neighbours in full and half of
// the next ones out — enough context to place it without losing it.
export const SEGMENT_FOCUS_CONTEXT = [1, 0.5];
// Floor on the framed span (street or segment): the cross-section block
// under the road is a fixed CROSS_SECTION_DROP tall, so fitting a narrow
// span — a two-lane road, a divider — would let it swallow the frame. Below
// this the span is widened symmetrically and the street sits further away.
export const FOCUS_MIN_WIDTH = 15;

// Sub-span { width, xCenter } of the travelled way around `segmentEl`, or
// null when it isn't in the street's travelled way (boundaries et al).
export function segmentFocusSpan(frame, segmentEl) {
  const i = frame.segments.findIndex((s) => s.el === segmentEl);
  if (i === -1) return null;
  const own = frame.segments[i];
  let left = own.x - own.width / 2;
  let right = own.x + own.width / 2;
  SEGMENT_FOCUS_CONTEXT.forEach((share, k) => {
    const l = frame.segments[i - 1 - k];
    const r = frame.segments[i + 1 + k];
    if (l) left -= l.width * share;
    if (r) right += r.width * share;
  });
  return { width: right - left, xCenter: (left + right) / 2 };
}

// { position, lookAt } in the street's local frame for a span of `width`
// centered at `xCenter`, or null.
function poseForSpan(frame, span, camera) {
  if (!camera?.isPerspectiveCamera || !(span.width > 0)) return null;
  const depth = fitDepthForWidth(span.width, camera.fov, camera.aspect || 1);
  const pitch = THREE.MathUtils.degToRad(STREET_FOCUS_PITCH_DEG);
  const near = new THREE.Vector3(span.xCenter, 0, frame.zNear);
  const bottom = new THREE.Vector3(
    span.xCenter,
    -CROSS_SECTION_DROP,
    frame.zNear
  );
  // Angle below the view axis at which a point lands on screen row
  // STREET_FOCUS_BOTTOM_Y (NDC y = 1 - 2·row; rows below center are negative).
  const halfVFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const theta = Math.atan((2 * STREET_FOCUS_BOTTOM_Y - 1) * halfVFovTan);
  // Camera sits behind and above the near end along `dir`; the view axis
  // tilts down so `bottom` hits its screen row. The width fit is defined at
  // the near edge's view-space depth, which depends on the tilt, which
  // depends on where the camera is — a few fixed-point rounds converge to
  // well under a centimetre.
  const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const position = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const toBottom = new THREE.Vector3();
  let dist = depth;
  for (let i = 0; i < 6; i++) {
    position.copy(near).addScaledVector(dir, dist);
    toBottom.subVectors(bottom, position);
    const depression = Math.atan2(
      -toBottom.y,
      Math.hypot(toBottom.x, toBottom.z)
    );
    const tilt = depression - theta;
    axis.set(0, -Math.sin(tilt), -Math.cos(tilt));
    const depthNow = near.clone().sub(position).dot(axis);
    dist *= depth / Math.max(depthNow, 1e-3);
  }
  position.copy(near).addScaledVector(dir, dist);
  return { position, lookAt: position.clone().add(axis) };
}

// Street-local { position, lookAt, streetEl } for a managed street or one of
// its travelled-way segments, or null for anything else.
export function streetFocusPoseLocal(targetEl, camera) {
  if (!targetEl) return null;
  let streetEl = targetEl;
  let segmentEl = null;
  if (targetEl.components?.['street-segment']) {
    segmentEl = targetEl;
    streetEl = targetEl.parentEl;
  }
  const frame = travelledWayLocalFrame(streetEl);
  if (!frame) return null;
  const span = segmentEl
    ? segmentFocusSpan(frame, segmentEl)
    : { width: frame.width, xCenter: frame.xCenter };
  if (!span) return null;
  span.width = Math.max(span.width, FOCUS_MIN_WIDTH);
  const pose = poseForSpan(frame, span, camera);
  return pose && { ...pose, streetEl };
}

// World-space { position, lookAt } for a managed street or one of its
// segments, or null. The pose is expressed in the STREET's frame even for a
// segment focus, so it's transformed by the street's matrixWorld here rather
// than by whatever the caller decomposed for the focused entity.
export function streetFocusPose(targetEl, camera) {
  const local = streetFocusPoseLocal(targetEl, camera);
  if (!local) return null;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.streetEl.object3D.matrixWorld.decompose(pos, quat, scale);
  return {
    position: local.position.applyQuaternion(quat).add(pos),
    lookAt: local.lookAt.applyQuaternion(quat).add(pos)
  };
}
