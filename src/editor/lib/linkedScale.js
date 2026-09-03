/**
 * Linked (proportional) scale editing for the Vec3 widget.
 *
 * With axes linked, editing one axis scales the other two by the same
 * ratio, so a 1/2/1 entity dragged on x to 1.5 becomes 1.5/3/1.5 rather
 * than collapsing to a uniform 1.5. When the edited axis was 0 (no ratio to
 * keep) or non-finite, fall back to uniform: every axis takes the new value.
 */
export const SCALE_LINK_STORAGE_KEY = 'vec3ScaleLinked';

export function linkedScaleUpdate(prev, axis, value) {
  const from = prev?.[axis];
  const ratio = Number.isFinite(from) && from !== 0 ? value / from : null;
  const out = {};
  for (const key of ['x', 'y', 'z']) {
    if (key === axis) {
      out[key] = value;
    } else if (ratio === null || !Number.isFinite(prev?.[key])) {
      out[key] = value;
    } else {
      out[key] = parseFloat((prev[key] * ratio).toFixed(5));
    }
  }
  return out;
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
