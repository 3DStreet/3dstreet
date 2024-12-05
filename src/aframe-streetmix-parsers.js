// Orientation - default model orientation is "outbound" (away from camera)
var streetmixParsersTested = require('./tested/aframe-streetmix-parsers-tested');
var { segmentVariants } = require('./segments-variants.js');

function getSeparatorMixinId(previousSegment, currentSegment) {
  if (previousSegment === undefined || currentSegment === undefined) {
    return null;
  }
  // Helper function to check if a segment type is "lane-ish"
  function isLaneIsh(typeString) {
    return (
      typeString.slice(typeString.length - 4) === 'lane' ||
      typeString === 'light-rail' ||
      typeString === 'streetcar' ||
      typeString === 'flex-zone'
    );
  }

  // If either segment is not lane-ish and not a divider, return null
  if (
    (!isLaneIsh(previousSegment.type) && previousSegment.type !== 'divider') ||
    (!isLaneIsh(currentSegment.type) && currentSegment.type !== 'divider')
  ) {
    return null;
  }

  // Default to solid line
  let variantString = 'solid-stripe';

  // Handle divider cases
  if (previousSegment.type === 'divider' || currentSegment.type === 'divider') {
    return variantString;
  }

  // Get directions from variant strings
  const prevDirection = previousSegment.variantString.split('|')[0];
  const currDirection = currentSegment.variantString.split('|')[0];

  // Check for opposite directions
  if (prevDirection !== currDirection) {
    variantString = 'solid-doubleyellow';

    // Special case for bike lanes
    if (
      currentSegment.type === 'bike-lane' &&
      previousSegment.type === 'bike-lane'
    ) {
      variantString = 'short-dashed-stripe-yellow';
    }

    // Special case for flex zones
    if (
      currentSegment.type === 'flex-zone' ||
      previousSegment.type === 'flex-zone'
    ) {
      variantString = 'solid';
    }
  } else {
    // Same direction cases
    if (currentSegment.type === previousSegment.type) {
      variantString = 'dashed-stripe';
    }

    // Drive lane and turn lane combination
    if (
      (currentSegment.type === 'drive-lane' &&
        previousSegment.type === 'turn-lane') ||
      (previousSegment.type === 'drive-lane' &&
        currentSegment.type === 'turn-lane')
    ) {
      variantString = 'dashed-stripe';
    }
  }

  // Special cases for shared turn lanes
  const prevVariant = previousSegment.variantString.split('|')[1];
  const currVariant = currentSegment.variantString.split('|')[1];

  if (currentSegment.type === 'turn-lane' && currVariant === 'shared') {
    variantString = 'solid-dashed-yellow';
  } else if (previousSegment.type === 'turn-lane' && prevVariant === 'shared') {
    variantString = 'solid-dashed-yellow';
  }

  // Special case for parking lanes
  if (
    currentSegment.type === 'parking-lane' ||
    previousSegment.type === 'parking-lane'
  ) {
    variantString = 'invisible';
  }

  return variantString;
}

function getRandomIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getSegmentColor(variant) {
  if ((variant === 'red') | (variant === 'colored')) {
    return window.STREET.colors.red;
  }
  if (variant === 'blue') {
    return window.STREET.colors.blue;
  }
  if ((variant === 'green') | (variant === 'grass')) {
    return window.STREET.colors.green;
  }
  return window.STREET.colors.white;
}

// offset to center the street around global x position of 0
function createCenteredStreetElement(segments) {
  const streetEl = document.createElement('a-entity');
  const streetWidth = segments.reduce(
    (streetWidth, segmentData) => streetWidth + segmentData.width,
    0
  );
  const offset = 0 - streetWidth / 2;
  streetEl.setAttribute('position', offset + ' 0 0');
  return streetEl;
}

// show warning message if segment or variantString are not supported
function supportCheck(segmentType, segmentVariantString) {
  if (segmentType === 'separator') return;
  // variants supported in 3DStreet
  const supportedVariants = segmentVariants[segmentType];
  if (!supportedVariants) {
    STREET.notify.warningMessage(
      `The '${segmentType}' segment type is not yet supported in 3DStreet`
    );
    console.log(
      `The '${segmentType}' segment type is not yet supported in 3DStreet`
    );
  } else if (!supportedVariants.includes(segmentVariantString)) {
    STREET.notify.warningMessage(
      `The '${segmentVariantString}' variant of segment '${segmentType}' is not yet supported in 3DStreet`
    );
    console.log(
      `The '${segmentVariantString}' variant of segment '${segmentType}' is not yet supported in 3DStreet`
    );
  }
}

