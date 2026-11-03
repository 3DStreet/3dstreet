// Pick the reverse-geocode result that actually describes the queried point.
//
// Google's reverse geocoder occasionally returns a result from the other side
// of the world: for Bogotá's city center (4.7109886, -74.072092) the second
// result is a street address in Hanoi, Vietnam, and with our result_type
// filter it comes back first (#2113). Taking results[0] blindly stamped
// "Đường Vân Nội, Hà Nội, Vietnam" onto a Bogotá scene. Every result carries
// its own geometry, so keep only results whose viewport (or bounds) holds the
// queried point, or whose location is close to it.

// A street address viewport can sit just beside the point it was matched to.
const NEAR_METERS = 2000;

function distanceMeters (lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function boxContains (box, lat, lon) {
  if (!box?.northeast || !box?.southwest) return false;
  const { northeast: ne, southwest: sw } = box;
  if (lat < sw.lat || lat > ne.lat) return false;
  // A box crossing the antimeridian has sw.lng > ne.lng.
  return sw.lng <= ne.lng
    ? lon >= sw.lng && lon <= ne.lng
    : lon >= sw.lng || lon <= ne.lng;
}

function resultDescribesPoint (result, lat, lon) {
  const geometry = result?.geometry;
  if (!geometry) return false;
  if (boxContains(geometry.viewport, lat, lon) || boxContains(geometry.bounds, lat, lon)) {
    return true;
  }
  const loc = geometry.location;
  return !!loc && distanceMeters(lat, lon, loc.lat, loc.lng) <= NEAR_METERS;
}

function pickReverseGeocodeResult (results, lat, lon) {
  return (results || []).find((r) => resultDescribesPoint(r, lat, lon)) || null;
}

module.exports = { pickReverseGeocodeResult };
