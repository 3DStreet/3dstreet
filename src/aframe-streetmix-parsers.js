// Orientation - default model orientation is "outbound" (away from camera)
var streetmixParsersTested = require('./tested/aframe-streetmix-parsers-tested');
var { segmentVariants } = require('./segments-variants.js');

const COLORS = {
  red: '#ff9393',
  blue: '#00b6b6',
  green: '#adff83',
  yellow: '#f7d117',
  lightGray: '#dddddd',
  white: '#ffffff',
  brown: '#664B00'
};

const TYPES = {
  'drive-lane': {
    surface: 'asphalt',
    color: COLORS.white
  },
  'bus-lane': {
    surface: 'asphalt',
    color: COLORS.red
  },
  'bike-lane': {
    surface: 'asphalt',
    color: COLORS.green
  },
  sidewalk: {
    surface: 'sidewalk',
    color: COLORS.white
  },
  'parking-lane': {
    surface: 'concrete',
    color: COLORS.lightGray
  },
  divider: {
    surface: 'hatched',
    color: COLORS.white
  },
  grass: {
    surface: 'grass',
    color: COLORS.white
  },
  rail: {
    surface: 'asphalt',
    color: COLORS.white
  }
};

// this function takes a list of segments and adds lane markings or "separator segments"
// these are 0 width segments inserted into the street json prior to rendering
// the basic logic is: if there are two adjacent "lane-ish" segments, then add lane separators
function insertSeparatorSegments(segments) {
  // first, let's define what is a lane that will likely need adajcent striping?
  function isLaneIsh(typeString) {
    return (
      typeString.slice(typeString.length - 4) === 'lane' ||
      typeString === 'light-rail' ||
      typeString === 'streetcar' ||
      typeString === 'flex-zone'
    );
  }

  // then let's go through the segments array and build a new one with inserted separators
  const newValues = segments.reduce(
    (newArray, currentValue, currentIndex, arr) => {
      // don't insert a lane marker before the first segment
      if (currentIndex === 0) {
        return newArray.concat(currentValue);
      }

      const previousValue = arr[currentIndex - 1];

      // if both adjacent lanes are "laneish"
      if (isLaneIsh(currentValue.type) && isLaneIsh(previousValue.type)) {
        // if in doubt start with a solid line
        var variantString = 'solid';

        // if adjacent lane types are identical, then used dashed lines
        if (currentValue.type === previousValue.type) {
          variantString = 'dashed';
        }

        // Or, if either is a drive lane or turn lane then use dashed
        // Using dash vs solid for turn lanes along approach to intersections may need to be user defined
        if (
          (currentValue.type === 'drive-lane' &&
            previousValue.type === 'turn-lane') ||
          (previousValue.type === 'drive-lane' &&
            currentValue.type === 'turn-lane')
        ) {
          variantString = 'dashed';
        }

        // if adjacent segments in opposite directions then use double yellow
        if (
          currentValue.variantString.split('|')[0] !==
          previousValue.variantString.split('|')[0]
        ) {
          variantString = 'doubleyellow';
          // if adjacenet segments are both bike lanes, then use yellow short dash
          if (
            currentValue.type === 'bike-lane' &&
            previousValue.type === 'bike-lane'
          ) {
            variantString = 'shortdashedyellow';
          }
          if (
            currentValue.type === 'flex-zone' ||
            previousValue.type === 'flex-zone'
          ) {
            variantString = 'solid';
          }
        }

        // special case -- if either lanes are turn lane shared, then use solid and long dash
        if (
          currentValue.type === 'turn-lane' &&
          currentValue.variantString.split('|')[1] === 'shared'
        ) {
          variantString = 'soliddashedyellow';
        } else if (
          previousValue.type === 'turn-lane' &&
          previousValue.variantString.split('|')[1] === 'shared'
        ) {
          variantString = 'soliddashedyellowinverted';
        }

        // if adjacent to parking lane with markings, do not draw white line
        if (
          currentValue.type === 'parking-lane' ||
          previousValue.type === 'parking-lane'
        ) {
          variantString = 'invisible';
        }

        newArray.push({
          type: 'separator',
          variantString: variantString,
          width: 0,
          elevation: currentValue.elevation
        });
      }

      // if a *lane segment and divider are adjacent, use a solid separator
      if (
        (isLaneIsh(currentValue.type) && previousValue.type === 'divider') ||
        (isLaneIsh(previousValue.type) && currentValue.type === 'divider')
      ) {
        newArray.push({
          type: 'separator',
          variantString: 'solid',
          width: 0,
          elevation: currentValue.elevation
        });
      }

      newArray.push(currentValue);
      return newArray;
    },
    []
  );
  return newValues;
}

