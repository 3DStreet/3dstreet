/**
 * Text formatting for geographic readouts (properties panel row, gizmo chip).
 * Pure; unit-tested.
 */
export function formatLatLon(latitude, longitude, places = 6) {
  return `${latitude.toFixed(places)}, ${longitude.toFixed(places)}`;
}

export function formatBearing(deg) {
  return `${Math.round(deg)}°`;
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
  if (Number.isFinite(headingDeg)) parts.push(formatBearing(headingDeg));
  if (lengthText) parts.push(lengthText);
  return parts.length ? `${line1}\n${parts.join(' · ')}` : line1;
}
