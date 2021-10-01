// Orientation - default model orientation is "outbound" (away from camera)
var streetmixParsersTested = require('./tested/aframe-streetmix-parsers-tested');
var streetmixUtils = require('./tested/streetmix-utils');

// Width - These are the intended default widths of the models in meters.
/* eslint-disable quote-props */
const defaultModelWidthsInMeters = {
  'bike-lane': 1.8,
  'drive-lane': 3,
  'divider': 0.3,
  'parking-lane': 3,
  'sidewalk': 3,
  'sidewalk-tree': 3,
  'turn-lane': 3,
  'bus-lane': 3,
  'light-rail': 3,
  'streetcar': 3,
  'sidewalk-wayfinding': 3,
  'sidewalk-lamp': 3,
  'sidewalk-bike-rack': 3,
  'sidewalk-bench': 3,
  'scooter-drop-zone': 3,
  'scooter': 1.8,
  'bikeshare': 3,
  'flex-zone-curb': 3,
  'transit-shelter': 3,
  'temporary': 3
};
/* eslint-enable quote-props */

function cloneMixinAsChildren ({ objectMixinId = '', parentEl = null, step = 15, radius = 60, rotation = '0 0 0', positionXYString = '0 0', randomY = false }) {
  for (var j = (radius * -1); j <= radius; j = j + step) {
    var placedObjectEl = document.createElement('a-entity');
    placedObjectEl.setAttribute('class', objectMixinId);
    placedObjectEl.setAttribute('position', positionXYString + ' ' + j);
    placedObjectEl.setAttribute('mixin', objectMixinId);
    if (randomY) {
      placedObjectEl.setAttribute('rotation', '0 ' + Math.floor(randomTestable() * 361) + ' 0');
    } else {
      placedObjectEl.setAttribute('rotation', rotation);
    }
    // add the new elmement to DOM
    parentEl.append(placedObjectEl);
    // could be good to use geometry merger https://github.com/supermedium/superframe/tree/master/components/geometry-merger
  }
}

function randomTestable () {
  return Math.random();
}

// this function takes a list of segments and adds lane markings or "separator segments"
// these are 0 width segments inserted into the street json prior to rendering
// the basic logic is: if there are two adjacent "lane-ish" segments, then add lane separators
function insertSeparatorSegments (segments) {
  // first, let's define what is a lane that will likely need adajcent striping?
  function isLaneIsh (typeString) {
    return (typeString.slice(typeString.length - 4) === 'lane' || typeString === 'light-rail' || typeString === 'streetcar');
  }

  // then let's go through the segments array and build a new one with inserted separators
  const newValues = segments.reduce((newArray, currentValue, currentIndex, arr) => {
    // don't insert a lane marker before the first segment
    if (currentIndex === 0) { return newArray.concat(currentValue); }

    const previousValue = arr[currentIndex - 1];

    // if both adjacent lanes are "laneish"
    if (isLaneIsh(currentValue.type) && isLaneIsh(previousValue.type)) {
      // if in doubt start with a solid line
      var variantString = 'solid';

      // if adjacent lane types are identical, then used dashed lines
      if (currentValue.type === previousValue.type) { variantString = 'dashed'; }

      // Or, if either is a drive lane or turn lane then use dashed
      // Using dash vs solid for turn lanes along approach to intersections may need to be user defined
      if ((currentValue.type === 'drive-lane' && previousValue.type === 'turn-lane') || (previousValue.type === 'drive-lane' && currentValue.type === 'turn-lane')) { variantString = 'dashed'; }

      // if adjacent segments in opposite directions then use double yellow
      if (currentValue.variantString.split('|')[0] !== previousValue.variantString.split('|')[0]) {
        variantString = 'doubleyellow';
        // if adjacenet segments are both bike lanes, then use yellow short dash
        if (currentValue.type === 'bike-lane' && previousValue.type === 'bike-lane') {
          variantString = 'shortdashedyellow';
        }
      }

      // special case -- if either lanes are turn lane shared, then use solid and long dash
      if (currentValue.type === 'turn-lane' && currentValue.variantString.split('|')[1] === 'shared') {
        variantString = 'soliddashedyellow';
      } else if (previousValue.type === 'turn-lane' && previousValue.variantString.split('|')[1] === 'shared') {
        variantString = 'soliddashedyellowinverted';
      }

      newArray.push({ type: 'separator', variantString: variantString, width: 0 });
    }

    // if a *lane segment and divider are adjacent, use a solid separator
    if ((isLaneIsh(currentValue.type) && previousValue.type === 'divider') || (isLaneIsh(previousValue.type) && currentValue.type === 'divider')) {
      newArray.push({ type: 'separator', variantString: 'solid', width: 0 });
    }

    newArray.push(currentValue);
    return newArray;
  }, []);

  // console.log('newValues =', newValues)
  // console.log(segments);

  return newValues;
}