function createRailsElement(length, railsPosX) {
  const placedObjectEl = document.createElement('a-entity');
  const railsGeometry = {
    primitive: 'box',
    depth: length,
    width: 0.1,
    height: 0.2
  };
  const railsMaterial = {
    // TODO: Add environment map for reflection on metal rails
    color: '#8f8f8f',
    metalness: 1,
    emissive: '#828282',
    emissiveIntensity: 0.5,
    roughness: 0.1
  };
  placedObjectEl.setAttribute('geometry', railsGeometry);
  placedObjectEl.setAttribute('material', railsMaterial);
  placedObjectEl.setAttribute('data-layer-name', 'rails');
  placedObjectEl.setAttribute('shadow', 'receive:true; cast: true');
  placedObjectEl.setAttribute('position', railsPosX + ' 0.2 0'); // position="1.043 0.100 -3.463"

  return placedObjectEl;
}

function createTracksParentElement(length, objectMixinId) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('data-layer-name', 'Tracks Parent');
  placedObjectEl.setAttribute('position', '0 -0.2 0'); // position="1.043 0.100 -3.463"
  // add rails
  const railsWidth = {
    // width as measured from center of rail, so 1/2 actual width
    tram: 0.7175, // standard gauge 1,435 mm
    trolley: 0.5335 // sf cable car rail gauge 1,067 mm
  };
  const railsPosX = railsWidth[objectMixinId];
  placedObjectEl.append(createRailsElement(length, railsPosX));
  placedObjectEl.append(createRailsElement(length, -railsPosX));

  return placedObjectEl;
}

function getRandomIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function getRandomArbitrary(min, max) {
  return Math.random() * (max - min) + min;
}

function getZPositions(start, end, step) {
  const len = Math.floor((end - start) / step) + 1;
  var arr = Array(len)
    .fill()
    .map((_, idx) => start + idx * step);
  return arr.sort(() => 0.5 - Math.random());
}

function createSidewalkClonedVariants(
  segmentWidthInMeters,
  density,
  streetLength,
  direction = 'random',
  animated = false
) {
  const xValueRange = [
    -(0.37 * segmentWidthInMeters),
    0.37 * segmentWidthInMeters
  ];
  const zValueRange = getZPositions(
    -0.5 * streetLength,
    0.5 * streetLength,
    1.5
  );
  const densityFactors = {
    empty: 0,
    sparse: 0.03,
    normal: 0.125,
    dense: 0.25
  };
  const totalPedestrianNumber = parseInt(
    densityFactors[density] * streetLength,
    10
  );
  const dividerParentEl = document.createElement('a-entity');
  dividerParentEl.setAttribute('data-layer-name', 'Pedestrians Parent');
  // Randomly generate avatars
  for (let i = 0; i < totalPedestrianNumber; i++) {
    const variantName =
      animated === true
        ? 'a_char' + String(getRandomIntInclusive(1, 8))
        : 'char' + String(getRandomIntInclusive(1, 16));
    const xVal = getRandomArbitrary(xValueRange[0], xValueRange[1]);
    const zVal = zValueRange.pop();
    const yVal = 0;
    // y = 0.2 for sidewalk elevation
    const placedObjectEl = document.createElement('a-entity');
    let animationDirection = 'inbound';
    placedObjectEl.setAttribute('position', { x: xVal, y: yVal, z: zVal });
    placedObjectEl.setAttribute('mixin', variantName);
    // Roughly 50% of traffic will be incoming
    if (Math.random() < 0.5 && direction === 'random') {
      placedObjectEl.setAttribute('rotation', '0 180 0');
      animationDirection = 'outbound';
    }

    if (animated) {
      addLinearStreetAnimation(
        placedObjectEl,
        1.4,
        streetLength,
        xVal,
        zVal,
        animationDirection
      );
    }
    dividerParentEl.append(placedObjectEl);
  }

  return dividerParentEl;
}

