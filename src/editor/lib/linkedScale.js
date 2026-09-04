/**
 * Linked (uniform) scale editing for the Vec3 widget.
 *
 * Linking is only offered while the three axes are already equal: a linked
 * edit then writes the edited value to every axis. Restricting the link to
 * uniform scales keeps the math trivial (no ratios, so scrubbing through 0
 * or into negatives just mirrors uniformly) and gives the reset button a
 * second job: a non-uniform scale can't be linked until reset makes it
 * uniform again.
 */
export const SCALE_LINK_STORAGE_KEY = 'vec3ScaleLinked';

const UNIFORM_EPSILON = 1e-6;

/** True when x, y and z are finite and equal within float noise. */
export function isUniformScale(v) {
  const { x, y, z } = v || {};
  if (![x, y, z].every(Number.isFinite)) return false;
  return (
    Math.abs(x - y) <= UNIFORM_EPSILON && Math.abs(x - z) <= UNIFORM_EPSILON
  );
}

export function linkedScaleUpdate(value) {
  return { x: value, y: value, z: value };
}

export function readScaleLinked() {
  try {
    const stored = localStorage.getItem(SCALE_LINK_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function writeScaleLinked(linked) {
  try {
    localStorage.setItem(SCALE_LINK_STORAGE_KEY, String(!!linked));
  } catch {
    // storage unavailable — the toggle still works for this session
  }
}