function createStencilsParentElement (position) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'stencils-parent');
  placedObjectEl.setAttribute('position', position); // position="1.043 0.100 -3.463"
  return placedObjectEl;
}

function createTracksParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'track-parent');
  placedObjectEl.setAttribute('position', positionX + ' -0.2 0'); // position="1.043 0.100 -3.463"
  return placedObjectEl;
}

function createSafehitsParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'safehit-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  return placedObjectEl;
}

function createParentElement (positionX, className) {
  const parentEl = document.createElement('a-entity');
  parentEl.setAttribute('class', className);
  parentEl.setAttribute('position', positionX + ' 0 0');
  return parentEl;
}

function createDividerVariant (variantName, positionX, clonedObjectRadius, step = 2.25) {
  const dividerParentEl = createParentElement(positionX, `dividers-${variantName}-parent`);
  cloneMixinAsChildren({ objectMixinId: `dividers-${variantName}`, parentEl: dividerParentEl, step: step, radius: clonedObjectRadius });
  return dividerParentEl;
}

function createClonedVariants (variantName, positionX, clonedObjectRadius, step = 2.25) {
  const dividerParentEl = createParentElement(positionX, `${variantName}-parent`);
  cloneMixinAsChildren({ objectMixinId: variantName, parentEl: dividerParentEl, step: step, radius: clonedObjectRadius });
  return dividerParentEl;
}

function getBikeLaneMixin (variant) {
  if (variant === 'red') {
    return 'surface-red bike-lane';
  }
  if (variant === 'green') {
    return 'surface-green bike-lane';
  }
  return 'bike-lane';
}

function getBusLaneMixin (variant) {
  if (variant === 'colored') {
    return 'surface-red bus-lane';
  }
  if (variant === 'grass') {
    return 'surface-green bus-lane';
  }
  return 'bus-lane';
}

function createChooChooElement (variantList, objectMixinId, positionX) {
  const rotationY = (variantList[0] === 'inbound') ? 0 : 180;
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', objectMixinId);
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  placedObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  placedObjectEl.setAttribute('mixin', objectMixinId);

  return placedObjectEl;
}

function createBusAndShadowElements (isOutbound, positionX) {
  const busAndShadowParentEl = document.createElement('a-entity');
  const rotationY = isOutbound * 90;

  const busObjectEl = document.createElement('a-entity');
  busObjectEl.setAttribute('class', 'bus');
  busObjectEl.setAttribute('position', positionX + ' 1.4 0');
  busObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  busObjectEl.setAttribute('mixin', 'bus');
  busAndShadowParentEl.append(busObjectEl);

  const shadowObjectEl = document.createElement('a-entity');
  shadowObjectEl.setAttribute('class', 'bus-shadow');
  shadowObjectEl.setAttribute('position', positionX + ' 0.01 0');
  shadowObjectEl.setAttribute('rotation', '-90 ' + rotationY + ' 0');
  shadowObjectEl.setAttribute('mixin', 'bus-shadow');
  busAndShadowParentEl.append(shadowObjectEl);

  return busAndShadowParentEl;
}

