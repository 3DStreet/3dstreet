// Orientation - default model orientation is "outbound" (away from camera)

const initialState = {
  layers: {
    paths: true
  },
  textures: {
    suffix: '-t1'
  },
  sounds: {
    enabled: false
  }
};
var state = initialState;

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
  'transit-shelter': 3
};
/* eslint-enable quote-props */

function cloneMixin ({ objectMixinId = '', parentId = '', step = 15, radius = 60, rotation = '0 0 0', positionXYString = '0 0', randomY = false }) {
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
    document.getElementById(parentId).appendChild(placedObjectEl);
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
    return (typeString.slice(typeString.length - 4) == 'lane' || typeString == 'light-rail' || typeString == 'streetcar');
  }

  // then let's go through the segments array and build a new one with inserted separators
  const newValues = segments.reduce((newArray, currentValue, currentIndex, arr) => {
    // don't insert a lane marker before the first segment
    if (currentIndex == 0) { return newArray.concat(currentValue); }

    const previousValue = arr[currentIndex - 1];

    // if both adjacent lanes are "laneish"
    if (isLaneIsh(currentValue.type) && isLaneIsh(previousValue.type)) {
      // if in doubt start with a solid line
      var variantString = 'solid';

      // if adjacent lane types are identical, then used dashed lines
      if (currentValue.type == previousValue.type) { variantString = 'dashed'; }

      // Or, if either is a drive lane or turn lane then use dashed
      // Using dash vs solid for turn lanes along approach to intersections may need to be user defined
      if ((currentValue.type == 'drive-lane' && previousValue.type == 'turn-lane') || (previousValue.type == 'drive-lane' && currentValue.type == 'turn-lane')) { variantString = 'dashed'; }

      // if adjacent segments in opposite directions then use double yellow
      if (currentValue.variantString.split('|')[0] !== previousValue.variantString.split('|')[0]) {
        variantString = 'doubleyellow';
        // if adjacenet segments are both bike lanes, then use yellow short dash
        if (currentValue.type == 'bike-lane' && previousValue.type == 'bike-lane') {
          variantString = 'shortdashedyellow';
        }
      }

      // special case -- if either lanes are turn lane shared, then use solid and long dash
      if (currentValue.type == 'turn-lane' && currentValue.variantString.split('|')[1] == 'shared') {
        variantString = 'soliddashedyellow';
      } else if (previousValue.type == 'turn-lane' && previousValue.variantString.split('|')[1] == 'shared') {
        variantString = 'soliddashedyellowinverted';
      }

      newArray.push({ type: 'separator', variantString: variantString, width: 0 });
    }

    // if a *lane segment and divider are adjacent, use a solid separator
    if ((isLaneIsh(currentValue.type) && previousValue.type == 'divider') || (isLaneIsh(previousValue.type) && currentValue.type == 'divider')) {
      newArray.push({ type: 'separator', variantString: 'solid', width: 0 });
    }

    newArray.push(currentValue);
    return newArray;
  }, []);

  // console.log('newValues =', newValues)
  // console.log(segments);

  return newValues;
}

function calcStreetWidth (segments) {
  var cumulativeWidthInMeters = 0;
  segments.forEach((currentSegment) => {
    const segmentWidthInFeet = currentSegment.width;
    const segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
  });
  return cumulativeWidthInMeters;
}

function getStencilsParentId (positionX) {
  return 'stencils-parent-' + positionX;
}

function getTracksParentId (positionX) {
  return 'track-parent-' + positionX;
}

function createStencilsParentElement (position, elementId, parentElementId) {
  // make the parent for all the objects to be cloned
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'stencils-parent');
  placedObjectEl.setAttribute('position', position); // position="1.043 0.100 -3.463"
  placedObjectEl.setAttribute('id', elementId);
  // add the new elmement to DOM
  document.getElementById(parentElementId).appendChild(placedObjectEl);
}

function createTracksParentElement (positionX, elementId, parentElementId) {
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'track-parent');
  placedObjectEl.setAttribute('position', positionX + ' -0.2 0'); // position="1.043 0.100 -3.463"
  placedObjectEl.setAttribute('id', elementId);
  // add the new elmement to DOM
  document.getElementById(parentElementId).appendChild(placedObjectEl);
}