// OLD: takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
// NEW: takes a `segments` (array) from streetmix and return an element and its children which represent the 3D street scene
function processSegments(
  segments,
  showStriping,
  length,
  globalAnimated,
  showVehicles
) {
  // create and center offset to center the street around global x position of 0
  var streetParentEl = createCenteredStreetElement(segments);
  streetParentEl.classList.add('street-parent');
  streetParentEl.setAttribute('data-layer-name', 'Street Segments Container');
  streetParentEl.setAttribute('data-no-transform', '');

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
    var segmentColor = null;
    var segmentParentEl = document.createElement('a-entity');
    segmentParentEl.classList.add('segment-parent-' + i);

    var segmentWidthInMeters = segments[i].width;
    // console.log('Type: ' + segments[i].type + '; Width: ' + segmentWidthInFeet + 'ft / ' + segmentWidthInMeters + 'm');

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    var segmentPositionX = cumulativeWidthInMeters - 0.5 * segmentWidthInMeters;

    // get variantString
    var variantList = segments[i].variantString
      ? segments[i].variantString.split('|')
      : '';

    // show warning message if segment or variantString are not supported
    supportCheck(segments[i].type, segments[i].variantString);

    // elevation property from streetmix segment
    const elevation = segments[i].elevation;

    var direction =
      variantList[0] === 'inbound' || variantList[1] === 'inbound'
        ? 'inbound'
        : 'outbound';

    // the A-Frame mixin ID is often identical to the corresponding streetmix segment "type" by design, let's start with that
    var segmentPreset = segments[i].type;

    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `model: sharrow; length: ${length}; cycleOffset: 0.2; spacing: 15; direction: ${direction}`
      );
    } else if (
      segments[i].type === 'bike-lane' ||
      segments[i].type === 'scooter'
    ) {
      segmentPreset = 'bike-lane'; // use bike lane road material
      // get the mixin id for a bike lane
      segmentColor = getSegmentColor(variantList[1]);
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `model: bike-arrow; length: ${length}; cycleOffset: 0.3; spacing: 20; direction: ${direction};`
      );
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random;
        modelsArray: cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-dutch, cyclist-kid${segments[i].type === 'scooter' ? 'ElectricScooter_1' : ''};
        length: ${length};
        spacing: 2.03;
        direction: ${direction};
        count: ${getRandomIntInclusive(2, 5)};`
      );
    } else if (
      segments[i].type === 'light-rail' ||
      segments[i].type === 'streetcar'
    ) {
      segmentPreset = 'rail';
      // get the color for a bus lane
      segmentColor = getSegmentColor(variantList[1]);
      // get the mixin id for the vehicle (is it a trolley or a tram?)
      const objectMixinId =
        segments[i].type === 'streetcar' ? 'trolley' : 'tram';
      if (showVehicles) {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random; model: ${objectMixinId}; length: ${length}; spacing: 20; direction: ${direction}; count: 1;`
        );
      }
      segmentParentEl.setAttribute(
        'street-generated-rail',
        `length: ${length}; gauge: ${segments[i].type === 'streetcar' ? 1067 : 1435};`
      );
    } else if (segments[i].type === 'turn-lane') {
      segmentPreset = 'drive-lane'; // use normal drive lane road material
      if (showVehicles && variantList[1] !== 'shared') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random;
           modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
            length: ${length};
            spacing: 7.3;
            direction: ${direction};
            count: ${getRandomIntInclusive(2, 4)};`
        );
      }
      var markerMixinId = variantList[1]; // set the mixin of the road markings to match the current variant name
      // Fix streetmix inbound turn lane orientation (change left to right) per: https://github.com/streetmix/streetmix/issues/683
      if (variantList[0] === 'inbound') {
        markerMixinId = markerMixinId.replace(/left|right/g, function (m) {
          return m === 'left' ? 'right' : 'left';
        });
      }
      if (variantList[1] === 'shared') {
        markerMixinId = 'left';
      }
      if (variantList[1] === 'left-right-straight') {
        markerMixinId = 'all';
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `model: ${markerMixinId}; length: ${length}; cycleOffset: 0.4; spacing: 20; direction: ${direction};`
      );
      if (variantList[1] === 'shared') {
        segmentParentEl.setAttribute(
          'street-generated-stencil__2',
          `model: ${markerMixinId}; length: ${length}; cycleOffset: 0.6; spacing: 20; direction: ${direction}; facing: 180;`
        );
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      segmentPreset = 'divider';
      // make some bollards
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: bollard; spacing: 4; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'flowers') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: dividers-flowers; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planting-strip'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: dividers-planting-strip; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planter-box'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: dividers-planter-box; spacing: 2.45; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'palm-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: palm-tree; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'big-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: tree3; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'bush') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: dividers-bush; spacing: 2.25; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'dome') {
      segmentPreset = 'divider';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: dividers-dome; spacing: 2.25; length: ${length}`
      );
    } else if (segments[i].type === 'divider') {
      segmentPreset = 'divider';
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'barricade'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: temporary-barricade; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'traffic-cone'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: temporary-traffic-cone; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-plastic'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: jersey-barrier-plastic; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-concrete'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: temporary-jersey-barrier-concrete; spacing: 2.93; length: ${length}`
      );
    } else if (
      segments[i].type === 'bus-lane' ||
      segments[i].type === 'brt-lane'
    ) {
      segmentPreset = 'bus-lane';
      // get the color for a bus lane
      segmentColor = getSegmentColor(variantList[1]);

      if (showVehicles) {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random; model: bus; length: ${length}; spacing: 15; direction: ${direction}; count: 1;`
        );
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `stencils: word-only, word-taxi, word-bus; length: ${length}; spacing: 40; padding: 10; direction: ${direction}`
      );
    } else if (segments[i].type === 'drive-lane') {
      if (showVehicles) {
        // const isAnimated = variantList[2] === 'animated' || globalAnimated;
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random;
           modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
            length: ${length};
            spacing: 7.3;
            direction: ${direction};
            count: ${getRandomIntInclusive(2, 4)};`
        );
      }
    } else if (segments[i].type === 'food-truck') {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; model: food-trailer-rig; length: ${length}; spacing: 7; direction: ${direction}; count: 2;`
      );
    } else if (segments[i].type === 'flex-zone') {
      segmentPreset = 'parking-lane';
      if (showVehicles) {
        const objectMixinId =
          variantList[0] === 'taxi' ? 'sedan-taxi-rig' : 'sedan-rig';
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `mode: random; model: ${objectMixinId}; length: ${length}; spacing: 6; direction: ${direction}; count: 4;`
        );
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `stencils: word-loading-small, word-only-small; length: ${length}; spacing: 40; padding: 10; direction: ${direction}`
      );
    } else if (segments[i].type === 'sidewalk' && variantList[0] !== 'empty') {
      segmentParentEl.setAttribute(
        'street-generated-pedestrians',
        `segmentWidth: ${segmentWidthInMeters}; density: ${variantList[0]}; length: ${length};`
      );
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; model: wayfinding; length: ${length};`
      );
    } else if (segments[i].type === 'sidewalk-bench') {
      const rotationCloneY = variantList[0] === 'right' ? -90 : 90;
      if (variantList[0] === 'center') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `model: bench_orientation_center; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      } else {
        // `right` or `left` bench
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `model: bench; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      const rotationCloneY = variantList[1] === 'sidewalk-parallel' ? 90 : 0;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: bikerack; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.2`
      );
    } else if (segments[i].type === 'magic-carpet') {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; model: magic-carpet;
        length: ${length};
        positionY: 1.2;`
      );
      segmentParentEl.setAttribute(
        'street-generated-clones__2',
        `mode: single; model: Character_1_M;
        length: ${length};
        positionY: 1.2;`
      );
    } else if (segments[i].type === 'outdoor-dining') {
      segmentPreset = variantList[1] === 'road' ? 'drive-lane' : 'sidewalk';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; model: outdoor_dining; length: ${length}; spacing: 3; count: 5;`
      );
    } else if (segments[i].type === 'parklet') {
      segmentPreset = 'drive-lane';
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; model: parklet; length: ${length}; spacing: 5.5; count: 3; facing: ${rotationCloneY};`
      );
    } else if (segments[i].type === 'bikeshare') {
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; model: bikeshare; length: ${length}; facing: ${rotationCloneY}; justify: middle;`
      );
    } else if (segments[i].type === 'utilities') {
      const rotationCloneY = variantList[0] === 'right' ? 180 : 0;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: utility_pole; length: ${length}; cycleOffset: 0.25; facing: ${rotationCloneY}`
      );
    } else if (segments[i].type === 'sidewalk-tree') {
      const objectMixinId =
        variantList[0] === 'palm-tree' ? 'palm-tree' : 'tree3';
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: ${objectMixinId}; length: ${length}; randomFacing: true;`
      );
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      (variantList[1] === 'modern' || variantList[1] === 'pride')
    ) {
      if (variantList[0] === 'both') {
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `model: lamp-modern-double; length: ${length}; cycleOffset: 0.4;`
        );
      } else {
        var rotationCloneY = variantList[0] === 'right' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-clones',
          `model: lamp-modern; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.4;`
        );
      }
      // Add the pride flags to the lamp posts
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'right' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-clones__2',
          `model: pride-flag; length: ${length}; cycleOffset: 0.4; positionX: 0.409; positionY: 5;`
        );
      }
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'left' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-clones__2',
          `model: pride-flag; length: ${length}; facing: 180; cycleOffset: 0.4; positionX: -0.409; positionY: 5;`
        );
      }
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      variantList[1] === 'traditional'
    ) {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `model: lamp-traditional; length: ${length};`
      );
    } else if (segments[i].type === 'transit-shelter') {
      var rotationBusStopY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; model: bus-stop; length: ${length}; facing: ${rotationBusStopY};`
      );
    } else if (segments[i].type === 'brt-station') {
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: single; model: brt-station; length: ${length};`
      );
    } else if (segments[i].type === 'parking-lane') {
      segmentPreset = 'parking-lane';
      let parkingMixin = 'stencils parking-t';
      let carStep = 6;

      const rotationVars = {
        // markings rotation
        outbound: 90,
        inbound: 90,
        sideways: 0,
        'angled-front-left': 30,
        'angled-front-right': -30,
        'angled-rear-left': -30,
        'angled-rear-right': 30
      };
      let markingsRotZ = rotationVars[variantList[0]];
      let markingLength;

      // calculate position X and rotation Z for T-markings
      let markingPosX = segmentWidthInMeters / 2;
      if (markingsRotZ === 90 && variantList[1] === 'right') {
        markingsRotZ = -90;
        markingPosX = -markingPosX + 0.75;
      } else {
        markingPosX = markingPosX - 0.75;
      }

      if (variantList[0] === 'sideways' || variantList[0].includes('angled')) {
        carStep = 3;
        markingLength = segmentWidthInMeters;
        markingPosX = 0;
        parkingMixin = 'solid-stripe';
        if (variantList[1] === 'right') {
          // make sure cars face the right way on right side
          markingsRotZ = markingsRotZ + 180;
        }
      }
      segmentParentEl.setAttribute(
        'street-generated-clones',
        `mode: random; 
         modelsArray: sedan-rig, self-driving-waymo-car, suv-rig;
          length: ${length};
          spacing: ${carStep};
          count: ${getRandomIntInclusive(6, 8)};
          facing: ${markingsRotZ - 90};`
      );
      if (variantList[1] === 'left') {
        segmentParentEl.setAttribute(
          'street-generated-stencil',
          `model: ${parkingMixin}; length: ${length}; cycleOffset: 1; spacing: ${carStep}; positionX: ${markingPosX}; facing: ${markingsRotZ + 90}; stencilHeight: ${markingLength};`
        );
      } else {
        segmentParentEl.setAttribute(
          'street-generated-stencil',
          `model: ${parkingMixin}; length: ${length}; cycleOffset: 1; spacing: ${carStep}; positionX: ${markingPosX}; facing: ${markingsRotZ + 90}; stencilHeight: ${markingLength};`
        );
      }
    }

    // if this thing is a sidewalk, make segmentPreset sidewalk
    if (streetmixParsersTested.isSidewalk(segments[i].type)) {
      segmentPreset = 'sidewalk';
    }

    // add new object
    segmentParentEl.setAttribute('street-segment', 'type', segmentPreset);
    segmentParentEl.setAttribute(
      'street-segment',
      'width',
      segmentWidthInMeters
    );
    segmentParentEl.setAttribute('street-segment', 'length', length);
    segmentParentEl.setAttribute('street-segment', 'level', elevation);
    segmentParentEl.setAttribute('street-segment', 'direction', direction);
    segmentParentEl.setAttribute(
      // find default color for segmentPreset
      'street-segment',
      'color',
      segmentColor ?? window.STREET.types[segmentPreset]?.color // no error handling for segmentPreset not found
    );
    segmentParentEl.setAttribute(
      // find default surface type for segmentPreset
      'street-segment',
      'surface',
      window.STREET.types[segmentPreset]?.surface // no error handling for segmentPreset not found
    );

    let currentSegment = segments[i];
    let previousSegment = segments[i - 1];
    let separatorMixinId = getSeparatorMixinId(previousSegment, currentSegment);

    if (separatorMixinId && showStriping) {
      segmentParentEl.setAttribute(
        'street-generated-striping',
        `striping: ${separatorMixinId}; length: ${length}; segmentWidth: ${segmentWidthInMeters};`
      );
      // if previous segment is turn lane and shared, then facing should be 180
      if (
        previousSegment &&
        previousSegment.type === 'turn-lane' &&
        previousSegment.variantString.split('|')[1] === 'shared'
      ) {
        segmentParentEl.setAttribute(
          'street-generated-striping',
          'facing',
          180
        );
      }
    }

    // append the new surfaceElement to the segmentParentEl
    streetParentEl.append(segmentParentEl);
    segmentParentEl.setAttribute('position', segmentPositionX + ' 0 0');
    segmentParentEl.setAttribute(
      'data-layer-name',
      '' + segments[i].type + ' • ' + variantList[0]
    );
  }

  // create new brown box to represent ground underneath street
  const dirtBox = document.createElement('a-box');
  const xPos = cumulativeWidthInMeters / 2;
  dirtBox.setAttribute('position', `${xPos} -1 0`); // what is x? x = 0 - cumulativeWidthInMeters / 2
  dirtBox.setAttribute('height', 2); // height is 2 meters from y of -0.1 to -y of 2.1
  dirtBox.setAttribute('width', cumulativeWidthInMeters);
  dirtBox.setAttribute('depth', length - 0.2); // depth is length - 0.1 on each side
  dirtBox.setAttribute('material', `color: ${STREET.colors.brown};`);
  dirtBox.setAttribute('data-layer-name', 'Underground');
  streetParentEl.append(dirtBox);
  return streetParentEl;
}
module.exports.processSegments = processSegments;