function createCarAndShadowElements (variantList, positionX, parentId) {
  const carAndShadowParentEl = document.createElement('a-entity');
  let rotationY, reusableObjectEl;

  reusableObjectEl = document.createElement('a-entity');
  rotationY = (variantList[0] === 'inbound') ? 0 : 180;
  reusableObjectEl.setAttribute('class', 'car');
  reusableObjectEl.setAttribute('position', positionX + ' 0 0');
  reusableObjectEl.setAttribute('rotation', '0 ' + rotationY + ' 0');
  reusableObjectEl.setAttribute('mixin', 'car');
  carAndShadowParentEl.append(reusableObjectEl);

  reusableObjectEl = document.createElement('a-entity');
  rotationY = (variantList[0] === 'inbound') ? -90 : 90;
  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('class', 'car-shadow');
  reusableObjectEl.setAttribute('position', positionX + ' 0.01 0');
  reusableObjectEl.setAttribute('rotation', '-90 ' + rotationY + ' 0');
  reusableObjectEl.setAttribute('mixin', 'car-shadow');
  carAndShadowParentEl.append(reusableObjectEl);

  return carAndShadowParentEl;
}

function createWayfindingElements (positionX) {
  const wayfindingParentEl = document.createElement('a-entity');
  let reusableObjectEl;

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', positionX + ' 1 0');
  reusableObjectEl.setAttribute('mixin', 'wayfinding-box');
  wayfindingParentEl.append(reusableObjectEl);

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', positionX + ' 1.2 0.06');
  reusableObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
  reusableObjectEl.setAttribute('material', 'src:#wayfinding-map');
  wayfindingParentEl.append(reusableObjectEl);

  reusableObjectEl = document.createElement('a-entity');
  reusableObjectEl.setAttribute('position', positionX + ' 1.2 -0.06');
  reusableObjectEl.setAttribute('rotation', '0 180 0');
  reusableObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
  reusableObjectEl.setAttribute('material', 'src:#wayfinding-map');
  wayfindingParentEl.append(reusableObjectEl);

  return wayfindingParentEl;
}

function createBenchesParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bench-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 3.5');
  return placedObjectEl;
}

function createBikeRacksParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bikerack-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 -3.5');
  return placedObjectEl;
}

function createBikeShareStationElement (positionX, variantList) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bikeshare');
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  placedObjectEl.setAttribute('mixin', 'bikeshare');
  const rotationCloneY = (variantList[0] === 'left') ? 90 : 270;
  placedObjectEl.setAttribute('rotation', '0 ' + rotationCloneY + ' 0');
  return placedObjectEl;
}

function createTreesParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'tree-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 7');
  return placedObjectEl;
}

function createLampsParentElement (positionX) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'lamp-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 0'); // position="1.043 0.100 -3.463"
  return placedObjectEl;
}

function createBusStopElement (positionX, parityBusStop, rotationBusStopY) {
  const placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bus-stop');
  placedObjectEl.setAttribute('position', (positionX + (0.75 * parityBusStop)) + ' 0 0');
  placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusStopY + ' 0');
  placedObjectEl.setAttribute('mixin', 'bus-stop');
  return placedObjectEl;
}

// offset to center the street around global x position of 0
function createCenteredStreetElement (segments) {
  const streetEl = document.createElement('a-entity');
  const streetWidth = streetmixUtils.calcStreetWidth(segments);
  const offset = 0 - streetWidth / 2;
  streetEl.setAttribute('position', offset + ' 0 0');
  return streetEl;
}

function createSegmentElement (scaleX, positionX, positionY, rotationY, mixinId, length) {
  var segmentEl = document.createElement('a-entity');
  const scaleY = length / 150;
  const scaleNew = scaleX + ' ' + scaleY + ' 1';
  segmentEl.setAttribute('scale', scaleNew);
  // segmentEl.setAttribute('geometry', 'height', length); // alternative to modifying scale
  segmentEl.setAttribute('position', positionX + ' ' + positionY + ' 0');

  segmentEl.setAttribute('rotation', '270 ' + rotationY + ' 0');
  segmentEl.setAttribute('mixin', mixinId);
  return segmentEl;
}