function createSafehitsParentElement (positionX, parentElementId) {
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'safehit-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  placedObjectEl.setAttribute('id', 'safehit-parent-' + positionX);
  // add the new elmement to DOM
  document.getElementById(parentElementId).appendChild(placedObjectEl);
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

function createChooChooElement (variantList, objectMixinId, positionX, curveId, parentId) {
  var rotationBusY = (variantList[0] === 'inbound') ? 0 : 180;
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', objectMixinId);
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
  placedObjectEl.setAttribute('mixin', objectMixinId);
  placedObjectEl.setAttribute('alongpath', 'curve: ' + curveId + '; loop:true; dur:20000;');
  // placedObjectEl.setAttribute('soundwhenstart'); TODO: Use something like this to replace the addEventListener below

  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);

  // TODO: move this addEventListener logic to a separate function, for add component on entity and parse later
  placedObjectEl.addEventListener('movingstarted', function (e) {
    console.log('movingstarted', e);
    if (state.sounds.enabled) {
      // this creates console error if the placedObjectEl does not have a sound associated
      this.components.sound.playSound();
    }
  });
}

function createBusAndShadowElements (isOutbound, positionX, parentId) {
  var rotationBusY = isOutbound * 90;
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bus');
  placedObjectEl.setAttribute('position', positionX + ' 1.4 0');
  placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
  placedObjectEl.setAttribute('mixin', 'bus');
  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);

  placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bus-shadow');
  placedObjectEl.setAttribute('position', positionX + ' 0.01 0');
  placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusY + ' 0');
  placedObjectEl.setAttribute('mixin', 'bus-shadow');
  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);
}

function createCarAndShadowElements (variantList, positionX, parentId) {
  var rotationBusY = (variantList[0] == 'inbound') ? 0 : 180;
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'car');
  placedObjectEl.setAttribute('position', positionX + ' 0 0');
  placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
  placedObjectEl.setAttribute('mixin', 'car');
  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);
  rotationBusY = (variantList[0] == 'inbound') ? -90 : 90;
  placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'car-shadow');
  placedObjectEl.setAttribute('position', positionX + ' 0.01 0');
  placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusY + ' 0');
  placedObjectEl.setAttribute('mixin', 'car-shadow');
  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);
}

function createWayfindingElements (positionX, parentId) {
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('position', positionX + ' 1 0');
  placedObjectEl.setAttribute('mixin', 'wayfinding-box');
  document.getElementById(parentId).appendChild(placedObjectEl);

  placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('position', positionX + ' 1.2 0.06');
  placedObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
  placedObjectEl.setAttribute('material', 'src:#wayfinding-map');
  document.getElementById(parentId).appendChild(placedObjectEl);

  placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('position', positionX + ' 1.2 -0.06');
  placedObjectEl.setAttribute('rotation', '0 180 0');
  placedObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
  placedObjectEl.setAttribute('material', 'src:#wayfinding-map');
  document.getElementById(parentId).appendChild(placedObjectEl);
}

function createBenchesParentElement (positionX, benchesParentId, parentId) {
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'bench-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0 3.5');
  placedObjectEl.setAttribute('id', benchesParentId);
  // add the new elmement to DOM
  document.getElementById(parentId).appendChild(placedObjectEl);
}

// offset to center the street around global x position of 0
function centerStreetParentEntity (segments, streetElementId) {
  const streetWidth = calcStreetWidth(segments);
  const offset = 0 - streetWidth / 2;
  document.getElementById(streetElementId).setAttribute('position', offset + ' 0 0');
}

