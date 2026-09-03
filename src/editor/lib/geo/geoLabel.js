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

/**
 * Two-line chip text for a dragged street endpoint.
 *   line 1: lat/lon (when geo is live) else scene x/z
 *   line 2: heading + length (heading is the street's centerline bearing when
 *           geo is live, else the entity's Y rotation)
 */
export function endpointReadoutText({
  x,
  z,
  latitude,
  longitude,
  headingDeg,
  lengthText
}) {
  const hasGeo = Number.isFinite(latitude) && Number.isFinite(longitude);
  const line1 = hasGeo
    ? formatLatLon(latitude, longitude)
    : `x ${x.toFixed(2)}  z ${z.toFixed(2)}`;
  const parts = [];
  if (Number.isFinite(headingDeg)) {
    // Without geo the heading is a scene-frame angle, not a true bearing.
    parts.push(
      hasGeo ? formatBearing(headingDeg) : `${Math.round(headingDeg)}°`
    );
  }
  if (lengthText) parts.push(lengthText);
  return parts.length ? `${line1}\n${parts.join(' · ')}` : line1;
}
