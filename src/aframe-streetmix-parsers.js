/* global THREE */

// Orientation - default model orientation is "outbound" (away from camera)
var streetmixParsersTested = require('./tested/aframe-streetmix-parsers-tested');
var { segmentVariants } = require('./segments-variants.js');

function cloneMixinAsChildren({
  objectMixinId = '',
  parentEl = null,
  step = 15,
  radius = 60,
  rotation = '0 0 0',
  positionXYString = '0 0',
  length = undefined,
  randomY = false
}) {
  for (let j = radius * -1; j <= radius; j = j + step) {
    const placedObjectEl = document.createElement('a-entity');
    placedObjectEl.setAttribute('mixin', objectMixinId);
    placedObjectEl.setAttribute('class', objectMixinId);
    placedObjectEl.setAttribute('position', positionXYString + ' ' + j);

    if (length) {
      placedObjectEl.addEventListener('loaded', (evt) => {
        evt.target.setAttribute('geometry', 'height', length);
        evt.target.setAttribute('atlas-uvs', 'c', 1);
      });
    }

    if (randomY) {
      placedObjectEl.setAttribute(
        'rotation',
        '0 ' + Math.floor(randomTestable() * 361) + ' 0'
      );
    } else {
      placedObjectEl.setAttribute('rotation', rotation);
    }
    // add the new elmement to DOM
    parentEl.append(placedObjectEl);
    // could be good to use geometry merger https://github.com/supermedium/superframe/tree/master/components/geometry-merger
  }
}

function randomTestable() {
  return Math.random();
}

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

  // console.log('newValues =', newValues)
  // console.log(segments);

  return newValues;
}

function createStencilsParentElement(position) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'stencils-parent');
  placedObjectEl.setAttribute('position', position); // position="1.043 0.100 -3.463"
  return placedObjectEl;
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
  placedObjectEl.setAttribute('class', 'rails');
  placedObjectEl.setAttribute('shadow', 'receive:true; cast: true');
  placedObjectEl.setAttribute('position', railsPosX + ' 0.2 0'); // position="1.043 0.100 -3.463"

  return placedObjectEl;
}

function createTracksParentElement(length, objectMixinId) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'track-parent');
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

function createSafehitsParentElement() {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'safehit-parent');
  return placedObjectEl;
}

function createParentElement(className) {
  const parentEl = document.createElement('a-entity');
  parentEl.setAttribute('class', className);
  return parentEl;
}

function createDividerVariant(variantName, clonedObjectRadius, step = 2.25) {
  const dividerParentEl = createParentElement(`dividers-${variantName}-parent`);
  cloneMixinAsChildren({
    objectMixinId: `dividers-${variantName}`,
    parentEl: dividerParentEl,
    step: step,
    radius: clonedObjectRadius
  });
  return dividerParentEl;
}

function createClonedVariants(
  variantName,
  clonedObjectRadius,
  step = 2.25,
  rotation = '0 0 0'
) {
  const dividerParentEl = createParentElement(`${variantName}-parent`);
  cloneMixinAsChildren({
    objectMixinId: variantName,
    parentEl: dividerParentEl,
    step: step,
    radius: clonedObjectRadius,
    rotation: rotation
  });
  return dividerParentEl;
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
  elevationPosY = 0,
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
  const dividerParentEl = createParentElement('pedestrians-parent');
  dividerParentEl.setAttribute('position', { y: elevationPosY });
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
        yVal,
        zVal,
        animationDirection
      );
    }
    dividerParentEl.append(placedObjectEl);
  }

  return dividerParentEl;
}

function getBikeLaneMixin(variant) {
  if (variant === 'red') {
    return 'surface-red bike-lane';
  }
  if (variant === 'blue') {
    return 'surface-blue bike-lane';
  }
  if (variant === 'green') {
    return 'surface-green bike-lane';
  }
  return 'bike-lane';
}

function getBusLaneMixin(variant) {
  if ((variant === 'colored') | (variant === 'red')) {
    return 'surface-red bus-lane';
  }
  if (variant === 'blue') {
    return 'surface-blue bus-lane';
  }
  if (variant === 'grass') {
    return 'surface-green bus-lane';
  }
  return 'bus-lane';
}

function getDimensions(object3d) {
  var box = new THREE.Box3().setFromObject(object3d);
  var x = box.max.x - box.min.x;
  var y = box.max.y - box.min.y;
  var z = box.max.z - box.min.z;

  return { x, y, z };
}

function getStartEndPosition(streetLength, objectLength) {
  // get the start and end position for placing an object on a line
  // computed by length of the street and object's length
  const start = -0.5 * streetLength + 0.5 * objectLength;
  const end = 0.5 * streetLength - 0.5 * objectLength;
  return { start, end };
}

function randomPosition(entity, axis, length, objSizeAttr = undefined) {
  // place randomly an element on a line length='length' on the axis 'axis'
  // Need to call from 'model-loaded' event if objSizeAttr is undefined
  // existEnts - array with existing entities (for prevent intersection)
  const newObject = entity.object3D;
  const objSize = objSizeAttr || getDimensions(newObject)[axis];
  const { start, end } = getStartEndPosition(length, objSize);
  const setFunc = `set${axis.toUpperCase()}`;
  const newPosition = getRandomArbitrary(start, end);
  newObject.position[setFunc](newPosition);
  return newPosition;
}

