/**
 * Camera-following shadow area (#439, #867, #1287).
 *
 * The environment's directional light renders its shadow map through a fixed
 * orthographic box, so shadows used to stop about 35 m from the scene origin.
 * Instead, each frame the light and its target move together to the point the
 * camera is looking at, keeping the sun direction fixed.
 *
 * A box that slides freely makes shadow edges shimmer: every sub-texel move
 * resamples the scene at new texel positions. So the focus is snapped to the
 * shadow map's texel grid, measured on the shadow camera's own right/up axes.
 * Movement along the light direction does not change the map, so that
 * component is kept as is.
 *
 * Pure and allocation-free: all functions write into caller-owned `out`
 * objects ({x, y, z}; THREE.Vector3 works) because they run every frame.
 */

/** Half the side of the square shadow box, in metres. */
export const SHADOW_HALF_EXTENT = 70;
/** Shadow map resolution on desktop: about 3.4 cm per texel. */
export const SHADOW_MAP_SIZE_DESKTOP = 4096;
/**
 * Shadow map resolution on phones, tablets and standalone headsets: a quarter
 * of the GPU memory and fill (16 MB instead of 64 MB) at about 6.8 cm per
 * texel, so thin props cast slightly softer, blockier shadows.
 */
export const SHADOW_MAP_SIZE_MOBILE = 2048;

/**
 * Shadow box settings, chosen once at startup. The map never exceeds the
 * GPU's maximum texture size. `reach` is the furthest the focus may sit from
 * the camera horizontally: less than the half extent, so a street-level view
 * still keeps shadows around its feet.
 */
export function shadowSettings({ mobile, maxTextureSize = Infinity }) {
  const mapSize = Math.min(
    mobile ? SHADOW_MAP_SIZE_MOBILE : SHADOW_MAP_SIZE_DESKTOP,
    maxTextureSize
  );
  return {
    halfExtent: SHADOW_HALF_EXTENT,
    mapSize,
    texelSize: (2 * SHADOW_HALF_EXTENT) / mapSize,
    reach: SHADOW_HALF_EXTENT * 0.6
  };
}

/**
 * The ground point (y = groundY) the camera looks at, no further than `reach`
 * horizontally. A camera looking down from high above focuses on the spot it
 * looks at; one looking level or up focuses `reach` ahead along its heading.
 * `dir` must be normalized.
 */
export function shadowFocus(pos, dir, reach, groundY, out) {
  const horiz = Math.hypot(dir.x, dir.z);
  let dist = reach;
  if (dir.y < 0 && pos.y > groundY) {
    // Horizontal distance to where the view ray meets the ground.
    dist = Math.min(reach, ((pos.y - groundY) / -dir.y) * horiz);
  }
  if (horiz > 1e-6) {
    out.x = pos.x + (dir.x / horiz) * dist;
    out.z = pos.z + (dir.z / horiz) * dist;
  } else {
    out.x = pos.x;
    out.z = pos.z;
  }
  out.y = groundY;
  return out;
}

/**
 * Snap `point` to the shadow map texel grid of an orthographic shadow camera
 * looking along `lightDir` (normalized, from the light toward its target) with
 * world up +Y, matching three.js's Matrix4.lookAt basis.
 */
export function snapToShadowTexels(point, lightDir, texel, out) {
  // z points from the target back to the light, as in lookAt.
  const zx = -lightDir.x;
  const zy = -lightDir.y;
  const zz = -lightDir.z;
  // x = normalize(up × z) with up = (0, 1, 0); fall back to up = (0, 0, 1)
  // for a sun straight overhead.
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  let len = Math.hypot(xx, xz);
  if (len < 1e-6) {
    xx = -zy;
    xy = zx;
    xz = 0;
    len = Math.hypot(xx, xy);
  }
  xx /= len;
  xy /= len;
  xz /= len;
  // y = z × x
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const a = Math.round((point.x * xx + point.y * xy + point.z * xz) / texel);
  const b = Math.round((point.x * yx + point.y * yy + point.z * yz) / texel);
  const c = point.x * zx + point.y * zy + point.z * zz;
  out.x = (xx * a + yx * b) * texel + zx * c;
  out.y = (xy * a + yy * b) * texel + zy * c;
  out.z = (xz * a + yz * b) * texel + zz * c;
  return out;
}
