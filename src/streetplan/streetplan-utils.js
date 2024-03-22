// utils for StreetPlan parsing
mappingUtils = require('./conversion-map.js');

// convert width from feet to meters
function convertStreetValues (streetData) {
    streetData.segments.forEach((segmentData) => {
      segmentData.width *= 0.3048;
    });
}

// convert street structure to look like Streetmix JSON Schema
function convertStreetStruct (streetProject) {
	const newStruct = {};
    const streetplanName = Object.keys(streetProject)[0];
    // streetplan alternative name
    const streetplanAltName = Object.keys(streetProject[streetplanName])[0];
    newStruct.name = streetplanName;
    newStruct.altName = streetplanAltName;

    // remove segment indexes
    newStruct.segments = Object.values(streetProject[streetplanName][streetplanAltName].segments);

    convertStreetValues(newStruct);
    convertSegmentData(newStruct.segments);
    console.log("TEST. Converted JSON structure: ", newStruct)

    return newStruct;
}

module.exports.convertStreetStruct = convertStreetStruct;

function convertSegmentData (segments) {
	segments.forEach(mappingUtils.convertSegment);
}
