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

function createBikeLaneStencilElement (positionX, elementId, parentElementId) {
  // make the parent for all the objects to be cloned
  var placedObjectEl = document.createElement('a-entity');
  placedObjectEl.setAttribute('class', 'stencils-parent');
  placedObjectEl.setAttribute('position', positionX + ' 0.015 0'); // position="1.043 0.100 -3.463"
  placedObjectEl.setAttribute('id', elementId);
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

function processSegments (segments, streetElementId) {
  // takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
  segments = insertSeparatorSegments(segments);
  // console.log(segments);

  // TODO: extract to separate function - begin
  // offset to center the street around global x position of 0
  const streetWidth = calcStreetWidth(segments);
  const offset = 0 - streetWidth / 2;
  document.getElementById(streetElementId).setAttribute('position', offset + ' 0 0');
  // TODO: extract to separate function - end

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {
    var segmentType = segments[i].type;
    var segmentWidthInFeet = segments[i].width;
    var segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    console.log('Type: ' + segmentType + '; Width: ' + segmentWidthInFeet + 'ft / ' + segmentWidthInMeters + 'm');

    var modelWidthInMeters = defaultModelWidthsInMeters[segmentType];
    //    console.log("Model Default Width: " + modelWidthInMeters + "m");

    // what is "delta" between default width and requested width?
    // default * scale = requested :: scale = requested / default
    // For example: requested width = 2m, but default model width is 1.8. 2 / 1.8 = 1.111111111
    var scaleX = segmentWidthInMeters / modelWidthInMeters;
    //    console.log("Scale: " + scaleX);

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    //    console.log("Cumulative Street Width: " + cumulativeWidthInMeters + "m");

    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    var positionY = 0;

    // get variantString
    var variantList = segments[i].variantString.split('|');
    // console.log(variantList);

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY = (variantList[0] == 'inbound') ? 180 : 0;
    var isOutbound = (variantList[0] == 'outbound') ? 1 : -1;

    // the 3d model file name of a segment type is usually identical, let's start with that
    var mixinId = segments[i].type;

    // there are some cases to look at segment variants in order to find the right model
    // if type && variant2 then use model  ... there's definitely a better way to do this ...

    // sharrow variant not supported
    if (segments[i].type == 'drive-lane' && variantList[1] == 'sharrow') {
      const markerMixinId = variantList[1];
      var mixinString = 'stencils ' + markerMixinId;

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0.015 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // Add another entry in the JSON output

      cloneMixin({ objectMixinId: mixinString, parentId: 'stencils-parent-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 10, radius: 70 });
    }

    if (segments[i].type === 'bike-lane' || segments[i].type === 'scooter') {
      const elementId = 'stencils-parent-' + positionX;

      createBikeLaneStencilElement(positionX, elementId, streetElementId);
      mixinId = getBikeLaneMixin(variantList[1]);

      cloneMixin({ objectMixinId: 'stencils bike-lane', parentId: elementId, rotation: '-90 ' + rotationY + ' 0', step: 20, radius: 70 });
    }

    if (segments[i].type == 'light-rail' || segments[i].type == 'streetcar') {
      mixinId = 'bus-lane';
      if (variantList[1] == 'colored') {
        var mixinId = 'surface-red bus-lane';
      }
      if (variantList[1] == 'grass') {
        var mixinId = 'surface-green bus-lane';
      }

      var objectMixinId = (segments[i].type == 'streetcar') ? 'trolley' : 'tram';

      // <a-curve id="track1">
      //   <a-curve-point position="0 0 75" geometry="primitive:box; height:0.1; width:0.1; depth:0.1" material="color:#ff0000"></a-curve-point>
      //   <a-curve-point position="0 0 0" geometry="primitive:box; height:0.1; width:0.1; depth:0.1" material="color:#ff0000"></a-curve-point>
      //   <a-curve-point position="0 0 -75" geometry="primitive:box; height:0.1; width:0.1; depth:0.1" material="color:#ff0000"></a-curve-point>
      // </a-curve>
      //
      // <a-entity id="tram-instance1" mixin="tram" alongpath="curve: #track1; loop:true; dur:10000; rotate:false;" ></a-entity>

      var pathEl = document.createElement('a-curve');
      pathEl.setAttribute('id', 'path-' + i);
      pathEl.innerHTML = `
        <a-curve-point id="checkpoint1" position="${positionX} 0 ${75 * isOutbound}"></a-curve-point>
        <a-curve-point id="checkpoint2" position="${positionX} 0 0"></a-curve-point>
        <a-curve-point id="checkpoint3" position="${positionX} 0 ${-75 * isOutbound}"></a-curve-point>
      `;
      document.getElementById(streetElementId).appendChild(pathEl);

      // add choo choo
      var rotationBusY = (variantList[0] == 'inbound') ? 0 : 180;
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', objectMixinId);
      placedObjectEl.setAttribute('position', positionX + ' 0 0');
      placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
      placedObjectEl.setAttribute('mixin', objectMixinId);
      placedObjectEl.setAttribute('alongpath', 'curve: #path-' + i + '; loop:true; dur:20000;');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      placedObjectEl.addEventListener('movingstarted', function (e) {
        console.log('movingstarted', e);
        if (state.sounds.enabled) {
          // this creates console error if the placedObjectEl does not have a sound associated
          this.components.sound.playSound();
        }
      });

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'track-parent');
      placedObjectEl.setAttribute('position', positionX + ' -0.2 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'track-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({ objectMixinId: 'track', parentId: 'track-parent-' + positionX, step: 20.25, radius: 80 });
    }

    // variant doesn't exist yet      if (segments[i].type == "turn-lane" && variantList[1] == "shared") {mixinId = "turn-lane-shared"};
    if (segments[i].type == 'turn-lane') {
      mixinId = 'drive-lane'; // use normal drive lane road material
      var markerMixinId = variantList[1]; // set the mixin of the road markings to match the current variant name

      // Fix streetmix inbound turn lane orientation (change left to right)
      // Remove this when this ticket is resolved: https://github.com/streetmix/streetmix/issues/683
      if (variantList[0] == 'inbound') {
        markerMixinId = markerMixinId.replace(/left|right/g, function (m) {
          return m === 'left' ? 'right' : 'left';
        });
      }

      if (variantList[1] == 'shared') {
        markerMixinId = 'left';
      }

      if (variantList[1] == 'left-right-straight') {
        markerMixinId = 'all';
      }

      var mixinString = 'stencils ' + markerMixinId;

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0.015 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
      cloneMixin({ objectMixinId: mixinString, parentId: 'stencils-parent-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 15, radius: 70 });

      if (variantList[1] == 'shared') {
        // add an additional marking to represent the opposite turn marking stencil (rotated 180º)
        var placedObjectEl = document.createElement('a-entity');
        placedObjectEl.setAttribute('class', 'stencils-parent');
        placedObjectEl.setAttribute('position', positionX + ' 0.015 ' + (-3 * isOutbound)); // position="1.043 0.100 -3.463"
        placedObjectEl.setAttribute('id', 'stencils-parent-offset2-' + positionX);
        // add the new elmement to DOM
        document.getElementById(streetElementId).appendChild(placedObjectEl);
        cloneMixin({ objectMixinId: mixinString, parentId: 'stencils-parent-offset2-' + positionX, rotation: '-90 ' + (rotationY + 180) + ' 0', step: 15, radius: 70 });
      }
    }

    if (segments[i].type == 'divider' && variantList[0] == 'bollard') {
      mixinId = 'divider';

      // make some safehits
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'safehit-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 0');
      placedObjectEl.setAttribute('id', 'safehit-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({ objectMixinId: 'safehit', parentId: 'safehit-parent-' + positionX, step: 4, radius: 70 });
    }

    if (segments[i].type == 'bus-lane') {
      if (variantList[1] == 'colored') {
        var mixinId = 'surface-red bus-lane';
      }

      var rotationBusY = (variantList[0] == 'inbound') ? -90 : 90;
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bus');
      placedObjectEl.setAttribute('position', positionX + ' 1.4 0');
      placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
      placedObjectEl.setAttribute('mixin', 'bus');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationBusY = (variantList[0] == 'inbound') ? -90 : 90;
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bus-shadow');
      placedObjectEl.setAttribute('position', positionX + ' 0.01 0');
      placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusY + ' 0');
      placedObjectEl.setAttribute('mixin', 'bus-shadow');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0.015 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({ objectMixinId: 'stencils word-bus', parentId: 'stencils-parent-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0.015 10'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-offset10-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({ objectMixinId: 'stencils word-taxi', parentId: 'stencils-parent-offset10-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'stencils-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0.015 20'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'stencils-parent-offset20-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({ objectMixinId: 'stencils word-only', parentId: 'stencils-parent-offset20-' + positionX, rotation: '-90 ' + rotationY + ' 0', step: 50, radius: 70 });
    }

    if (segments[i].type == 'drive-lane') {
      var rotationBusY = (variantList[0] == 'inbound') ? 0 : 180;
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'car');
      placedObjectEl.setAttribute('position', positionX + ' 0 0');
      placedObjectEl.setAttribute('rotation', '0 ' + rotationBusY + ' 0');
      placedObjectEl.setAttribute('mixin', 'car');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationBusY = (variantList[0] == 'inbound') ? -90 : 90;
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'car-shadow');
      placedObjectEl.setAttribute('position', positionX + ' 0.01 0');
      placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusY + ' 0');
      placedObjectEl.setAttribute('mixin', 'car-shadow');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    }

    if (segments[i].type == 'sidewalk-wayfinding') {
      mixinId = 'sidewalk'; // this is the "ground, normal"

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', positionX + ' 1 0');
      placedObjectEl.setAttribute('mixin', 'wayfinding-box');
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', positionX + ' 1.2 0.06');
      placedObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
      placedObjectEl.setAttribute('material', 'src:#wayfinding-map');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('position', positionX + ' 1.2 -0.06');
      placedObjectEl.setAttribute('rotation', '0 180 0');
      placedObjectEl.setAttribute('geometry', 'primitive: plane; width: 0.8; height: 1.6');
      placedObjectEl.setAttribute('material', 'src:#wayfinding-map');
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    }

    if (segments[i].type == 'sidewalk-bench') {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = 'sidewalk';

      // make the parent for all the trees
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bench-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 3.5');
      placedObjectEl.setAttribute('id', 'bench-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationCloneY = (variantList[0] == 'right') ? -90 : 90;

      if (variantList[0] == 'center') {
        // nothing, oh my this gives me heartburn
      } else {
        // `right` or `left` bench
        cloneMixin({ objectMixinId: 'bench', parentId: 'bench-parent-' + positionX, rotation: '0 ' + rotationCloneY + ' 0' });
      }
    }

    if (segments[i].type == 'sidewalk-bike-rack') {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = 'sidewalk';

      // make the parent for all the trees
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bikerack-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 -3.5');
      placedObjectEl.setAttribute('id', 'bikerack-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationCloneY = (variantList[1] == 'sidewalk-parallel') ? 90 : 0;

      cloneMixin({ objectMixinId: 'bikerack', parentId: 'bikerack-parent-' + positionX, rotation: '0 ' + rotationCloneY + ' 0' });
    }

    if (segments[i].type == 'bikeshare') {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = 'sidewalk';

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
    }

    if (segments[i].type == 'sidewalk-tree') {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = 'sidewalk';

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
    }

    if (segments[i].type == 'sidewalk-lamp' && (variantList[1] == 'modern' || variantList[1] == 'pride')) {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = 'sidewalk';

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
    }

    if (segments[i].type == 'sidewalk-lamp' && variantList[1] == 'traditional') {
      // sidewalk mixin
      mixinId = 'sidewalk';

      // make the parent for all the lamps
      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'lamp-parent');
      placedObjectEl.setAttribute('position', positionX + ' 0 0'); // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute('id', 'lamp-parent-' + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      cloneMixin({ objectMixinId: 'lamp-traditional', parentId: 'lamp-parent-' + positionX });
    }

    if (segments[i].type == 'transit-shelter') {
      var rotationBusStopY = (variantList[0] == 'right') ? 0 : 180;
      var parityBusStop = (variantList[0] == 'right') ? 1 : -1;

      var placedObjectEl = document.createElement('a-entity');
      placedObjectEl.setAttribute('class', 'bus-stop');
      placedObjectEl.setAttribute('position', (positionX + (0.75 * parityBusStop)) + ' 0 0');
      placedObjectEl.setAttribute('rotation', '-90 ' + rotationBusStopY + ' 0');
      placedObjectEl.setAttribute('mixin', 'bus-stop');

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    }

    if (segments[i].type == 'separator' && variantList[0] == 'dashed') {
      mixinId = 'markings dashed-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    }

    if (segments[i].type == 'separator' && variantList[0] == 'solid') {
      mixinId = 'markings solid-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    }

    if (segments[i].type == 'separator' && variantList[0] == 'doubleyellow') {
      mixinId = 'markings solid-doubleyellow';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    }

    if (segments[i].type == 'separator' && variantList[0] == 'shortdashedyellow') {
      mixinId = 'markings yellow short-dashed-stripe';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    }

    if (segments[i].type == 'separator' && variantList[0] == 'soliddashedyellow') {
      mixinId = 'markings yellow solid-dashed';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    }

    if (segments[i].type == 'separator' && variantList[0] == 'soliddashedyellowinverted') {
      mixinId = 'markings yellow solid-dashed';
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
      rotationY = '180';
    }

    if (segments[i].type == 'parking-lane') {
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
