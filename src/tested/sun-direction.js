/**
 * Sun direction as azimuth + elevation, and the sun dial's mapping (#2118
 * follow-up). Scene axes: +X north, +Z east, +Y up, in geo and non-geo
 * scenes alike (google-maps-aerial.js). Azimuth is degrees clockwise from
 * north, the direction the sun shines FROM; elevation is degrees above the
 * horizon.
 *
 * The dial is a top-down compass, north up and east right: its centre is the
 * sun straight overhead and its rim is the lowest sun allowed. Every point on
 * it is a real sky position somewhere on Earth at some time.
 */

const DEG = Math.PI / 180;

/**
 * The lowest sun the dial allows. Lower suns throw shadows so long they leave
 * the shadow box, and lean the box so far its texels smear across the ground.
 */
export const MIN_SUN_ELEVATION = 10;

/** Azimuth/elevation of a sun at scene position (x, y, z) above the origin. */
export function sunAnglesFromPosition(x, y, z) {
  const azimuth = (((Math.atan2(z, x) / DEG) % 360) + 360) % 360;
  const elevation = Math.atan2(y, Math.hypot(x, z)) / DEG;
  return { azimuth, elevation };
}

/** Scene position of the sun at `distance` from the origin. */
export function sunPositionFromAngles(azimuth, elevation, distance) {
  const flat = Math.cos(elevation * DEG) * distance;
  return {
    x: Math.cos(azimuth * DEG) * flat,
    y: Math.sin(elevation * DEG) * distance,
    z: Math.sin(azimuth * DEG) * flat
  };
}

/**
 * The dial point for a sun, in a unit circle with screen axes (x right =
 * east, y down = south).
 */
export function dialPointFromSun(azimuth, elevation) {
  const clamped = Math.min(90, Math.max(MIN_SUN_ELEVATION, elevation));
  const r = (90 - clamped) / (90 - MIN_SUN_ELEVATION);
  return { x: Math.sin(azimuth * DEG) * r, y: -Math.cos(azimuth * DEG) * r };
}

/**
 * The sun for a dial point (unit circle, screen axes); points past the rim
 * clamp to it. Rounded to whole degrees: finer than anyone can match by eye,
 * and it keeps saved scenes tidy. Straight overhead keeps azimuth 0.
 */
export function sunFromDialPoint(x, y) {
  const r = Math.min(1, Math.hypot(x, y));
  const elevation = Math.round(90 - r * (90 - MIN_SUN_ELEVATION));
  const azimuth =
    r < 1e-6
      ? 0
      : Math.round((((Math.atan2(x, -y) / DEG) % 360) + 360) % 360) % 360;
  return { azimuth, elevation };
}