function createChooChooElement(
  variantList,
  objectMixinId,
  length,
  showVehicles
) {
  if (!showVehicles) {
    return;
  }
  const rotationY = variantList[0] === 'inbound' ? 0 : 180;
  const placedObjectEl = document.createElement('a-entity');
  const tramLength = 23;
  placedObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  placedObjectEl.setAttribute('mixin', objectMixinId);
  placedObjectEl.setAttribute('class', objectMixinId);
  const positionZ = randomPosition(placedObjectEl, 'z', length, tramLength);
  placedObjectEl.setAttribute('position', '0 0 ' + positionZ);
  return placedObjectEl;
}

function createBusElement(variantList, length, showVehicles) {
  if (!showVehicles) {
    return;
  }
  const rotationY = variantList[0] === 'inbound' ? 0 : 180;
  const busParentEl = document.createElement('a-entity');
  const busLength = 12;
  const busObjectEl = document.createElement('a-entity');
  busObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  busObjectEl.setAttribute('mixin', 'bus');
  const positionZ = randomPosition(busObjectEl, 'z', length, busLength);
  busObjectEl.setAttribute('position', '0 0 ' + positionZ);
  busParentEl.append(busObjectEl);

  return busParentEl;
}

function addLinearStreetAnimation(
  reusableObjectEl,
  speed,
  streetLength,
  xPos,
  yVal = 0,
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
    from: { x: xPos, y: yVal, z: zPos },
    to: { z: halfStreet },
    dur: startingDuration
  };
  const animationAttrs2 = {
    property: 'position',
    easing: 'linear',
    loop: 'true',
    from: { x: xPos, y: yVal, z: -halfStreet },
    to: { x: xPos, y: yVal, z: halfStreet },
    delay: startingDuration,
    dur: totalStreetDuration
  };
  reusableObjectEl.setAttribute('animation__1', animationAttrs1);
  reusableObjectEl.setAttribute('animation__2', animationAttrs2);

  return reusableObjectEl;
}

function createDriveLaneElement(
  variantList,
  segmentWidthInMeters,
  streetLength,
  animated = false,
  showVehicles = true,
  count = 1,
  carStep = undefined
) {
  if (!showVehicles) {
    return;
  }
  let speed = 0;
  let [lineVariant, direction, carType] = variantList;
  if (variantList.length === 2) {
    carType = direction;
    direction = lineVariant;
  }

  const rotationVariants = {
    inbound: 0,
    outbound: 180,
    sideways: {
      left: -90,
      right: 90
    },
    'angled-front-left': -60,
    'angled-front-right': 60,
    'angled-rear-left': -120,
    'angled-rear-right': 120
  };
  let rotationY;
  if (lineVariant === 'sideways') {
    rotationY = rotationVariants['sideways'][direction];
  } else {
    rotationY = rotationVariants[lineVariant];
  }

  if (carType === 'pedestrian') {
    return createSidewalkClonedVariants(
      segmentWidthInMeters,
      'normal',
      0,
      streetLength,
      direction,
      animated
    );
  }

  const driveLaneParentEl = document.createElement('a-entity');

  if (variantList.length === 1) {
    // if there is no cars
    return driveLaneParentEl;
  }

  const carParams = {
    car: {
      mixin: 'sedan-rig',
      wheelDiameter: 0.76,
      length: 5.17,
      width: 2
    },
    microvan: {
      mixin: 'suv-rig',
      wheelDiameter: 0.84,
      length: 5,
      width: 2
    },
    truck: {
      mixin: 'box-truck-rig',
      wheelDiameter: 1.05,
      length: 6.95,
      width: 2.5
    },
    // autonomous vehicle
    av: {
      mixin: 'self-driving-cruise-car-rig',
      wheelDiameter: 0.76,
      length: 5.17,
      width: 2
    }
  };

  // default drive-lane variant if selected variant (carType) is not supported
  if (!carParams[carType]) {
    carType = 'car';
  }
  function createCar(positionZ = undefined, carType = 'car') {
    const params = carParams[carType];

    const reusableObjectEl = document.createElement('a-entity');

    if (!positionZ) {
      positionZ = randomPosition(
        reusableObjectEl,
        'z',
        streetLength,
        params['length']
      );
    }
    reusableObjectEl.setAttribute('position', `0 0 ${positionZ}`);
    reusableObjectEl.setAttribute('mixin', params['mixin']);
    reusableObjectEl.setAttribute('rotation', `0 ${rotationY} 0`);

    if (animated) {
      speed = 5; // meters per second
      reusableObjectEl.setAttribute('wheel', {
        speed: speed,
        wheelDiameter: params['wheelDiameter']
      });
      addLinearStreetAnimation(
        reusableObjectEl,
        speed,
        streetLength,
        0,
        0,
        positionZ,
        direction
      );
    }
    driveLaneParentEl.append(reusableObjectEl);
    return reusableObjectEl;
  }

  // create one or more randomly placed cars

  if (count > 1) {
    const halfStreet = streetLength / 2;
    const halfParkingLength = carStep / 2 + carStep;
    const allPlaces = getZPositions(
      -halfStreet + halfParkingLength,
      halfStreet - halfParkingLength,
      carStep
    );
    const randPlaces = allPlaces.slice(0, count);
    const carSizeZ =
      lineVariant === 'sideways' || lineVariant.includes('angled')
        ? 'width'
        : 'length';

    const carSizeValueZ = carParams[carType][carSizeZ];

    randPlaces.forEach((randPositionZ) => {
      const maxDist = carStep - carSizeValueZ - 0.2;
      // randOffset is for randomly displacement in a parking space (+/- maxDist)
      const randOffset = -maxDist / 2 + maxDist * Math.random();
      if (maxDist > 0) {
        // if the car fits in the parking space
        const positionZ = randPositionZ + randOffset;
        createCar(positionZ, carType);
      }
    });
  } else {
    createCar(undefined, carType);
  }

  return driveLaneParentEl;
}

