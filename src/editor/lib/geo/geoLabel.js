/**
 * Text formatting for geographic readouts (properties panel row, gizmo chip).
 * Pure; unit-tested.
 */
export function formatLatLon(latitude, longitude, places = 6) {
  return `${latitude.toFixed(places)}, ${longitude.toFixed(places)}`;
}

/**
 * True bearing in the nautical/aviation convention: three digits, degrees
 * clockwise from true north, suffixed "T" (true) so it can't be mistaken for
 * a three.js Y rotation. 98.4 → "098° T".
 */
export function formatBearing(deg) {
  const whole = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(whole).padStart(3, '0')}° T`;
}

/** Single-line geo readout: "37.774900, -122.419400, 098° T". */
export function formatGeoLoc(latitude, longitude, bearingDeg) {
  const base = formatLatLon(latitude, longitude);
  return Number.isFinite(bearingDeg)
    ? `${base}, ${formatBearing(bearingDeg)}`
    : base;
}