// OLD: takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
// NEW: takes a `segments` (array) from streetmix and return an element and its children which represent the 3D street scene
function processSegments (segments, showStriping, length) {
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

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
    var segmentParentEl = document.createElement('a-entity');
    segmentParentEl.classList.add('segment-parent-' + i);

    var segmentType = segments[i].type;
    var segmentWidthInFeet = segments[i].width;
    var segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    // console.log('Type: ' + segmentType + '; Width: ' + segmentWidthInFeet + 'ft / ' + segmentWidthInMeters + 'm');

    var modelWidthInMeters = defaultModelWidthsInMeters[segmentType];

    // what is "delta" between default width and requested width?
    // default * scale = requested :: scale = requested / default
    // For example: requested width = 2m, but default model width is 1.8. 2 / 1.8 = 1.111111111
    var scaleX = segmentWidthInMeters / modelWidthInMeters;

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    var positionY = 0;

    // get variantString
    var variantList = segments[i].variantString.split('|');

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY = (variantList[0] === 'inbound') ? 180 : 0;
    var isOutbound = (variantList[0] === 'outbound') ? 1 : -1;

    // the A-Frame mixin ID is often identical to the corresponding streetmix segment "type" by design, let's start with that
    var mixinId = segments[i].type;
    console.log(segments[i].type);
    console.log(variantList[0]);
    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      // make a parent entity for the stencils
      const stencilsParentEl = createStencilsParentElement(positionX + ' 0.015 0');
      // clone a bunch of stencil entities (note: this is not draw call efficient)
      cloneMixinAsChildren({ objectMixinId: 'stencils sharrow', parentEl: stencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 10, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
    } else if (segments[i].type === 'bike-lane' || segments[i].type === 'scooter') {
      // make a parent entity for the stencils
      const stencilsParentEl = createStencilsParentElement(positionX + ' 0.015 0');
      // get the mixin id for a bike lane
      mixinId = getBikeLaneMixin(variantList[1]);
      // clone a bunch of stencil entities (note: this is not draw call efficient)
      cloneMixinAsChildren({ objectMixinId: 'stencils bike-arrow', parentEl: stencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 20, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
    } else if (segments[i].type === 'light-rail' || segments[i].type === 'streetcar') {
      // get the mixin id for a bus lane
      mixinId = getBusLaneMixin(variantList[1]);
      // get the mixin id for the vehicle (is it a trolley or a tram?)
      var objectMixinId = (segments[i].type === 'streetcar') ? 'trolley' : 'tram';
      // create and append a train element
      segmentParentEl.append(createChooChooElement(variantList, objectMixinId, positionX));
      // make the parent for all the objects to be cloned
      const tracksParentEl = createTracksParentElement(positionX);
      cloneMixinAsChildren({ objectMixinId: 'track', parentEl: tracksParentEl, step: 20.25, radius: clonedObjectRadius });
      // add these trains to the segment parent
      segmentParentEl.append(tracksParentEl);
    } else if (segments[i].type === 'turn-lane') {
      mixinId = 'drive-lane'; // use normal drive lane road material
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
      const stencilsParentEl = createStencilsParentElement(positionX + ' 0.015 0');
      cloneMixinAsChildren({ objectMixinId: mixinString, parentEl: stencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 15, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(stencilsParentEl);
      if (variantList[1] === 'shared') {
        // add an additional marking to represent the opposite turn marking stencil (rotated 180º)
        const stencilsParentEl = createStencilsParentElement(positionX + ' 0.015 ' + (-3 * isOutbound));
        cloneMixinAsChildren({ objectMixinId: mixinString, parentEl: stencilsParentEl, rotation: '-90 ' + (rotationY + 180) + ' 0', step: 15, radius: clonedObjectRadius });
        // add this stencil stuff to the segment parent
        segmentParentEl.append(stencilsParentEl);
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      mixinId = 'divider';

      // make some safehits
      const safehitsParentEl = createSafehitsParentElement(positionX);
      cloneMixinAsChildren({ objectMixinId: 'safehit', parentEl: safehitsParentEl, step: 4, radius: clonedObjectRadius });
      // add the safehits to the segment parent
      segmentParentEl.append(safehitsParentEl);
    } else if (segments[i].type === 'divider' && variantList[0] === 'flowers') {
      mixinId = 'grass';
      segmentParentEl.append(createDividerVariant('flowers', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'divider' && variantList[0] === 'planting-strip') {
      mixinId = 'grass';
      segmentParentEl.append(createDividerVariant('planting-strip', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'divider' && variantList[0] === 'planter-box') {
      mixinId = 'grass';
      segmentParentEl.append(createDividerVariant('planter-box', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'divider' && variantList[0] === 'bush') {
      mixinId = 'grass';
      segmentParentEl.append(createDividerVariant('bush', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'divider' && variantList[0] === 'dome') {
      mixinId = 'divider';
      segmentParentEl.append(createDividerVariant('dome', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'temporary' && variantList[0] === 'barricade') {
      mixinId = 'drive-lane';
      segmentParentEl.append(createClonedVariants('temporary-barricade', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'temporary' && variantList[0] === 'traffic-cone') {
      mixinId = 'drive-lane';
      segmentParentEl.append(createClonedVariants('temporary-traffic-cone', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'temporary' && variantList[0] === 'jersey-barrier-plastic') {
      mixinId = 'drive-lane';
      segmentParentEl.append(createClonedVariants('temporary-jersey-barrier-plastic', positionX, clonedObjectRadius, 2.25));
    } else if (segments[i].type === 'temporary' && variantList[0] === 'jersey-barrier-concrete') {
      mixinId = 'drive-lane';
      segmentParentEl.append(createClonedVariants('temporary-jersey-barrier-concrete', positionX, clonedObjectRadius, 2.93));
    } else if (segments[i].type === 'bus-lane') {
      mixinId = getBusLaneMixin(variantList[1]);

      segmentParentEl.append(createBusAndShadowElements(isOutbound, positionX));

      let reusableObjectStencilsParentEl;

      reusableObjectStencilsParentEl = createStencilsParentElement(positionX + ' 0.015 0');
      cloneMixinAsChildren({ objectMixinId: 'stencils word-bus', parentEl: reusableObjectStencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);

      reusableObjectStencilsParentEl = createStencilsParentElement(positionX + ' 0.015 10');
      cloneMixinAsChildren({ objectMixinId: 'stencils word-taxi', parentEl: reusableObjectStencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);

      reusableObjectStencilsParentEl = createStencilsParentElement(positionX + ' 0.015 20');
      cloneMixinAsChildren({ objectMixinId: 'stencils word-only', parentEl: reusableObjectStencilsParentEl, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: clonedObjectRadius });
      // add this stencil stuff to the segment parent
      segmentParentEl.append(reusableObjectStencilsParentEl);
    } else if (segments[i].type === 'drive-lane') {
      segmentParentEl.append(createCarAndShadowElements(variantList, positionX));
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      segmentParentEl.append(createWayfindingElements(positionX));
    } else if (segments[i].type === 'sidewalk-bench') {
      // make the parent for all the benches
      const benchesParentEl = createBenchesParentElement(positionX);

      const rotationCloneY = (variantList[0] === 'right') ? -90 : 90;
      if (variantList[0] === 'center') {
        // nothing, oh my this gives me heartburn
      } else {
        // `right` or `left` bench
        cloneMixinAsChildren({ objectMixinId: 'bench', parentEl: benchesParentEl, rotation: '0 ' + rotationCloneY + ' 0', radius: clonedObjectRadius });
        // add benches to the segment parent
        segmentParentEl.append(benchesParentEl);
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      // make the parent for all the bike racks
      const bikeRacksParentEl = createBikeRacksParentElement(positionX);

      const rotationCloneY = (variantList[1] === 'sidewalk-parallel') ? 90 : 0;
      cloneMixinAsChildren({ objectMixinId: 'bikerack', parentEl: bikeRacksParentEl, rotation: '0 ' + rotationCloneY + ' 0', radius: clonedObjectRadius });
      // add bike racks to the segment parent
      segmentParentEl.append(bikeRacksParentEl);
    } else if (segments[i].type === 'bikeshare') {
      // make the parent for all the stations
      segmentParentEl.append(createBikeShareStationElement(positionX, variantList));
    } else if (segments[i].type === 'sidewalk-tree') {
      // make the parent for all the trees
      const treesParentEl = createTreesParentElement(positionX);
      if (variantList[0] === 'palm-tree') {
        objectMixinId = 'palm-tree';
      } else {
        objectMixinId = 'tree3';
      }
      // clone a bunch of trees under the parent
      cloneMixinAsChildren({ objectMixinId: objectMixinId, parentEl: treesParentEl, randomY: true, radius: clonedObjectRadius });
      segmentParentEl.append(treesParentEl);
    } else if (segments[i].type === 'sidewalk-lamp' && (variantList[1] === 'modern' || variantList[1] === 'pride')) {
      // make the parent for all the lamps
      const lampsParentEl = createLampsParentElement(positionX);
      // clone a bunch of lamps under the parent
      var rotationCloneY = (variantList[0] === 'right') ? -90 : 90;
      cloneMixinAsChildren({ objectMixinId: 'lamp-modern', parentEl: lampsParentEl, rotation: '0 ' + rotationCloneY + ' 0', radius: clonedObjectRadius });
      // if modern lamp variant is "both" then clone the lamps again rotated 180º
      segmentParentEl.append(lampsParentEl);

      if (variantList[0] === 'both') {
        cloneMixinAsChildren({ objectMixinId: 'lamp-modern', parentEl: lampsParentEl, rotation: '0 -90 0', radius: clonedObjectRadius });
      }
      // add the pride flags
      if (variantList[1] === 'pride' && (variantList[0] === 'right' || variantList[0] === 'both')) {
        cloneMixinAsChildren({ objectMixinId: 'pride-flag', parentEl: lampsParentEl, positionXYString: '0.409 3.345', radius: clonedObjectRadius });
      }
      if (variantList[1] === 'pride' && (variantList[0] === 'left' || variantList[0] === 'both')) {
        cloneMixinAsChildren({ objectMixinId: 'pride-flag', parentEl: lampsParentEl, rotation: '0 -180 0', positionXYString: '-0.409 3.345', radius: clonedObjectRadius });
      }
    } else if (segments[i].type === 'sidewalk-lamp' && variantList[1] === 'traditional') {
      // make the parent for all the lamps
      const lampsParentEl = createLampsParentElement(positionX);
      // clone a bunch of lamps under the parent
      cloneMixinAsChildren({ objectMixinId: 'lamp-traditional', parentEl: lampsParentEl, radius: clonedObjectRadius });
      segmentParentEl.append(lampsParentEl);
    } else if (segments[i].type === 'transit-shelter') {
      var rotationBusStopY = (variantList[0] === 'right') ? 0 : 180;
      var parityBusStop = (variantList[0] === 'right') ? 1 : -1;
      segmentParentEl.append(createBusStopElement(positionX, parityBusStop, rotationBusStopY));
    } else if (segments[i].type === 'separator' && variantList[0] === 'dashed') {
      mixinId = 'markings dashed-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    } else if (segments[i].type === 'separator' && variantList[0] === 'solid') {
      mixinId = 'markings solid-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    } else if (segments[i].type === 'separator' && variantList[0] === 'doubleyellow') {
      mixinId = 'markings solid-doubleyellow';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    } else if (segments[i].type === 'separator' && variantList[0] === 'shortdashedyellow') {
      mixinId = 'markings yellow short-dashed-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    } else if (segments[i].type === 'separator' && variantList[0] === 'soliddashedyellow') {
      mixinId = 'markings yellow solid-dashed';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    } else if (segments[i].type === 'separator' && variantList[0] === 'soliddashedyellowinverted') {
      mixinId = 'markings yellow solid-dashed';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
      rotationY = '180';
    } else if (segments[i].type === 'parking-lane') {
      mixinId = 'drive-lane';
    }

    if (streetmixParsersTested.isSidewalk(segments[i].type)) {
      mixinId = 'sidewalk';
    }

    // add new object
    segmentParentEl.append(createSegmentElement(scaleX, positionX, positionY, rotationY, mixinId, length));
    // returns JSON output instead
    // append the new surfaceElement to the segmentParentEl
    streetParentEl.append(segmentParentEl);
  }
  return streetParentEl;
}
module.exports.processSegments = processSegments;

// test - for streetObject of street 44 and buildingElementId render 2 building sides
function processBuildings (left, right, streetWidth, showGround, length) {
  const buildingElement = document.createElement('a-entity');
  // const clonedObjectRadius = (length - 12) / 2;
  const clonedObjectRadius = 70;
  buildingElement.classList.add('buildings-parent');
  // https://github.com/streetmix/illustrations/tree/master/images/buildings
  // const buildingVariants = ['waterfront', 'grass', 'fence', 'parking-lot', 'residential', 'narrow', 'wide'];
  // const buildingLotWidth = length;
  const buildingLotWidth = 150;
  const buildingsArray = [left, right];
  // console.log(buildingsArray);

  // TODO: Sound temporarily disabled
  // var ambientSoundJSONString = JSON.stringify(streetmixParsersTested.getAmbientSoundJSON(buildingsArray));
  // var soundParentEl = document.createElement('a-entity');
  // soundParentEl.setAttribute('create-from-json', 'jsonString', ambientSoundJSONString);
  // buildingElement.appendChild(soundParentEl);

  buildingsArray.forEach((currentValue, index) => {
    if (currentValue.length === 0) { return; } // if empty string then skip
    const side = (index === 0) ? 'left' : 'right';
    const sideMultiplier = (side === 'left') ? -1 : 1;

    const positionX = ((buildingLotWidth / 2) + (streetWidth / 2)) * sideMultiplier;

    if (showGround) {
      var groundJSONString = JSON.stringify(streetmixParsersTested.createGroundArray(currentValue));
      var groundParentEl = document.createElement('a-entity');
      groundParentEl.setAttribute('create-from-json', 'jsonString', groundJSONString);
      groundParentEl.setAttribute('position', positionX + ' 0 0');
      groundParentEl.classList.add('ground-' + side);
      buildingElement.appendChild(groundParentEl);
    }

    if (currentValue === 'narrow' || currentValue === 'wide') {
      // make buildings
      const buildingsArray = streetmixParsersTested.createBuildingsArray(buildingLotWidth);

      const buildingJSONString = JSON.stringify(buildingsArray);
      const placedObjectEl = document.createElement('a-entity');
      // to center what is created by createBuildingsArray
      placedObjectEl.setAttribute('position', (positionX + (sideMultiplier * -72)) + ' 0 ' + (sideMultiplier * 75));
      placedObjectEl.setAttribute('rotation', '0 ' + (90 * sideMultiplier) + ' 0');
      placedObjectEl.setAttribute('create-from-json', 'jsonString', buildingJSONString);
      placedObjectEl.classList.add('block-' + side);
      buildingElement.append(placedObjectEl);
    }

    if (currentValue === 'residential') {
      // make buildings
      const buildingsArray = streetmixParsersTested.createBuildingsArray(buildingLotWidth, 'residential');

      const buildingJSONString = JSON.stringify(buildingsArray);
      const placedObjectEl = document.createElement('a-entity');
      // to center what is created by createBuildingsArray
      placedObjectEl.setAttribute('position', (positionX + (sideMultiplier * -64)) + ' -0.75 ' + (sideMultiplier * 75));
      placedObjectEl.setAttribute('rotation', '0 ' + (90 * sideMultiplier) + ' 0');
      placedObjectEl.setAttribute('create-from-json', 'jsonString', buildingJSONString);
      placedObjectEl.classList.add('suburbia-' + side);
      buildingElement.append(placedObjectEl);
    }

    if (currentValue === 'waterfront') {
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);

      const placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'seawall-parent');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 10'); // position="1.043 0.100 -3.463"
      placedObjectEl.classList.add('seawall-parent-' + side);
      // add the new elmement to DOM
      buildingElement.appendChild(placedObjectEl);

      // clone a bunch of seawalls under the parent
      const rotationCloneY = (side === 'right') ? -90 : 90;
      cloneMixinAsChildren({ objectMixinId: 'seawall', parentEl: placedObjectEl, rotation: '-90 ' + rotationCloneY + ' 0', step: 15, radius: clonedObjectRadius });
    }

    if (currentValue === 'fence' || currentValue === 'parking-lot') {
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);
      // make the parent for all the objects to be cloned
      const placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'fence-parent');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.classList.add('fence-parent-' + positionX);
      // add the new elmement to DOM

      // clone a bunch of fences under the parent
      const rotationCloneY = (side === 'right') ? -90 : 90;

      cloneMixinAsChildren({ objectMixinId: 'fence', parentEl: placedObjectEl, rotation: '0 ' + rotationCloneY + ' 0', step: 9.25, radius: clonedObjectRadius });

      buildingElement.appendChild(placedObjectEl);
    }
  });
  return buildingElement;
}
module.exports.processBuildings = processBuildings;