function createFoodTruckElement(variantList, length) {
  const foodTruckParentEl = document.createElement('a-entity');

  const reusableObjectEl = document.createElement('a-entity');
  const foodTruckLength = 7;
  const rotationY = variantList[0] === 'left' ? 0 : 180;
  reusableObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  reusableObjectEl.setAttribute('mixin', 'food-trailer-rig');

  const positionZ = randomPosition(
    reusableObjectEl,
    'z',
    length,
    foodTruckLength
  );
  reusableObjectEl.setAttribute('positon', '0 0 ' + positionZ);
  foodTruckParentEl.append(reusableObjectEl);

  return foodTruckParentEl;
}

function createMagicCarpetElement(showVehicles) {
  if (!showVehicles) {
    return;
  }
  const magicCarpetParentEl = document.createElement('a-entity');

  const reusableObjectEl1 = document.createElement('a-entity');
  reusableObjectEl1.setAttribute('position', '0 1.75 0');
  reusableObjectEl1.setAttribute('rotation', '0 0 0');
  reusableObjectEl1.setAttribute('mixin', 'magic-carpet');
  magicCarpetParentEl.append(reusableObjectEl1);
  const reusableObjectEl2 = document.createElement('a-entity');
  reusableObjectEl2.setAttribute('position', '0 1.75 0');
  reusableObjectEl2.setAttribute('rotation', '0 0 0');
  reusableObjectEl2.setAttribute('mixin', 'Character_1_M');
  magicCarpetParentEl.append(reusableObjectEl2);

  return magicCarpetParentEl;
}

function randPlacedElements(streetLength, objLength, count) {
  const placeLength = objLength / 2 + objLength;
  const allPlaces = getZPositions(
    -streetLength / 2 + placeLength / 2,
    streetLength / 2 - placeLength / 2,
    placeLength
  );
  return allPlaces.slice(0, count);
}

function createOutdoorDining(length, posY) {
  const outdoorDiningParentEl = document.createElement('a-entity');
  const outdorDiningLength = 2.27;

  const randPlaces = randPlacedElements(length, outdorDiningLength, 5);
  randPlaces.forEach((randPosZ) => {
    const reusableObjectEl = document.createElement('a-entity');
    reusableObjectEl.setAttribute('mixin', 'outdoor_dining');

    // const positionZ = randomPosition(reusableObjectEl, 'z', length, outdorDiningLength);
    reusableObjectEl.setAttribute('position', { y: posY, z: randPosZ });
    outdoorDiningParentEl.append(reusableObjectEl);
  });

  return outdoorDiningParentEl;
}

function createMicroMobilityElement(
  variantList,
  segmentType,
  posY = 0,
  length,
  showVehicles,
  animated = false
) {
  if (!showVehicles) {
    return;
  }
  const microMobilityParentEl = document.createElement('a-entity');

  const bikeLength = 2.03;
  const bikeCount = getRandomIntInclusive(2, 5);

  const cyclistMixins = [
    'cyclist-cargo',
    'cyclist1',
    'cyclist2',
    'cyclist3',
    'cyclist-dutch',
    'cyclist-kid'
  ];

  const countCyclist = cyclistMixins.length;
  let mixinId = 'Bicycle_1';
  const randPlaces = randPlacedElements(length, bikeLength, bikeCount);
  randPlaces.forEach((randPosZ) => {
    const reusableObjectEl = document.createElement('a-entity');
    const rotationY = variantList[0] === 'inbound' ? 0 : 180;
    reusableObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
    reusableObjectEl.setAttribute('position', { y: posY, z: randPosZ });

    if (animated) {
      reusableObjectEl.setAttribute('animation-mixer', '');
      const speed = 5;
      addLinearStreetAnimation(
        reusableObjectEl,
        speed,
        length,
        0,
        posY,
        randPosZ,
        variantList[0]
      );
    }
    if (segmentType === 'bike-lane') {
      mixinId = cyclistMixins[getRandomIntInclusive(0, countCyclist)];
    } else {
      mixinId = 'ElectricScooter_1';
    }

    reusableObjectEl.setAttribute('mixin', mixinId);
    microMobilityParentEl.append(reusableObjectEl);
  });

  return microMobilityParentEl;
}