// test - for streetObject of street 44 and buildingElementId render 2 building sides
function processBuildings(left, right, streetWidth, showGround, length) {
  const buildingElement = document.createElement('a-entity');
  buildingElement.classList.add('buildings-parent');
  buildingElement.setAttribute(
    'data-layer-name',
    'Buildings & Blocks Container'
  );
  buildingElement.setAttribute('position', '0 0.2 0');
  const buildingsArray = [left, right];

  // TODO: Sound temporarily disabled
  // var ambientSoundJSONString = JSON.stringify(streetmixParsersTested.getAmbientSoundJSON(buildingsArray));
  // var soundParentEl = document.createElement('a-entity');
  // soundParentEl.setAttribute('create-from-json', 'jsonString', ambientSoundJSONString);
  // buildingElement.appendChild(soundParentEl);

  function createBuilding(buildingType, sideMultiplier) {
    // Make buildings
    const buildingsArray = streetmixParsersTested.createBuildingsArray(
      length,
      buildingType
    );
    const buildingJSONString = JSON.stringify(buildingsArray);
    const placedObjectEl = document.createElement('a-entity');

    placedObjectEl.setAttribute('rotation', '0 ' + 90 * sideMultiplier + ' 0');
    placedObjectEl.setAttribute(
      'create-from-json',
      'jsonString',
      buildingJSONString
    );
    return placedObjectEl;
  }

  // possible 'block' type input values: grass, fence, narrow, wide, waterfront, residential, parking-lot, (new: archway, wall sp?)
  buildingsArray.forEach((currentValue, index) => {
    if (currentValue.length === 0) {
      return;
    } // if empty string then skip
    const side = index === 0 ? 'left' : 'right';
    const sideMultiplier = side === 'left' ? -1 : 1;

    const groundPositionX = (length / 4 + streetWidth / 2) * sideMultiplier;
    const buildingPositionX = (150 / 2 + streetWidth / 2) * sideMultiplier;

    // this is the logic to make the ground box
    if (showGround) {
      const variantToMaterialMapping = {
        grass: 'ground-grass-material',
        fence: 'ground-grass-material',
        'parking-lot': 'ground-parking-lot-material',
        residential: 'ground-grass-material',
        narrow: 'ground-asphalt-material',
        wide: 'ground-asphalt-material',
        arcade: 'ground-tiled-concrete-material',
        'compound-wall': 'ground-asphalt-material'
      };

      let groundParentEl;
      if (currentValue === 'waterfront') {
        groundParentEl = document.createElement('a-ocean-box');
        groundParentEl.setAttribute('geometry', {
          primitive: 'box',
          depth: length,
          width: length / 2,
          height: 2,
          segmentsHeight: 1,
          segmentsDepth: 10,
          segmentsWidth: 10
        });
        groundParentEl.setAttribute('position', { y: -3 });
      } else {
        groundParentEl = document.createElement('a-box');
        groundParentEl.setAttribute('depth', length);
        groundParentEl.setAttribute('height', 2);
        groundParentEl.setAttribute('width', length / 2);
        groundParentEl.setAttribute('shadow', '');
        // groundParentEl.setAttribute('material', 'src:#grass-texture;repeat:5 5;roughness:0.8;');
        groundParentEl.setAttribute(
          'mixin',
          variantToMaterialMapping[currentValue]
        ); // case grass, fence
        groundParentEl.setAttribute('position', { y: -1 });
      }

      if (side === 'right') {
        // groundParentEl.setAttribute('position', groundPositionX + ' -1 0');
        groundParentEl.setAttribute('position', { x: groundPositionX });
      } else {
        groundParentEl.setAttribute('position', { x: groundPositionX });
      }
      groundParentEl.classList.add('ground-' + side);
      groundParentEl.setAttribute(
        'data-layer-name',
        'Ground ' + side + ' • ' + currentValue
      );
      buildingElement.appendChild(groundParentEl);
    }

    // make building
    const buildingPos = {
      x: buildingPositionX,
      y: 0,
      z: index === 1 ? length / 2 : -length / 2
    };

    switch (currentValue) {
      case 'narrow':
      case 'wide':
        buildingPos.x += sideMultiplier * -72;
        break;
      case 'residential':
        buildingPos.x += sideMultiplier * -64;
        buildingPos.y = -0.58;
        // the grass should be slightly lower than the path - 0.17 instead of 0.2 for other buildings
        buildingElement.setAttribute('position', '0 0.17 0');
        break;
      case 'arcade':
        buildingPos.x += sideMultiplier * -70.5;
    }
    const newBuildings = createBuilding(currentValue, sideMultiplier);
    newBuildings.setAttribute(
      'data-layer-name',
      'Buildings ' + side + ' • ' + currentValue
    );

    newBuildings.setAttribute('position', buildingPos);
    buildingElement.append(newBuildings);

    if (currentValue === 'waterfront' || currentValue === 'compound-wall') {
      const objectPositionX = buildingPositionX - (sideMultiplier * 150) / 2;
      const placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', { x: objectPositionX, z: 4.5 }); // position="1.043 0.100 -3.463"
      let rotationCloneY;
      if (currentValue === 'compound-wall') {
        placedObjectEl.setAttribute('position', { y: 3 });
        placedObjectEl.setAttribute('position', {
          x: objectPositionX + 1.5 * sideMultiplier
        });
        rotationCloneY = side === 'left' ? 90 : -90;
      } else {
        rotationCloneY = side === 'left' ? -90 : 90;
      }
      placedObjectEl.setAttribute('data-layer-name', 'seawall-parent-' + side);
      placedObjectEl.setAttribute(
        'street-generated-clones',
        `model: seawall; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.8;`
      );
      buildingElement.appendChild(placedObjectEl);
    }

    if (currentValue === 'fence' || currentValue === 'parking-lot') {
      const objectPositionX = buildingPositionX - (sideMultiplier * 150) / 2;
      // make the parent for all the objects to be cloned
      const placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 4.625'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('data-layer-name', 'fence-parent');
      // clone a bunch of fences under the parent
      const rotationCloneY = side === 'right' ? -90 : 90;
      placedObjectEl.setAttribute(
        'street-generated-clones',
        `model: fence; length: ${length}; spacing: 9.25; facing: ${rotationCloneY}; cycleOffset: 1`
      );
      buildingElement.appendChild(placedObjectEl);
    }
  });
  return buildingElement;
}
module.exports.processBuildings = processBuildings;
