const { CURB_HEIGHT, levelToElevation } = require('./street-segment-utils');

function streetmixUserToAPI(userURL) {
  // this takes in a user facing Streetmix.net URL like https://streetmix.net/kfarr/3/a-frame-city-builder-street-only
  // and turns it into the API redirect URL like https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr
  var pathArray = new URL(userURL).pathname.split('/');
  const creatorId = decodeURIComponent(pathArray[1]);
  const namespacedId = pathArray[2];
  const baseUrl = 'https://streetmix.net';

  if (creatorId === '-') {
    return baseUrl + '/api/v1/streets?namespacedId=' + namespacedId;
  } else {
    return (
      baseUrl +
      '/api/v1/streets?namespacedId=' +
      namespacedId +
      '&creatorId=' +
      encodeURIComponent(creatorId)
    );
  }
}
module.exports.streetmixUserToAPI = streetmixUserToAPI;

function pathStartsWithAPI(urlString) {
  // First, check the URL path to see if it starts with /api/
  const url = document.createElement('a');
  url.href = urlString;
  const pathname = url.pathname;
  const topDir = pathname.split('/')[1];
  return topDir === 'api';
}
module.exports.pathStartsWithAPI = pathStartsWithAPI;

function streetmixAPIToUser(APIURL) {
  // this takes in a Streetmix.net API redirect URL like https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr
  // and turns it into the user facing friendly Streetmix.net URL like https://streetmix.net/kfarr/3/a-frame-city-builder-street-only

  // modified from: https://stackoverflow.com/questions/2090551/parse-query-string-in-javascript
  function getQueryVariable(queryString, variable) {
    var vars = queryString.split('&');
    for (var i = 0; i < vars.length; i++) {
      var pair = vars[i].split('=');
      if (decodeURIComponent(pair[0]) === variable) {
        return decodeURIComponent(pair[1]);
      }
    }
    console.log('Query variable %s not found', variable);
  }
  var queryString = new URL(APIURL).search.substring(1);
  var namespacedId = getQueryVariable(queryString, 'namespacedId');
  var creatorId = getQueryVariable(queryString, 'creatorId');
  if (typeof creatorId === 'undefined') {
    creatorId = '-';
  }

  return 'https://streetmix.net/' + creatorId + '/' + namespacedId;
}
module.exports.streetmixAPIToUser = streetmixAPIToUser;

// Convert metric elevation to the nearest integer level. Kept only for the
// legacy `street` parser (aframe-streetmix-parsers.js), whose geometry lookup
// tables are still indexed by integer level.
// e.g., 0m → 0, 0.15m → 1, 0.30m → 2, 0.75m → 5
function metricElevationToLevel(elevation) {
  if (elevation === undefined || elevation === null) {
    return 0;
  }
  return Math.round(elevation / CURB_HEIGHT);
}
module.exports.metricElevationToLevel = metricElevationToLevel;

// Normalize street data to 3DStreet's canonical units — meters everywhere:
// - schemaVersion < 30: convert widths from feet to meters
// - schemaVersion < 33: convert integer elevation levels to meters
// - schemaVersion >= 33: elevation is already meters, pass through
function convertStreetValues(streetData) {
  if (streetData.schemaVersion < 30) {
    // convert width from feet to meters
    streetData.segments.forEach((segmentData) => {
      segmentData.width *= 0.3048;
    });
    if (streetData.width) streetData.width *= 0.3048;
  }

  if (streetData.schemaVersion < 33) {
    streetData.segments.forEach((segmentData) => {
      if (segmentData.elevation !== undefined) {
        segmentData.elevation = levelToElevation(segmentData.elevation);
      }
    });
  }

  return streetData;
}
module.exports.convertStreetValues = convertStreetValues;

// Read one side of a street's boundary (building edge) data. Streetmix
// schemaVersion 34+ provides a canonical `boundary` object:
//   boundary.left/right = { id, variant, floors, elevation }
// where `elevation` is meters (same unit as segment elevation) and `floors`
// replaces the old *BuildingHeight. Older payloads only carry the deprecated
// flat fields (leftBuildingVariant / leftBuildingHeight / ...), which are
// still emitted for back-compat but no longer stored upstream — use them only
// as a fallback. Returns null when the street has no boundary on that side.
function getBoundaryFromStreetData(streetData, side) {
  const boundarySide = streetData?.boundary?.[side];
  if (boundarySide && typeof boundarySide === 'object') {
    return {
      id: boundarySide.id,
      variant: boundarySide.variant,
      floors: boundarySide.floors,
      elevation: boundarySide.elevation
    };
  }
  const variant = streetData?.[`${side}BuildingVariant`];
  if (!variant) {
    return null;
  }
  return {
    variant,
    floors: streetData[`${side}BuildingHeight`]
  };
}
module.exports.getBoundaryFromStreetData = getBoundaryFromStreetData;
