// utils for StreetPlan parsing
const mappingUtils = require('./conversion-map.js');

/**
 * Convert width from feet to meters
 * @param {Object} streetData - Street data containing segments
 */
function convertStreetValues(streetData) {
  streetData.segments.forEach((segmentData) => {
    segmentData.width *= 0.3048;
  });
}

/**
 * Convert street structure to match Streetmix JSON Schema
 * @param {Object} projectData - Full project data from StreetPlan
 * @returns {Object} Converted street structure
 */
function convertStreetStruct(projectData) {
  // Validate input
  if (!projectData || !projectData.project) {
    throw new Error('Invalid project data structure');
  }

  const newStruct = {
    projectName: projectData.project.ProjectName || 'Unnamed Project',
    units: projectData.project.DistanceUnits || 'Feet'
  };

  // Find the first street in the project (excluding metadata keys)
  const streets = Object.keys(projectData.project).filter(
    (key) => key !== 'ProjectName' && key !== 'DistanceUnits'
  );

  if (streets.length === 0) {
    throw new Error('No streets found in project');
  }

  const streetName = streets[0];
  newStruct.name = streetName;

  // Get the street variations (e.g. "Boulevard Alt 1", "Existing Conditions")
  const variations = Object.keys(projectData.project[streetName]).filter(
    (key) => key !== 'LengthMiles'
  );

  // Use the first variation by default
  const selectedVariation = variations[0];
  newStruct.altName = selectedVariation;
  newStruct.lengthMiles = projectData.project[streetName].LengthMiles;

  // Get segments from the selected variation
  const streetData = projectData.project[streetName][selectedVariation];

  // Remove segment indexes and convert to array
  newStruct.segments = Object.values(streetData.segments);

  // Convert measurements if needed
  convertStreetValues(newStruct);

  // Remove buildings and setback segments, convert remaining data
  newStruct.segments = convertSegmentData(newStruct.segments).filter(
    (segmentData) => {
      return !['Buildings', 'setback'].includes(segmentData['type']);
    }
  );

  // Add new metadata fields if present
  newStruct.segments = newStruct.segments.map((segment) => {
    if (segment.Group1) segment.group1 = segment.Group1;
    if (segment.Group2) segment.group2 = segment.Group2;
    if (segment.Cost) segment.cost = segment.Cost;
    return segment;
  });

  return newStruct;
}

function convertSegmentData(segments) {
  return segments.map(mappingUtils.convertSegment);
}

module.exports = {
  convertStreetStruct,
  convertSegmentData,
  convertStreetValues
};