function createFlexZoneElement(variantList, length, showVehicles = true) {
  if (!showVehicles) {
    return;
  }
  const flexZoneParentEl = document.createElement('a-entity');
  const carLength = 5;
  const carCount = getRandomIntInclusive(2, 4);
  const randPlaces = randPlacedElements(length, carLength, carCount);
  randPlaces.forEach((randPosZ) => {
    const reusableObjectEl = document.createElement('a-entity');
    const rotationY = variantList[1] === 'inbound' ? 0 : 180;
    reusableObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
    if (variantList[0] === 'taxi') {
      reusableObjectEl.setAttribute('mixin', 'sedan-taxi-rig');
    } else if (variantList[0] === 'rideshare') {
      reusableObjectEl.setAttribute('mixin', 'sedan-rig');
    }
    reusableObjectEl.setAttribute('position', { z: randPosZ });
    flexZoneParentEl.append(reusableObjectEl);
  });

  return flexZoneParentEl;
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

function createBenchesParentElement() {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bench-parent');
  // y = 0.2 for sidewalk elevation
  placedObjectEl.setAttribute('position', '0 0.2 3.5');
  return placedObjectEl;
}

function createBikeRacksParentElement(posY) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bikerack-parent');
  placedObjectEl.setAttribute('position', { y: posY, z: -3.5 });
  return placedObjectEl;
}

function createBikeShareStationElement(variantList, posY) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bikeshare');
  placedObjectEl.setAttribute('mixin', 'bikeshare');
  const rotationCloneY = variantList[0] === 'left' ? 90 : 270;
  placedObjectEl.setAttribute('rotation', '0 ' + rotationCloneY + ' 0');
  placedObjectEl.setAttribute('position', { y: posY });
  return placedObjectEl;
}

function createParkletElement(length, variantList) {
  const parkletParent = document.createElement('a-entity');
  const parkletLength = 4.03;
  const parkletCount = 3;
  const randPlaces = randPlacedElements(length, parkletLength, parkletCount);
  randPlaces.forEach((randPosZ) => {
    const placedObjectEl = document.createElement('a-entity');
    placedObjectEl.setAttribute('class', 'parklet');
    placedObjectEl.setAttribute('position', { x: 0, y: 0.02, z: randPosZ });
    placedObjectEl.setAttribute('mixin', 'parklet');
    const rotationY = variantList[0] === 'left' ? 90 : 270;
    placedObjectEl.setAttribute('rotation', { y: rotationY });
    parkletParent.append(placedObjectEl);
  });
  return parkletParent;
}

function createTreesParentElement() {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'tree-parent');
  // y = 0.2 for sidewalk elevation
  placedObjectEl.setAttribute('position', '0 0.2 7');
  return placedObjectEl;
}

function createLampsParentElement() {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'lamp-parent');
  // y = 0.2 for sidewalk elevation
  placedObjectEl.setAttribute('position', '0 0.2 0'); // position="1.043 0.100 -3.463"
  return placedObjectEl;
}

function createBusStopElement(rotationBusStopY, posY) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bus-stop');
  placedObjectEl.setAttribute('rotation', '0 ' + rotationBusStopY + ' 0');
  placedObjectEl.setAttribute('mixin', 'bus-stop');
  placedObjectEl.setAttribute('position', { y: posY });
  return placedObjectEl;
}

function createBrtStationElement() {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'brt-station');
  placedObjectEl.setAttribute('mixin', 'brt-station');
  return placedObjectEl;
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

