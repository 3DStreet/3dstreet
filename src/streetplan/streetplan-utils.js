// utils for StreetPlan parsing
const mappingUtils = require('./conversion-map.js');

// convert width from feet to meters
function convertStreetValues(streetData) {
  streetData.segments.forEach((segmentData) => {
    segmentData.width *= 0.3048;
  });
}

// convert street structure to look like Streetmix JSON Schema
function convertStreetStruct(streetProject) {
  const newStruct = {};
  const streetplanName = Object.keys(streetProject)[0];
  // streetplan alternative name
  const streetplanAltName = Object.keys(streetProject[streetplanName])[0];
  newStruct.name = streetplanName;
  newStruct.altName = streetplanAltName;

  // remove segment indexes
  newStruct.segments = Object.values(
    streetProject[streetplanName][streetplanAltName].segments
  );

  convertStreetValues(newStruct);

  // remove buildings and setback for now. To add them in another place
  newStruct.segments = convertSegmentData(newStruct.segments).filter(
    (segmentData) => {
      return !['Buildings', 'setback'].includes(segmentData['type']);
    }
  );

  console.log('TEST. Converted JSON structure: ', newStruct);

  return newStruct;
}

module.exports.convertStreetStruct = convertStreetStruct;

function convertSegmentData(segments) {
  return segments.map(mappingUtils.convertSegment);
}