function getSegmentColor(variant) {
  if ((variant === 'red') | (variant === 'colored')) {
    return COLORS.red;
  }
  if (variant === 'blue') {
    return COLORS.blue;
  }
  if ((variant === 'green') | (variant === 'grass')) {
    return COLORS.green;
  }
  return COLORS.white;
}

function addLinearStreetAnimation(
  reusableObjectEl,
  speed,
  streetLength,
  xPos,
  zPos,
  direction
) {
  const totalStreetDuration = (streetLength / speed) * 1000; // time in milliseconds
  const halfStreet =
    direction === 'outbound' ? -streetLength / 2 : streetLength / 2;
  const startingDistanceToTravel = Math.abs(halfStreet - zPos);
  const startingDuration = (startingDistanceToTravel / speed) * 1000;

  const animationAttrs1 = {
    property: 'position',
    easing: 'linear',
    loop: 'false',
    from: { x: xPos, y: 0, z: zPos },
    to: { z: halfStreet },
    dur: startingDuration
  };
  const animationAttrs2 = {
    property: 'position',
    easing: 'linear',
    loop: 'true',
    from: { x: xPos, y: 0, z: -halfStreet },
    to: { x: xPos, y: 0, z: halfStreet },
    delay: startingDuration,
    dur: totalStreetDuration
  };
  reusableObjectEl.setAttribute('animation__1', animationAttrs1);
  reusableObjectEl.setAttribute('animation__2', animationAttrs2);

  return reusableObjectEl;
}