function createSegmentElement(
  segmentWidthInMeters,
  positionY,
  mixinId,
  length,
  repeatCount,
  elevation = 0
) {
  var segmentEl = document.createElement('a-entity');
  const heightLevels = [0.2, 0.4, 0.6];
  const height = heightLevels[elevation];
  if (elevation === 0) {
    positionY = -0.1;
  } else if (elevation === 2) {
    positionY = 0.1;
  }

  segmentEl.setAttribute(
    'geometry',
    `primitive: box; 
    height: ${height}; 
    depth: ${length};
    width: ${segmentWidthInMeters};`
  );

  segmentEl.setAttribute('position', { y: positionY });
  segmentEl.setAttribute('mixin', mixinId);

  if (repeatCount.length !== 0) {
    segmentEl.setAttribute(
      'material',
      `repeat: ${repeatCount[0]} ${repeatCount[1]}`
    );
  }

  return segmentEl;
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

  segmentEl.setAttribute('position', '0 ' + positionY + ' 0');
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
  var clonedObjectRadius = length / 2;
  //  Adjust clonedObjectRadius so that objects do not repeat
  if (length > 12) {
    clonedObjectRadius = (length - 12) / 2;
  }
  // add additional 0-width segments for stripes (painted markers)
  if (showStriping) {
    segments = insertSeparatorSegments(segments);
  }

  // create and center offset to center the street around global x position of 0
  var streetParentEl = createCenteredStreetElement(segments);
  streetParentEl.classList.add('street-parent');
  streetParentEl.setAttribute('data-layer-name', 'Street Segments Container');

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
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

    const elevationLevels = [0, 0.2, 0.4];
    const elevationPosY = elevationLevels[elevation];

    // add y elevation position as a data attribute to segment entity
    segmentParentEl.setAttribute('data-elevation-posY', elevationPosY);

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY =
      variantList[0] === 'inbound' || variantList[1] === 'inbound' ? 180 : 0;
    var isOutbound =
      variantList[0] === 'outbound' || variantList[1] === 'outbound' ? 1 : -1;

    // the A-Frame mixin ID is often identical to the corresponding streetmix segment "type" by design, let's start with that
    var groundMixinId = segments[i].type;

    // repeat value for material property - repeatCount[0] is x texture repeat and repeatCount[1] is y texture repeat
    const repeatCount = [];

    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      // make a parent entity for the stencils
      const stencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015
      });
      // clone a bunch of stencil entities (note: this is not draw call efficient)
      cloneMixinAsChildren({
        objectMixinId: 'stencils sharrow',
        parentEl: stencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 10,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
    } else if (
      segments[i].type === 'bike-lane' ||
      segments[i].type === 'scooter'
    ) {
      // make a parent entity for the stencils
      const stencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015
      });
      // get the mixin id for a bike lane
      groundMixinId = getBikeLaneMixin(variantList[1]);
      // clone a bunch of stencil entities (note: this is not draw call efficient)
      cloneMixinAsChildren({
        objectMixinId: 'stencils bike-arrow',
        parentEl: stencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 20,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
      segmentParentEl.append(
        createMicroMobilityElement(
          variantList,
          segments[i].type,
          elevationPosY,
          length,
          showVehicles,
          globalAnimated
        )
      );
    } else if (
      segments[i].type === 'light-rail' ||
      segments[i].type === 'streetcar'
    ) {
      // get the mixin id for a bus lane
      groundMixinId = getBusLaneMixin(variantList[1]);
      // get the mixin id for the vehicle (is it a trolley or a tram?)
      var objectMixinId = segments[i].type === 'streetcar' ? 'trolley' : 'tram';
      // create and append a train element
      segmentParentEl.append(
        createChooChooElement(variantList, objectMixinId, length, showVehicles)
      );
      // make the parent for all the objects to be cloned
      const tracksParentEl = createTracksParentElement(length, objectMixinId);
      // add these trains to the segment parent
      segmentParentEl.append(tracksParentEl);
    } else if (segments[i].type === 'turn-lane') {
      groundMixinId = 'drive-lane'; // use normal drive lane road material
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
      var mixinString = 'stencils ' + markerMixinId;

      // make the parent for all the objects to be cloned
      const stencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015
      });
      cloneMixinAsChildren({
        objectMixinId: mixinString,
        parentEl: stencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 15,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
      if (variantList[1] === 'shared') {
        // add an additional marking to represent the opposite turn marking stencil (rotated 180º)
        const stencilsParentEl = createStencilsParentElement({
          y: elevationPosY + 0.015,
          z: -3 * isOutbound
        });
        cloneMixinAsChildren({
          objectMixinId: mixinString,
          parentEl: stencilsParentEl,
          rotation: '-90 ' + (rotationY + 180) + ' 0',
          step: 15,
          radius: clonedObjectRadius
        });
        // add this stencil stuff to the segment parent
        segmentParentEl.append(stencilsParentEl);
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      groundMixinId = 'divider';
      // make some safehits
      const safehitsParentEl = createSafehitsParentElement();
      cloneMixinAsChildren({
        objectMixinId: 'safehit',
        parentEl: safehitsParentEl,
        step: 4,
        radius: clonedObjectRadius
      });
      // add the safehits to the segment parent
      segmentParentEl.append(safehitsParentEl);
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length) / 4;
    } else if (segments[i].type === 'divider' && variantList[0] === 'flowers') {
      groundMixinId = 'grass';
      segmentParentEl.append(
        createDividerVariant('flowers', clonedObjectRadius, 2.25)
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planting-strip'
    ) {
      groundMixinId = 'grass';
      segmentParentEl.append(
        createDividerVariant('planting-strip', clonedObjectRadius, 2.25)
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'planter-box'
    ) {
      groundMixinId = 'grass';
      segmentParentEl.append(
        createDividerVariant('planter-box', clonedObjectRadius, 2.45)
      );
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'palm-tree'
    ) {
      groundMixinId = 'grass';
      const treesParentEl = createTreesParentElement();
      cloneMixinAsChildren({
        objectMixinId: 'palm-tree',
        parentEl: treesParentEl,
        randomY: true,
        radius: clonedObjectRadius
      });
      segmentParentEl.append(treesParentEl);
    } else if (
      segments[i].type === 'divider' &&
      variantList[0] === 'big-tree'
    ) {
      groundMixinId = 'grass';
      const treesParentEl = createTreesParentElement();
      cloneMixinAsChildren({
        objectMixinId: 'tree3',
        parentEl: treesParentEl,
        randomY: true,
        radius: clonedObjectRadius
      });
      segmentParentEl.append(treesParentEl);
    } else if (segments[i].type === 'divider' && variantList[0] === 'bush') {
      groundMixinId = 'grass';
      segmentParentEl.append(
        createDividerVariant('bush', clonedObjectRadius, 2.25)
      );
    } else if (segments[i].type === 'divider' && variantList[0] === 'dome') {
      groundMixinId = 'divider';
      segmentParentEl.append(
        createDividerVariant('dome', clonedObjectRadius, 2.25)
      );
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length) / 4;
    } else if (segments[i].type === 'divider') {
      groundMixinId = 'divider';
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length) / 4;
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'barricade'
    ) {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(
        createClonedVariants('temporary-barricade', clonedObjectRadius, 2.25)
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'traffic-cone'
    ) {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(
        createClonedVariants('temporary-traffic-cone', clonedObjectRadius, 2.25)
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-plastic'
    ) {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(
        createClonedVariants(
          'temporary-jersey-barrier-plastic',
          clonedObjectRadius,
          2.25
        )
      );
    } else if (
      segments[i].type === 'temporary' &&
      variantList[0] === 'jersey-barrier-concrete'
    ) {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(
        createClonedVariants(
          'temporary-jersey-barrier-concrete',
          clonedObjectRadius,
          2.93
        )
      );
    } else if (
      segments[i].type === 'bus-lane' ||
      segments[i].type === 'brt-lane'
    ) {
      groundMixinId = getBusLaneMixin(variantList[1]);

      segmentParentEl.append(
        createBusElement(variantList, length, showVehicles)
      );

      // create parent for the bus lane stencils to rotate the phrase instead of the word
      let reusableObjectStencilsParentEl;

      reusableObjectStencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015
      });
      cloneMixinAsChildren({
        objectMixinId: 'stencils word-bus',
        parentEl: reusableObjectStencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 50,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);

      reusableObjectStencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015,
        z: 10
      });
      cloneMixinAsChildren({
        objectMixinId: 'stencils word-taxi',
        parentEl: reusableObjectStencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 50,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);

      reusableObjectStencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015,
        z: 20
      });
      cloneMixinAsChildren({
        objectMixinId: 'stencils word-only',
        parentEl: reusableObjectStencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 50,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);
    } else if (segments[i].type === 'drive-lane') {
      const isAnimated = variantList[2] === 'animated' || globalAnimated;
      const count = getRandomIntInclusive(2, 3);
      const carStep = 7.3;
      segmentParentEl.append(
        createDriveLaneElement(
          variantList,
          segmentWidthInMeters,
          length,
          isAnimated,
          showVehicles,
          count,
          carStep
        )
      );
    } else if (segments[i].type === 'food-truck') {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(createFoodTruckElement(variantList, length));
    } else if (segments[i].type === 'flex-zone') {
      groundMixinId = 'bright-lane';
      segmentParentEl.append(
        createFlexZoneElement(variantList, length, showVehicles)
      );

      let reusableObjectStencilsParentEl;

      reusableObjectStencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015,
        z: 5
      });
      cloneMixinAsChildren({
        objectMixinId: 'stencils word-loading-small',
        parentEl: reusableObjectStencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 50,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);

      reusableObjectStencilsParentEl = createStencilsParentElement({
        y: elevationPosY + 0.015,
        z: -5
      });
      cloneMixinAsChildren({
        objectMixinId: 'stencils word-only-small',
        parentEl: reusableObjectStencilsParentEl,
        rotation: '-90 ' + rotationY + ' 0',
        step: 50,
        radius: clonedObjectRadius
      });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);
    } else if (segments[i].type === 'sidewalk' && variantList[0] !== 'empty') {
      // handles variantString with value sparse, normal, or dense sidewalk
      const isAnimated = variantList[1] === 'animated' || globalAnimated;
      segmentParentEl.append(
        createSidewalkClonedVariants(
          segmentWidthInMeters,
          variantList[0],
          elevationPosY,
          length,
          'random',
          isAnimated
        )
      );
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      segmentParentEl.append(createWayfindingElements());
    } else if (segments[i].type === 'sidewalk-bench') {
      // make the parent for all the benches
      const benchesParentEl = createBenchesParentElement();

      const rotationCloneY = variantList[0] === 'right' ? -90 : 90;
      if (variantList[0] === 'center') {
        cloneMixinAsChildren({
          objectMixinId: 'bench_orientation_center',
          parentEl: benchesParentEl,
          rotation: '0 ' + rotationCloneY + ' 0',
          radius: clonedObjectRadius
        });
        // add benches to the segment parent
        segmentParentEl.append(benchesParentEl);
      } else {
        // `right` or `left` bench
        cloneMixinAsChildren({
          objectMixinId: 'bench',
          parentEl: benchesParentEl,
          rotation: '0 ' + rotationCloneY + ' 0',
          radius: clonedObjectRadius
        });
        // add benches to the segment parent
        segmentParentEl.append(benchesParentEl);
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      // make the parent for all the bike racks
      const bikeRacksParentEl = createBikeRacksParentElement(elevationPosY);

      const rotationCloneY = variantList[1] === 'sidewalk-parallel' ? 90 : 0;
      cloneMixinAsChildren({
        objectMixinId: 'bikerack',
        parentEl: bikeRacksParentEl,
        rotation: '0 ' + rotationCloneY + ' 0',
        radius: clonedObjectRadius
      });
      // add bike racks to the segment parent
      segmentParentEl.append(bikeRacksParentEl);
    } else if (segments[i].type === 'magic-carpet') {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(createMagicCarpetElement(showVehicles));
    } else if (segments[i].type === 'outdoor-dining') {
      groundMixinId = variantList[1] === 'road' ? 'drive-lane' : 'sidewalk';
      segmentParentEl.append(createOutdoorDining(length, elevationPosY));
    } else if (segments[i].type === 'parklet') {
      groundMixinId = 'drive-lane';
      segmentParentEl.append(createParkletElement(length, variantList));
    } else if (segments[i].type === 'bikeshare') {
      // make the parent for all the stations
      segmentParentEl.append(
        createBikeShareStationElement(variantList, elevationPosY)
      );
    } else if (segments[i].type === 'utilities') {
      var rotation = variantList[0] === 'right' ? '0 180 0' : '0 0 0';
      const utilityPoleElems = createClonedVariants(
        'utility_pole',
        clonedObjectRadius,
        15,
        rotation
      );
      segmentParentEl.append(utilityPoleElems);
    } else if (segments[i].type === 'sidewalk-tree') {
      // make the parent for all the trees
      const treesParentEl = createTreesParentElement();
      if (variantList[0] === 'palm-tree') {
        objectMixinId = 'palm-tree';
      } else {
        objectMixinId = 'tree3';
      }
      // clone a bunch of trees under the parent
      cloneMixinAsChildren({
        objectMixinId: objectMixinId,
        parentEl: treesParentEl,
        randomY: true,
        radius: clonedObjectRadius
      });
      segmentParentEl.append(treesParentEl);
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      (variantList[1] === 'modern' || variantList[1] === 'pride')
    ) {
      // Make the parent object for all the lamps
      const lampsParentEl = createLampsParentElement();
      if (variantList[0] === 'both') {
        cloneMixinAsChildren({
          objectMixinId: 'lamp-modern-double',
          parentEl: lampsParentEl,
          rotation: '0 0 0',
          radius: clonedObjectRadius
        });
        segmentParentEl.append(lampsParentEl);
      } else {
        var rotationCloneY = variantList[0] === 'right' ? 0 : 180;
        cloneMixinAsChildren({
          objectMixinId: 'lamp-modern',
          parentEl: lampsParentEl,
          rotation: '0 ' + rotationCloneY + ' 0',
          radius: clonedObjectRadius
        });
        segmentParentEl.append(lampsParentEl);
      }
      // Add the pride flags to the lamp posts
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'right' || variantList[0] === 'both')
      ) {
        cloneMixinAsChildren({
          objectMixinId: 'pride-flag',
          parentEl: lampsParentEl,
          positionXYString: '0.409 5',
          radius: clonedObjectRadius
        });
      }
      if (
        variantList[1] === 'pride' &&
        (variantList[0] === 'left' || variantList[0] === 'both')
      ) {
        cloneMixinAsChildren({
          objectMixinId: 'pride-flag',
          parentEl: lampsParentEl,
          rotation: '0 -180 0',
          positionXYString: '-0.409 5',
          radius: clonedObjectRadius
        });
      }
    } else if (
      segments[i].type === 'sidewalk-lamp' &&
      variantList[1] === 'traditional'
    ) {
      // make the parent for all the lamps
      const lampsParentEl = createLampsParentElement();
      // clone a bunch of lamps under the parent
      cloneMixinAsChildren({
        objectMixinId: 'lamp-traditional',
        parentEl: lampsParentEl,
        radius: clonedObjectRadius
      });
      segmentParentEl.append(lampsParentEl);
    } else if (segments[i].type === 'transit-shelter') {
      var rotationBusStopY = variantList[0] === 'left' ? 90 : 270;
      segmentParentEl.append(
        createBusStopElement(rotationBusStopY, elevationPosY)
      );
    } else if (segments[i].type === 'brt-station') {
      segmentParentEl.append(createBrtStationElement());
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'dashed'
    ) {
      groundMixinId = 'markings dashed-stripe';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
      // for all markings material property repeat = "1 25". So every 150/25=6 meters put a dash
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 6);
    } else if (segments[i].type === 'separator' && variantList[0] === 'solid') {
      groundMixinId = 'markings solid-stripe';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'doubleyellow'
    ) {
      groundMixinId = 'markings solid-doubleyellow';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'shortdashedyellow'
    ) {
      groundMixinId = 'markings yellow short-dashed-stripe';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
      // for short-dashed-stripe every 3 meters put a dash
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 3);
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'soliddashedyellow'
    ) {
      groundMixinId = 'markings yellow solid-dashed';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
    } else if (
      segments[i].type === 'separator' &&
      variantList[0] === 'soliddashedyellowinverted'
    ) {
      groundMixinId = 'markings yellow solid-dashed';
      positionY = elevationPosY + 0.01; // make sure the lane marker is above the asphalt
      rotationY = '180';
      repeatCount[0] = 1;
      repeatCount[1] = parseInt(length / 6);
    } else if (segments[i].type === 'parking-lane') {
      let reusableObjectStencilsParentEl;

      groundMixinId = 'bright-lane';
      let parkingMixin = 'stencils parking-t';

      const carCount = 5;
      let carStep = 6;

      const rotationVars = {
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
        parkingMixin = 'markings solid-stripe';
      }
      const markingPosXY = markingPosX + ' 0';
      const clonedStencilRadius = length / 2 - carStep;

      segmentParentEl.append(
        createDriveLaneElement(
          [...variantList, 'car'],
          segmentWidthInMeters,
          length,
          false,
          showVehicles,
          carCount,
          carStep
        )
      );
      if (variantList[1] === 'left') {
        reusableObjectStencilsParentEl = createStencilsParentElement({
          y: elevationPosY + 0.015
        });
        cloneMixinAsChildren({
          objectMixinId: parkingMixin,
          parentEl: reusableObjectStencilsParentEl,
          positionXYString: markingPosXY,
          rotation: '-90 ' + '90 ' + markingsRotZ,
          length: markingLength,
          step: carStep,
          radius: clonedStencilRadius
        });
      } else {
        reusableObjectStencilsParentEl = createStencilsParentElement({
          y: elevationPosY + 0.015
        });
        cloneMixinAsChildren({
          objectMixinId: parkingMixin,
          parentEl: reusableObjectStencilsParentEl,
          positionXYString: markingPosXY,
          rotation: '-90 ' + '90 ' + markingsRotZ,
          length: markingLength,
          step: carStep,
          radius: clonedStencilRadius
        });
      }
      // add the stencils to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);
    }

    if (streetmixParsersTested.isSidewalk(segments[i].type)) {
      groundMixinId = 'sidewalk';
      repeatCount[0] = segmentWidthInMeters / 1.5;
      // every 2 meters repeat sidewalk texture
      repeatCount[1] = parseInt(length / 2);
    }

    // add new object
    if (segments[i].type !== 'separator') {
      segmentParentEl.append(
        createSegmentElement(
          segmentWidthInMeters,
          positionY,
          groundMixinId,
          length,
          repeatCount,
          elevation
        )
      );
    } else {
      segmentParentEl.append(
        createSeparatorElement(
          positionY,
          rotationY,
          groundMixinId,
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
  // create new brown box to represent ground underneath street
  const dirtBox = document.createElement('a-box');
  const xPos = cumulativeWidthInMeters / 2;
  dirtBox.setAttribute('position', `${xPos} -1.1 0`); // what is x? x = 0 - cumulativeWidthInMeters / 2
  dirtBox.setAttribute('height', 2); // height is 2 meters from y of -0.1 to -y of 2.1
  dirtBox.setAttribute('width', cumulativeWidthInMeters);
  dirtBox.setAttribute('depth', length - 0.2); // depth is length - 0.1 on each side
  dirtBox.setAttribute('material', 'color: #664B00;');
  dirtBox.setAttribute('data-layer-name', 'Underground');
  streetParentEl.append(dirtBox);
  return streetParentEl;
}
module.exports.processSegments = processSegments;

// test - for streetObject of street 44 and buildingElementId render 2 building sides
function processBuildings(left, right, streetWidth, showGround, length) {
  const buildingElement = document.createElement('a-entity');
  const clonedObjectRadius = 0.45 * length;
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
      placedObjectEl.setAttribute('class', 'seawall-parent');
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
      placedObjectEl.classList.add('seawall-parent-' + side);
      buildingElement.appendChild(placedObjectEl);
      // clone a bunch of seawalls under the parent
      cloneMixinAsChildren({
        objectMixinId: 'seawall',
        parentEl: placedObjectEl,
        rotation: '0 ' + rotationCloneY + ' 0',
        step: 15,
        radius: clonedObjectRadius
      });
    }

    if (currentValue === 'fence' || currentValue === 'parking-lot') {
      const objectPositionX = buildingPositionX - (sideMultiplier * 150) / 2;
      // make the parent for all the objects to be cloned
      const placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'fence-parent');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 4.625'); // position="1.043 0.100 -3.463"
      placedObjectEl.classList.add('fence-parent-' + buildingPositionX);
      // clone a bunch of fences under the parent
      const rotationCloneY = side === 'right' ? -90 : 90;
      cloneMixinAsChildren({
        objectMixinId: 'fence',
        parentEl: placedObjectEl,
        rotation: '0 ' + rotationCloneY + ' 0',
        step: 9.25,
        radius: clonedObjectRadius
      });
      buildingElement.appendChild(placedObjectEl);
    }
  });
  return buildingElement;
}
module.exports.processBuildings = processBuildings;