function processSegments (segments, streetElementId) {
  // takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
  segments = insertSeparatorSegments(segments);
  // console.log(segments);

  // offset to center the street around global x position of 0
  centerStreetParentEntity(segments, streetElementId);

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
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

    // the 3d model file name of a segment type is usually identical, let's start with that
    var mixinId = segments[i].type;

    // look at segment type and variant(s) to determine specific cases
    if (segments[i].type === 'drive-lane' && variantList[1] === 'sharrow') {
      createStencilsParentElement(positionX + ' 0.015 0', getStencilsParentId(positionX), streetElementId);
      cloneMixin({ objectMixinId: 'stencils sharrow', parentId: getStencilsParentId(positionX), rotation: '-90 ' + rotationY + ' 0', step: 10, radius: 70 });
    } else if (segments[i].type === 'bike-lane' || segments[i].type === 'scooter') {
      createStencilsParentElement(positionX + ' 0.015 0', getStencilsParentId(positionX), streetElementId);
      mixinId = getBikeLaneMixin(variantList[1]);
      cloneMixin({ objectMixinId: 'stencils bike-lane', parentId: getStencilsParentId(positionX), rotation: '-90 ' + rotationY + ' 0', step: 20, radius: 70 });
    } else if (segments[i].type === 'light-rail' || segments[i].type === 'streetcar') {
      mixinId = getBusLaneMixin(variantList[1]);
      var objectMixinId = (segments[i].type === 'streetcar') ? 'trolley' : 'tram';

      // TODO: split out curve creation into separate function
      var pathEl = document.createElement('a-curve');
      pathEl.setAttribute('id', 'path-' + i);
      pathEl.innerHTML = `
        <a-curve-point id="checkpoint1" position="${positionX} 0 ${75 * isOutbound}"></a-curve-point>
        <a-curve-point id="checkpoint2" position="${positionX} 0 0"></a-curve-point>
        <a-curve-point id="checkpoint3" position="${positionX} 0 ${-75 * isOutbound}"></a-curve-point>
      `;
      document.getElementById(streetElementId).appendChild(pathEl);

      // add choo choo
      createChooChooElement(variantList, objectMixinId, positionX, `#path-${i}`, streetElementId);

      // make the parent for all the objects to be cloned
      createTracksParentElement(positionX, getTracksParentId(positionX), streetElementId);
      cloneMixin({ objectMixinId: 'track', parentId: getTracksParentId(positionX), step: 20.25, radius: 80 });
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
      createStencilsParentElement(positionX + ' 0.015 0', getStencilsParentId(positionX), streetElementId);
      cloneMixin({ objectMixinId: mixinString, parentId: 'stencils-parent-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 15, radius: 70 });

      if (variantList[1] === 'shared') {
        // add an additional marking to represent the opposite turn marking stencil (rotated 180º)
        createStencilsParentElement(positionX + ' 0.015 ' + (-3 * isOutbound), 'stencils-parent-offset2-' + positionX, streetElementId);
        cloneMixin({ objectMixinId: mixinString, parentId: 'stencils-parent-offset2-' + positionX, rotation: '-90 ' + (rotationY + 180) + ' 0', step: 15, radius: 70 });
      }
    } else if (segments[i].type === 'divider' && variantList[0] === 'bollard') {
      mixinId = 'divider';

      // make some safehits
      createSafehitsParentElement(positionX, streetElementId);
      cloneMixin({ objectMixinId: 'safehit', parentId: 'safehit-parent-' + positionX, step: 4, radius: 70 });
    } else if (segments[i].type === 'bus-lane') {
      mixinId = getBusLaneMixin(variantList[1]);

      createBusAndShadowElements(isOutbound, positionX, streetElementId);

      createStencilsParentElement(positionX + ' 0.015 0', getStencilsParentId(positionX), streetElementId);
      cloneMixin({ objectMixinId: 'stencils word-bus', parentId: getStencilsParentId(positionX), rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });

      createStencilsParentElement(positionX + ' 0.015 10', 'stencils-parent-offset10-' + positionX, streetElementId);
      cloneMixin({ objectMixinId: 'stencils word-taxi', parentId: 'stencils-parent-offset10-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });

      createStencilsParentElement(positionX + ' 0.015 20', 'stencils-parent-offset20-' + positionX, streetElementId);
      cloneMixin({ objectMixinId: 'stencils word-only', parentId: 'stencils-parent-offset20-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });
    } else if (segments[i].type === 'drive-lane') {
      createCarAndShadowElements(variantList, positionX, streetElementId);
    } else if (segments[i].type === 'sidewalk-wayfinding') {
      createWayfindingElements(positionX, streetElementId);
    } else if (segments[i].type === 'sidewalk-bench') {
      var benchesParentId = 'bench-parent-' + positionX;
      // make the parent for all the benches
      createBenchesParentElement(positionX, benchesParentId, streetElementId);

      var rotationCloneY = (variantList[0] === 'right') ? -90 : 90;
      if (variantList[0] === 'center') {
        // nothing, oh my this gives me heartburn
      } else {
        // `right` or `left` bench
        cloneMixin({ objectMixinId: 'bench', parentId: benchesParentId, rotation: '0 ' + rotationCloneY + ' 0' });
      }
    } else if (segments[i].type === 'sidewalk-bike-rack') {
      // make the parent for all the trees
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bikerack-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 -3.5');
      placedObjectEl.setAttribute('id', 'bikerack-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationCloneY = (variantList[1] == 'sidewalk-parallel') ? 90 : 0;

      cloneMixin({ objectMixinId: 'bikerack', parentId: 'bikerack-parent-' + positionX, rotation: '0 ' + rotationCloneY + ' 0' });
    } else if (segments[i].type === 'bikeshare') {
      // make the parent for all the stations
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bikeshare');
      placedObjectEl.setAttribute('position', positionX + ' 0 0');
      placedObjectEl.setAttribute('id', 'bikeshare-' + positionX);
      placedObjectEl.setAttribute('mixin', 'bikeshare');
      var rotationCloneY = (variantList[0] == 'left') ? 90 : 270;
      placedObjectEl.setAttribute('rotation', '0 ' + rotationCloneY + ' 0');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    } else if (segments[i].type === 'sidewalk-tree') {
      // make the parent for all the trees
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'tree-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 7');
      placedObjectEl.setAttribute('id', 'tree-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      if (variantList[0] == 'palm-tree') {
        objectMixinId = 'palm-tree';
      } else {
        objectMixinId = 'tree3';
      }

      // clone a bunch of trees under the parent
      cloneMixin({ objectMixinId: objectMixinId, parentId: 'tree-parent-' + positionX, randomY: true });
    } else if (segments[i].type === 'sidewalk-lamp' && (variantList[1] === 'modern' || variantList[1] === 'pride')) {
      // make the parent for all the lamps
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'lamp-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'lamp-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      var rotationCloneY = (variantList[0] == 'right') ? -90 : 90;
      cloneMixin({ objectMixinId: 'lamp-modern', parentId: 'lamp-parent-' + positionX, rotation: '0 ' + rotationCloneY + ' 0' });

      if (variantList[0] == 'both') {
        cloneMixin({ objectMixinId: 'lamp-modern', parentId: 'lamp-parent-' + positionX, rotation: '0 -90 0' });
      }

      if (variantList[1] == 'pride' && (variantList[0] == 'right' || variantList[0] == 'both')) {
        cloneMixin({ objectMixinId: 'pride-flag', parentId: 'lamp-parent-' + positionX, positionXYString: '0.409 3.345' });
      }

      if (variantList[1] == 'pride' && (variantList[0] == 'left' || variantList[0] == 'both')) {
        cloneMixin({ objectMixinId: 'pride-flag', parentId: 'lamp-parent-' + positionX, rotation: '0 -180 0', positionXYString: '-0.409 3.345' });
      }
    } else if (segments[i].type === 'sidewalk-lamp' && variantList[1] === 'traditional') {
      // make the parent for all the lamps
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'lamp-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'lamp-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      cloneMixin({ objectMixinId: 'lamp-traditional', parentId: 'lamp-parent-' + positionX });
    } else if (segments[i].type === 'transit-shelter') {
      var rotationBusStopY = (variantList[0] == 'right') ? 0 : 180;
      var parityBusStop = (variantList[0] == 'right') ? 1 : -1;

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bus-stop');
      placedObjectEl.setAttribute('position', (positionX + (0.75 * parityBusStop)) + ' 0 0');
      placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusStopY + ' 0');
      placedObjectEl.setAttribute('mixin', 'bus-stop');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
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

    if (isSidewalk(segments[i].type)) {
      mixinId = 'sidewalk';
    }

    // add new object
    var segmentEl = document.createElement('a-entity');
    segmentEl.setAttribute('scale', scaleX + ' 1 1');
    segmentEl.setAttribute('position', positionX + ' ' + positionY + ' 0');

    // USE THESE 2 LINES FOR TEXTURE MODE:
    segmentEl.setAttribute('rotation', '270 ' + rotationY + ' 0');
    segmentEl.setAttribute('mixin', mixinId + state.textures.suffix); // append suffix to mixin id to specify texture index

    document.getElementById(streetElementId).appendChild(segmentEl);
    // returns JSON output instead
  }
}

function processBuildings (streetObject, buildingElementId) {
  // https://github.com/streetmix/illustrations/tree/master/images/buildings
  const buildingVariants = ['waterfront', 'grass', 'fence', 'parking-lot', 'residential', 'narrow', 'wide'];
  const buildingLotWidth = 150;
  const buildingsArray = [streetObject.leftBuildingVariant, streetObject.rightBuildingVariant];
  // console.log(buildingsArray);

  buildingsArray.forEach((currentValue, index) => {
    const side = (index == 0) ? 'left' : 'right';
    const sideMultiplier = (side == 'left') ? -1 : 1;

    const positionX = ((buildingLotWidth / 2) + (calcStreetWidth(streetObject.segments) / 2)) * sideMultiplier;

    if (currentValue == 'grass' || currentValue == 'fence') {
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('scale', '0.7425 1 0.7425');
      placedObjectEl.setAttribute('position', positionX + ' -0.2 0');
      placedObjectEl.setAttribute('id', 'ground-' + side);
      // add the new elmement to DOM
      placedObjectEl.setAttribute('ground', 'ground: flat; groundTexture: squares; groundColor: #32460a; groundColor2: #526117; groundYScale: 0.2; resolution: 2;');
      document.getElementById(buildingElementId).appendChild(placedObjectEl);
    }

    if (currentValue == 'narrow' || currentValue == 'wide') {
      // <a-entity id="blockinstance" mixin="block" position="-10.7 0 10" rotation="0 -90 0"></a-entity>
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', (positionX + (-80 * sideMultiplier)) + ' 0 10');
      placedObjectEl.setAttribute('rotation', '0 ' + (90 * sideMultiplier) + ' 0');
      //      sideMultiplier
      placedObjectEl.setAttribute('id', 'block-' + side);
      // add the new elmement to DOM
      placedObjectEl.setAttribute('mixin', 'block');
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('scale', '0.7425 1 0.7425');
      placedObjectEl.setAttribute('position', positionX + ' -0.2 0');
      placedObjectEl.setAttribute('id', 'ground-' + side);
      // add the new elmement to DOM
      placedObjectEl.setAttribute('ground', 'ground: flat; groundTexture: squares; groundColor: #292c2a; groundColor2: #343434; groundYScale: 0.2; resolution: 2;');
      document.getElementById(buildingElementId).appendChild(placedObjectEl);
    }

    if (currentValue == 'parking-lot') {
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('scale', '0.7425 1 0.7425');
      placedObjectEl.setAttribute('position', positionX + ' -0.2 0');
      placedObjectEl.setAttribute('id', 'ground-' + side);
      // add the new elmement to DOM
      placedObjectEl.setAttribute('ground', 'ground: flat; groundTexture: squares; groundColor: #292c2a; groundColor2: #343434; groundYScale: 0.2; resolution: 2;');
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      // place the parking stall stencils next
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);
      const offset = (side == 'right') ? 2.1 : -2.1;

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', (objectPositionX + offset) + ' -0.1 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      var rotationCloneY = (side == 'right') ? 180 : 0;
      cloneMixin({ objectMixinId: 'stencils perpendicular-stalls', parentId: 'stencils-parent-' + positionX, rotation: '-90 ' + rotationCloneY + ' 0', step: 10, radius: 75 });
    }

    if (currentValue == 'waterfront') {
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'seawall-parent');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 10'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'seawall-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      // clone a bunch of seawalls under the parent
      var rotationCloneY = (side == 'right') ? -90 : 90;
      cloneMixin({ objectMixinId: 'seawall', parentId: 'seawall-parent-' + positionX, rotation: '-90 ' + rotationCloneY + ' 0', step: 15, radius: 70 });
    }

    if (currentValue == 'fence' || currentValue == 'parking-lot') {
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);
      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'fence-parent');
      placedObjectEl.setAttribute('position', objectPositionX + ' 0 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'fence-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      var rotationCloneY = (side == 'right') ? -90 : 90;
      cloneMixin({ objectMixinId: 'fence', parentId: 'fence-parent-' + positionX, rotation: '0 ' + rotationCloneY + ' 0', step: 9.25, radius: 70 });
    }
  });
}