function createWayfindingElements() {
  const wayfindingParentEl = document.createElement('a-entity');
  let reusableObjectEl;

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', '0 1 0');
  reusableObjectEl.setAttribute('mixin', 'wayfinding-box');
  wayfindingParentEl.append(reusableObjectEl);

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', '0 1.2 0.06');
  reusableObjectEl.setAttribute(
    'geometry',
    'primitive: plane; width: 0.8; height: 1.6'
  );
  reusableObjectEl.setAttribute('material', 'src:#wayfinding-map');
  wayfindingParentEl.append(reusableObjectEl);

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', '0 1.2 -0.06');
  reusableObjectEl.setAttribute('rotation', '0 180 0');
  reusableObjectEl.setAttribute(
    'geometry',
    'primitive: plane; width: 0.8; height: 1.6'
  );
  reusableObjectEl.setAttribute('material', 'src:#wayfinding-map');
  wayfindingParentEl.append(reusableObjectEl);

  return wayfindingParentEl;
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

function calculateHeight(elevation) {
  const stepLevel = 0.15;
  if (elevation <= 0) {
    return stepLevel;
  }
  return stepLevel * (elevation + 1);
}

function createSeparatorElement(
  positionY,
  rotationY,
  mixinId,
  length,
  repeatCount,
  elevation = 0
) {
  var segmentEl = document.createElement('a-entity');
  const scaleY = length / 150;
  const scalePlane = '1 ' + scaleY + ' 1';

  segmentEl.setAttribute('rotation', '270 ' + rotationY + ' 0');
  segmentEl.setAttribute('scale', scalePlane);

  let posY = calculateHeight(elevation) + positionY;
  // take into account elevation property and add to positionY
  segmentEl.setAttribute('position', '0 ' + posY + ' 0');
  segmentEl.setAttribute('mixin', mixinId);

  if (repeatCount.length !== 0) {
    segmentEl.setAttribute(
      'material',
      `repeat: ${repeatCount[0]} ${repeatCount[1]}`
    );
  }

  return segmentEl;
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
  // add additional 0-width segments for stripes (painted markers)
  if (showStriping) {
    segments = insertSeparatorSegments(segments);
  }

  // create and center offset to center the street around global x position of 0
  var streetParentEl = createCenteredStreetElement(segments);
  streetParentEl.classList.add('street-parent');
  streetParentEl.setAttribute('data-layer-name', 'Street Segments Container');
  streetParentEl.setAttribute('data-no-transform', '');

  // experimental - create a new array children for the new data structure
  let newManagedStreetDataStructureChildren = [];

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
    var segmentColor = null;
    var segmentParentEl = document.createElement('a-entity');
    segmentParentEl.classList.add('segment-parent-' + i);

    var segmentWidthInMeters = segments[i].width;
    // console.log('Type: ' + segments[i].type + '; Width: ' + segmentWidthInFeet + 'ft / ' + segmentWidthInMeters + 'm');

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    var segmentPositionX = cumulativeWidthInMeters - 0.5 * segmentWidthInMeters;
    var positionY = 0;

    // get variantString
    var variantList = segments[i].variantString
      ? segments[i].variantString.split('|')
      : '';

    // show warning message if segment or variantString are not supported
    supportCheck(segments[i].type, segments[i].variantString);

    // elevation property from streetmix segment
    const elevation = segments[i].elevation;

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY =
      variantList[0] === 'inbound' || variantList[1] === 'inbound' ? 180 : 0;

    // the A-Frame mixin ID is often identical to the corresponding streetmix segment "type" by design, let's start with that
    var segmentPreset = segments[i].type;

    // repeat value for material property - repeatCount[0] is x texture repeat and repeatCount[1] is y texture repeat
    const repeatCount = [];

    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `model: sharrow; length: ${length}; cycleOffset: 0.2; spacing: 15; facing: ${rotationY}`
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
        `model: bike-arrow; length: ${length}; cycleOffset: 0.3; spacing: 20; facing: ${rotationY};`
      );
      const rotationCloneY = variantList[0] === 'inbound' ? 0 : 180;
      segmentParentEl.setAttribute(
        'street-generated-random',
        `modelsArray: cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-dutch, cyclist-kid${segments[i].type === 'scooter' ? 'ElectricScooter_1' : ''};
        length: ${length};
        placeLength: 2.03;
        facing: ${rotationCloneY};
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
          'street-generated-random',
          `model: ${objectMixinId}; length: ${length}; placeLength: 23; facing: ${rotationY}; count: 1;`
        );
      }
      // make the parent for all the objects to be cloned
      const tracksParentEl = createTracksParentElement(length, objectMixinId);
      // add these trains to the segment parent
      segmentParentEl.append(tracksParentEl);
    } else if (segments[i].type === 'turn-lane') {
      segmentPreset = 'drive-lane'; // use normal drive lane road material
      if (showVehicles && variantList[1] !== 'shared') {
        const rotationCloneY = variantList[0] === 'inbound' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-random',
          `modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
            length: ${length};
            placeLength: 7.3;
            facing: ${rotationCloneY};
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
        `model: ${markerMixinId}; length: ${length}; cycleOffset: 0.4; spacing: 20; facing: ${rotationY};`
      );
      if (variantList[1] === 'shared') {
        segmentParentEl.setAttribute(
          'street-generated-stencil__2',
          `model: ${markerMixinId}; length: ${length}; cycleOffset: 0.3; spacing: 20; facing: ${rotationY + 180};`
        );
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      segmentPreset = 'divider';
      // make some bollards
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: bollard; spacing: 4; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'flowers') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: dividers-flowers; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planting-strip'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: dividers-planting-strip; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planter-box'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: dividers-planter-box; spacing: 2.45; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'palm-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: palm-tree; length: ${length}`
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'big-tree'
    ) {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: tree3; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'bush') {
      segmentPreset = 'grass';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: dividers-bush; spacing: 2.25; length: ${length}`
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'dome') {
      segmentPreset = 'divider';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
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
        'street-generated-fixed',
        `model: temporary-barricade; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'traffic-cone'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: temporary-traffic-cone; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-plastic'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: jersey-barrier-plastic; spacing: 2.25; length: ${length}`
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-concrete'
    ) {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: temporary-jersey-barrier-concrete; spacing: 2.93; length: ${length}`
      );
    } else if (
      segments[i].type === 'bus-lane' ||
      segments[i].type === 'brt-lane'
    ) {
      // get the color for a bus lane
      segmentColor = getSegmentColor(variantList[1]);

      if (showVehicles) {
        const rotationY = variantList[0] === 'inbound' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-random',
          `model: bus; length: ${length}; placeLength: 15; facing: ${rotationY}; count: 1;`
        );
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `stencils: word-only, word-taxi, word-bus; length: ${length}; spacing: 40; padding: 10; facing: ${rotationY}`
      );
    } else if (segments[i].type === 'drive-lane') {
      if (showVehicles) {
        // const isAnimated = variantList[2] === 'animated' || globalAnimated;
        const rotationCloneY = variantList[0] === 'inbound' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-random',
          `modelsArray: sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike;
            length: ${length};
            placeLength: 7.3;
            facing: ${rotationCloneY};
            count: ${getRandomIntInclusive(2, 4)};`
        );
      }
    } else if (segments[i].type === 'food-truck') {
      segmentPreset = 'drive-lane';
      const rotationCloneY = variantList[0] === 'left' ? 0 : 180;
      segmentParentEl.setAttribute(
        'street-generated-random',
        `model: food-trailer-rig; length: ${length}; placeLength: 7; facing: ${rotationCloneY}; count: 2;`
      );
    } else if (segments[i].type === 'flex-zone') {
      segmentPreset = 'parking-lane';
      if (showVehicles) {
        const objectMixinId =
          variantList[0] === 'taxi' ? 'sedan-taxi-rig' : 'sedan-rig';
        const rotationCloneY = variantList[1] === 'inbound' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-random',
          `model: ${objectMixinId}; length: ${length}; placeLength: 5; facing: ${rotationCloneY}; count: 4;`
        );
      }
      segmentParentEl.setAttribute(
        'street-generated-stencil',
        `stencils: word-loading-small, word-only-small; length: ${length}; spacing: 40; padding: 10; facing: ${rotationY}`
      );
    } else if (segments[i].type === 'sidewalk' && variantList[0] !== 'empty') {
      // handles variantString with value sparse, normal, or dense sidewalk
      const isAnimated = variantList[1] === 'animated' || globalAnimated;
      segmentParentEl.append(
        createSidewalkClonedVariants(
          segmentWidthInMeters,
          variantList[0],
          length,
          'random',
          isAnimated
        )
      );
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      segmentParentEl.append(createWayfindingElements());
    } else if (segments[i].type === 'sidewalk-bench') {
      const rotationCloneY = variantList[0] === 'right' ? -90 : 90;
      if (variantList[0] === 'center') {
        segmentParentEl.setAttribute(
          'street-generated-fixed',
          `model: bench_orientation_center; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      } else {
        // `right` or `left` bench
        segmentParentEl.setAttribute(
          'street-generated-fixed',
          `model: bench; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.1`
        );
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      const rotationCloneY = variantList[1] === 'sidewalk-parallel' ? 90 : 0;
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: bikerack; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.2`
      );
      // add bike racks to the segment parent
    } else if (segments[i].type === 'magic-carpet') {
      segmentPreset = 'drive-lane';
      segmentParentEl.setAttribute(
        'street-generated-single',
        `model: magic-carpet;
        length: ${length};
        positionY: 1.2;`
      );
      segmentParentEl.setAttribute(
        'street-generated-single__2',
        `model: Character_1_M;
        length: ${length};
        positionY: 1.2;`
      );
    } else if (segments[i].type === 'outdoor-dining') {
      segmentPreset = variantList[1] === 'road' ? 'drive-lane' : 'sidewalk';
      segmentParentEl.setAttribute(
        'street-generated-random',
        `model: outdoor_dining; length: ${length}; placeLength: 2.27; count: 5;`
      );
    } else if (segments[i].type === 'parklet') {
      segmentPreset = 'drive-lane';
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-random',
        `model: parklet; length: ${length}; placeLength: 4; count: 3; facing: ${rotationCloneY};`
      );
    } else if (segments[i].type === 'bikeshare') {
      const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-single',
        `model: bikeshare; length: ${length}; facing: ${rotationCloneY}; justify: middle;`
      );
    } else if (segments[i].type === 'utilities') {
      const rotationCloneY = variantList[0] === 'right' ? 180 : 0;
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: utility_pole; length: ${length}; cycleOffset: 0.25; facing: ${rotationCloneY}`
      );
    } else if (segments[i].type === 'sidewalk-tree') {
      const objectMixinId =
        variantList[0] === 'palm-tree' ? 'palm-tree' : 'tree3';
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: ${objectMixinId}; length: ${length}; randomFacing: true;`
      );
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      (variantList[1] === 'modern' || variantList[1] === 'pride')
    ) {
      if (variantList[0] === 'both') {
        segmentParentEl.setAttribute(
          'street-generated-fixed',
          `model: lamp-modern-double; length: ${length}; cycleOffset: 0.4;`
        );
      } else {
        var rotationCloneY = variantList[0] === 'right' ? 0 : 180;
        segmentParentEl.setAttribute(
          'street-generated-fixed',
          `model: lamp-modern; length: ${length}; facing: ${rotationCloneY}; cycleOffset: 0.4;`
        );
      }
      // Add the pride flags to the lamp posts
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'right' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-fixed__2',
          `model: pride-flag; length: ${length}; cycleOffset: 0.4; positionX: 0.409; positionY: 5;`
        );
      }
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'left' || variantList[0] === 'both')
      ) {
        segmentParentEl.setAttribute(
          'street-generated-fixed__2',
          `model: pride-flag; length: ${length}; facing: 180; cycleOffset: 0.4; positionX: -0.409; positionY: 5;`
        );
      }
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      variantList[1] === 'traditional'
    ) {
      segmentParentEl.setAttribute(
        'street-generated-fixed',
        `model: lamp-traditional; length: ${length};`
      );
    } else if (segments[i].type === 'transit-shelter') {
      var rotationBusStopY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.setAttribute(
        'street-generated-single',
        `model: bus-stop; length: ${length}; facing: ${rotationBusStopY};`
      );
    } else if (segments[i].type === 'brt-station') {
      segmentParentEl.setAttribute(
        'street-generated-single',
        `model: brt-station; length: ${length};`
      );
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'dashed'
    ) {
      segmentPreset = 'dashed-stripe';
      positionY = 0.01; // make sure the lane marker is above the asphalt
      // for all markings material property repeat = "1 25". So every 150/25=6 meters put a dash
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 6);
    } else if (segments[i].type === 'separator' && variantList[0] === 'solid') {
      segmentPreset = 'solid-stripe';
      positionY = 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'doubleyellow'
    ) {
      segmentPreset = 'solid-doubleyellow';
      positionY = 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'shortdashedyellow'
    ) {
      segmentPreset = 'short-dashed-stripe-yellow';
      positionY = 0.01; // make sure the lane marker is above the asphalt
      // for short-dashed-stripe every 3 meters put a dash
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 3);
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'soliddashedyellow'
    ) {
      segmentPreset = 'solid-dashed-yellow';
      positionY = 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'soliddashedyellowinverted'
    ) {
      segmentPreset = 'solid-dashed-yellow';
      positionY = 0.01; // make sure the lane marker is above the asphalt
      rotationY = '180';
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 6);
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
      }

      segmentParentEl.setAttribute(
        'street-generated-random',
        `modelsArray: sedan-rig, self-driving-waymo-car, suv-rig;
          length: ${length};
          placeLength: ${carStep};
          count: ${getRandomIntInclusive(6, 8)};
          facing: ${markingsRotZ - 90};` // this needs work -- the rotation is off by 180 degrees on the right side for perpendicular and angled variants
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
    if (segments[i].type !== 'separator') {
      segmentParentEl.setAttribute('street-segment', 'type', segmentPreset);
      segmentParentEl.setAttribute(
        'street-segment',
        'width',
        segmentWidthInMeters
      );
      segmentParentEl.setAttribute('street-segment', 'length', length);
      segmentParentEl.setAttribute('street-segment', 'elevation', elevation);
      segmentParentEl.setAttribute(
        'street-segment',
        'color',
        segmentColor ?? TYPES[segmentPreset]?.color
      );
      segmentParentEl.setAttribute(
        'street-segment',
        'surface',
        TYPES[segmentPreset]?.surface
      );
      // experimental - output the new data structure
      let childData = {
        id: segments[i].id, // this will collide with other segment ID if there are multiple streets placed with identical segment id's
        type: segments[i].type,
        width: segmentWidthInMeters,
        elevation: elevation
      };
      newManagedStreetDataStructureChildren.push(childData);
    } else {
      segmentParentEl.append(
        createSeparatorElement(
          positionY,
          rotationY,
          segmentPreset,
          length,
          repeatCount,
          elevation
        )
      );
    }
    // returns JSON output instead
    // append the new surfaceElement to the segmentParentEl
    streetParentEl.append(segmentParentEl);
    segmentParentEl.setAttribute('position', segmentPositionX + ' 0 0');
    segmentParentEl.setAttribute(
      'data-layer-name',
      'Segment • ' + segments[i].type + ', ' + variantList[0]
    );
  }
  // experimental, output the new data structure
  let newManagedStreetDataStructureInstance = {
    // name: "string", // streetmix name not accessible from this function
    type: 'managed_street',
    width: cumulativeWidthInMeters, // this is the user-specified RoW width, not cumulative width of segments
    // length: float, // not accessible from this function
    // transform: {
    // 	position: { x: float, y: float, z: float}
    // 	rotation: { x: float, y: float, z: float}
    // 	scale: { x: float, y: float, z: float}
    // },
    children: newManagedStreetDataStructureChildren
  };
  console.log(newManagedStreetDataStructureInstance);

  // create new brown box to represent ground underneath street
  const dirtBox = document.createElement('a-box');
  const xPos = cumulativeWidthInMeters / 2;
  dirtBox.setAttribute('position', `${xPos} -1 0`); // what is x? x = 0 - cumulativeWidthInMeters / 2
  dirtBox.setAttribute('height', 2); // height is 2 meters from y of -0.1 to -y of 2.1
  dirtBox.setAttribute('width', cumulativeWidthInMeters);
  dirtBox.setAttribute('depth', length - 0.2); // depth is length - 0.1 on each side
  dirtBox.setAttribute('material', `color: ${COLORS.brown};`);
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
        'street-generated-fixed',
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
        'street-generated-fixed',
        `model: fence; length: ${length}; spacing: 9.25; facing: ${rotationCloneY}; cycleOffset: 1`
      );
      buildingElement.appendChild(placedObjectEl);
    }
  });
  return buildingElement;
}
module.exports.processBuildings = processBuildings;
