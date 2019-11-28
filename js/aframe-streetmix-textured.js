// Models - Each segment "type" is a separate model created in MagicaVoxel.
// Orientation - default model orientation is "outbound" (away from camera)

// Width - These are the intended default widths of the models in meters.
const defaultModelWidthsInMeters = {
  "bike-lane": 1.8,
  "drive-lane": 3,
  "divider": 0.3,
  "parking-lane": 3,
  "sidewalk": 3,
  "sidewalk-tree": 3,
  "turn-lane": 3,
  "bus-lane": 3,
  "light-rail": 3,
  "streetcar": 3,
  "sidewalk-wayfinding": 3,
  "sidewalk-lamp": 3,
  "sidewalk-bike-rack": 3,
  "sidewalk-bench": 3,
  "scooter-drop-zone": 3,
  "bikeshare": 3,
  "flex-zone-curb": 3,
  "transit-shelter": 3,
}

// Scale - Normally a MagicaVoxel voxel = 1 meter in A-Frame by default
// However for this project each voxel represents 1 decimeter (1/10th of a meter).
// We need to reduce the size of the model (scale * 0.1) to compensate.
const voxelScaleFactor = 1;     // USE THIS LINE FOR TEXTURE MODE
// const voxelScaleFactor = 0.1;   // USE THIS LINE FOR VOXEL MODE

function isSidewalk(string) {
  // https://streetmix.net/api/v1/streets/3f1a9810-0a8f-11ea-adff-7fe273b63f1d
//  return if string sidewalk* or "scooter-drop-zone", bikeshare, flex-zone-curb, transit-shelter
  const sidewalkList = ['scooter-drop-zone', 'bikeshare', 'flex-zone-curb', 'transit-shelter'];
  return string.substring(0,8) == 'sidewalk' || sidewalkList.includes(string);
}

function cloneMixin({objectMixinId="", parentId="", step=15, radius=60, rotation="0 0 0", positionXYString="0 0"}) {
  for (var j = (radius * -1); j <= radius; j = j + step) {
    var placedObjectEl = document.createElement("a-entity");
    placedObjectEl.setAttribute("class", objectMixinId);
    placedObjectEl.setAttribute("position", positionXYString + " " + j);
    placedObjectEl.setAttribute("mixin", objectMixinId);
    placedObjectEl.setAttribute("rotation", rotation);
    // add the new elmement to DOM
    document.getElementById(parentId).appendChild(placedObjectEl);
    // could be good to use geometry merger https://github.com/supermedium/superframe/tree/master/components/geometry-merger

  }
}

function insertSeparatorSegments(segments) {
  // takes a list of segments
  // if adjacent `*lane`, add separator
  // OLD SEGMENTS
  // console.log('Old segments', segments);

  const newValues = segments.reduce((newArray, currentValue, currentIndex, arr) => {
    // don't insert a lane marker for the first segment
    if (currentIndex == 0) { return newArray.concat(currentValue) }

    const previousValue = arr[currentIndex - 1];

    // if current AND previous segments have last 4 characters of `type` = "lane"
    if (currentValue.type.slice(currentValue.type.length - 4) == "lane" && previousValue.type.slice(arr[currentIndex - 1].type.length - 4) == "lane") {
      // add zero width separator segment
      var variantString = "solid";

      // if identical lane types are adjacent, then used dashed
      if (currentValue.type == previousValue.type) { variantString = "dashed" }

      // if adjacent segments in opposite directions then use double yellow
      if (currentValue.variantString.split("|")[0] !== previousValue.variantString.split("|")[0]) {
        variantString = "doubleyellow";
      }

      newArray.push( {type: "separator", variantString: variantString, width: 0} )
    }

    // if a *lane segment and divider are adjacent, use a solid separator
    if ((currentValue.type.slice(currentValue.type.length - 4) == "lane" && previousValue.type == "divider") || (previousValue.type.slice(previousValue.type.length - 4) == "lane" && currentValue.type == "divider")) {
      newArray.push( {type: "separator", variantString: "solid", width: 0} )
    }

    newArray.push(currentValue);
    return newArray;
  }, []);

  // console.log('newValues =', newValues)
  // console.log(segments);

  return newValues;
}

function calcStreetWidth(segments) {
  var cumulativeWidthInMeters = 0;
  segments.forEach((currentSegment) => {
    const segmentWidthInFeet = currentSegment.width;
    const segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
  });
  return cumulativeWidthInMeters;
}

function processSegments(segments, streetElementId) {
  // takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
  segments = insertSeparatorSegments(segments);
  // console.log(segments);

  // offset to center the street around global x position of 0
  const streetWidth = calcStreetWidth(segments);
  const offset = 0 - streetWidth / 2;
  document.getElementById(streetElementId).setAttribute("position", offset + " 0 0")

  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {

    var segmentType = segments[i].type;
    var segmentWidthInFeet = segments[i].width;
    var segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    console.log("Type: " + segmentType + "; Width: " + segmentWidthInFeet + "ft / " + segmentWidthInMeters + "m");

    var modelWidthInMeters = defaultModelWidthsInMeters[segmentType];
//    console.log("Model Default Width: " + modelWidthInMeters + "m");

    // what is "delta" between default width and requested width?
    // default * scale = requested :: scale = requested / default
    // For example: requested width = 2m, but default model width is 1.8. 2 / 1.8 = 1.111111111
    var scaleX = segmentWidthInMeters / modelWidthInMeters * voxelScaleFactor;
    var scaleY = voxelScaleFactor;
    var scaleZ = voxelScaleFactor;
//    console.log("Scale: " + scaleX);

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
//    console.log("Cumulative Street Width: " + cumulativeWidthInMeters + "m");

    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    var positionY = 0;

    // get variantString
    var variantList = segments[i].variantString.split("|");
    // console.log(variantList);

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY = (variantList[0] == "inbound") ? 180 : 0;

    // the 3d model file name of a segment type is usually identical, let's start with that
    var mixinId = segments[i].type;

    // there are some cases to look at segment variants in order to find the right model
    // if type && variant2 then use model  ... there's definitely a better way to do this ...

    // sharrow variant not supported
    if (segments[i].type == "drive-lane" && variantList[1] == "sharrow") {
      mixinId = "drive-lane";
      const markerMixinId = variantList[1];
      var mixinString = "markings " + markerMixinId

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "markings-parent");
      placedObjectEl.setAttribute("position", positionX + " 0.015 0");  // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute("id", "markings-parent-" + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({objectMixinId: mixinString, parentId: "markings-parent-" + positionX, rotation: "-90 " + rotationY + " 0", step: 10, radius: 70});

    };

    if (segments[i].type == "turn-lane" ) {
      mixinId = "drive-lane";       // use normal drive lane road material
      const markerMixinId = variantList[1];       // set the mixin of the road markings to match the current variant name
      var mixinString = "markings " + markerMixinId

      // variant doesn't exist yet      if (segments[i].type == "turn-lane" && variantList[1] == "shared") {mixinId = "turn-lane-shared"};

      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "markings-parent");
      placedObjectEl.setAttribute("position", positionX + " 0.015 0");  // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute("id", "markings-parent-" + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      cloneMixin({objectMixinId: mixinString, parentId: "markings-parent-" + positionX, rotation: "-90 " + rotationY + " 0", step: 10, radius: 70});
    }

    if (segments[i].type == "divider" && variantList[0] == "bollard") {mixinId = "divider-bollard"};

    if (segments[i].type == "bus-lane") {
      var rotationBusY = (variantList[0] == "inbound") ? -90 : 90;
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "bus");
      placedObjectEl.setAttribute("position", positionX + " 1.4 0");
      placedObjectEl.setAttribute("rotation", "0 " + rotationBusY + " 0");
      placedObjectEl.setAttribute("mixin", "bus");

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      var rotationBusY = (variantList[0] == "inbound") ? -90 : 90;
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "bus-shadow");
      placedObjectEl.setAttribute("position", positionX + " 0.01 0");
      placedObjectEl.setAttribute("rotation", "-90 " + rotationBusY + " 0");
      placedObjectEl.setAttribute("mixin", "bus-shadow");

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    };

    if (segments[i].type == "drive-lane") {
      var rotationBusY = (variantList[0] == "inbound") ? 0 : 180;
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "car");
      placedObjectEl.setAttribute("position", positionX + " 0 0");
      placedObjectEl.setAttribute("rotation", "0 " + rotationBusY + " 0");
      placedObjectEl.setAttribute("mixin", "car");

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);


      var rotationBusY = (variantList[0] == "inbound") ? -90 : 90;
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "car-shadow");
      placedObjectEl.setAttribute("position", positionX + " 0.01 0");
      placedObjectEl.setAttribute("rotation", "-90 " + rotationBusY + " 0");
      placedObjectEl.setAttribute("mixin", "car-shadow");

      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
    };

    if (segments[i].type == "sidewalk-wayfinding" && variantList[0] == "medium") {
      mixinId = "sidewalk"; // this is the "ground, normal "
      // scaleX = scaleX * (-1);
      // scaleY = scaleY * (-1); // this is added otherwise scaleX invert renders the model darker for some reason
      // positionY = positionY + 0.1; // this is added because scaleY invert displaces the lane down by 0.1 for some reason
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", segments[i].type);
      placedObjectEl.setAttribute("scale", "0.1 0.13 0.1");
      placedObjectEl.setAttribute("position", positionX + "0 0");
      placedObjectEl.setAttribute("rotation", "0 270 0")
      placedObjectEl.setAttribute("obj-model", "obj", "#pylon-obj");
      placedObjectEl.setAttribute("id", streetElementId + segments[i].type)
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);
      // workaround to assign material: fetch the same element after added to DOM then change material SRC
      placedObjectEl = document.getElementById(streetElementId + segments[i].type);
      placedObjectEl.setAttribute("material", "src:#wayfinding");
    };

    if (segments[i].type == "streetcar") {mixinId = "light-rail"};

    if (segments[i].type == "sidewalk-lamp" && (variantList[1] == "modern" || variantList[1] == "pride")) {
      // sidewalk mixin as the segment surface - this doesn't look great (squished texture not made for this width)
      mixinId = "sidewalk";

      // make the parent for all the lamps
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "lamp-parent");
      placedObjectEl.setAttribute("position", positionX + " 0 0");  // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute("id", "lamp-parent-" + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      var rotationCloneY = (variantList[0] == "right") ? -90 : 90;
      cloneMixin({objectMixinId: "lamp-modern", parentId: "lamp-parent-" + positionX, rotation: "0 " + rotationCloneY + " 0"});

      if (variantList[0] == "both") {
        cloneMixin({objectMixinId: "lamp-modern", parentId: "lamp-parent-" + positionX, rotation: "0 -90 0"});
      }

      if (variantList[1] == "pride" && (variantList[0] == "right" || variantList[0] == "both")) {
        cloneMixin({objectMixinId: "pride-flag", parentId: "lamp-parent-" + positionX, positionXYString: "0.409 3.345"});
      }

      if (variantList[1] == "pride" && (variantList[0] == "left" || variantList[0] == "both")) {
        cloneMixin({objectMixinId: "pride-flag", parentId: "lamp-parent-" + positionX, rotation: "0 -180 0", positionXYString: "-0.409 3.345"});
      }

    };

    if (segments[i].type == "sidewalk-lamp" && variantList[1] == "traditional") {
      // sidewalk mixin
      mixinId = "sidewalk";

      // make the parent for all the lamps
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "lamp-parent");
      placedObjectEl.setAttribute("position", positionX + " 0 0");  // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute("id", "lamp-parent-" + positionX);
      // add the new elmement to DOM
      document.getElementById(streetElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      cloneMixin({objectMixinId: "lamp-traditional", parentId: "lamp-parent-" + positionX});


    };

    if (segments[i].type == "separator" && variantList[0] == "dashed") {
      mixinId = "separator-dashed";
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    };

    if (segments[i].type == "separator" && variantList[0] == "solid") {
      mixinId = "separator-solid";
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    };

    if (segments[i].type == "separator" && variantList[0] == "doubleyellow") {
      mixinId = "separator-doubleyellow";
      positionY = positionY + 0.01; // make sure the lane marker is above the asphalt
      scaleX = 1;
    };

    if (segments[i].type == "parking-lane") {mixinId = "drive-lane"};

    if (isSidewalk(segments[i].type)) {
      mixinId = "sidewalk";
    }

    // add new object
    var segmentEl = document.createElement("a-entity");
    segmentEl.setAttribute("scale", scaleX + " " + scaleY + " " + scaleZ);
    segmentEl.setAttribute("position", positionX + " " + positionY + " 0");

    // USE THESE 2 LINES FOR TEXTURE MODE:
    segmentEl.setAttribute("rotation", "270 " + rotationY + " 0")
    segmentEl.setAttribute("mixin", mixinId + "-t1");

    // USE THESE 2 LINES FOR VOXEL MODE:
    // segmentEl.setAttribute("rotation", "0 " + rotationY + " 0")
    // segmentEl.setAttribute("mixin", mixinId + "-vox");
    document.getElementById(streetElementId).appendChild(segmentEl);

  };
};

function processBuildings(streetObject, buildingElementId) {
  // https://github.com/streetmix/illustrations/tree/master/images/buildings
  const buildingVariants = ["waterfront", "grass", "fence", "parking-lot", "residential", "narrow", "wide"]
  const buildingLotWidth = 150;
  const buildingsArray = [streetObject.leftBuildingVariant, streetObject.rightBuildingVariant];
  // console.log(buildingsArray);

  buildingsArray.forEach((currentValue, index) => {
    const side = (index == 0) ? "left" : "right";
    const sideMultiplier = (side == "left") ? -1 : 1;

    const positionX = ((buildingLotWidth / 2) + (calcStreetWidth(streetObject.segments) / 2)) * sideMultiplier;

    if (currentValue == "grass" || currentValue == "fence") {
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("scale", "0.7425 1 0.7425");
      placedObjectEl.setAttribute("position", positionX + " -0.2 0");
      placedObjectEl.setAttribute("id", "building-" + side);
      // add the new elmement to DOM
      placedObjectEl.setAttribute("ground", "groundTexture: squares; groundColor: #638a14; groundColor2: #788d1e; groundYScale: 0.2");
      document.getElementById(buildingElementId).appendChild(placedObjectEl);
    }

    if (currentValue == "fence") {
      const objectPositionX = positionX - (sideMultiplier * buildingLotWidth / 2);
      // make the parent for all the objects to be cloned
      var placedObjectEl = document.createElement("a-entity");
      placedObjectEl.setAttribute("class", "fence-parent");
      placedObjectEl.setAttribute("position", objectPositionX + " 0 0");  // position="1.043 0.100 -3.463"
      placedObjectEl.setAttribute("id", "fence-parent-" + positionX);
      // add the new elmement to DOM
      document.getElementById(buildingElementId).appendChild(placedObjectEl);

      // clone a bunch of lamps under the parent
      var rotationCloneY = (side == "right") ? -90 : 90;
      cloneMixin({objectMixinId: "fence", parentId: "fence-parent-" + positionX, rotation: "0 " + rotationCloneY + " 0", step: 2.40, radius: 75});

    }
  })
}

function loadStreet(streetURL) {
  // Erase existing street (if any)
  var myNode = document.getElementById("streets");
  myNode.innerHTML = '';

  myNode = document.getElementById("buildings");
  myNode.innerHTML = '';

  // getjson replacement from http://youmightnotneedjquery.com/#json
  var request = new XMLHttpRequest();
  request.open('GET', streetURL, true);
  request.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      // Connection success
      var streetmixObject = JSON.parse(this.response);
      var streetObject = streetmixObject.data.street;
      var streetmixSegments = streetmixObject.data.street.segments;
      processSegments(streetmixSegments, "streets");
      processBuildings(streetObject, "buildings");
    } else {
      // We reached our target server, but it returned an error
      console.log("oops - We reached our target server, but it returned an error");
    }
  };
  request.onerror = function() {
    // There was a connection error of some sort
    console.log("oops - There was a connection error of some sort");
  };
  request.send();
};

function initStreet() {
  // Is there a URL in the URL HASH?
  var streetURL = location.hash.substring(1);
  console.log("hash check: " + streetURL);

  if (streetURL) {
    var pathArray = new URL(streetURL).pathname.split( '/' );
    // optimistically try to convert from streetmix URL to api url
    if (pathArray[1] != "api") {
      streetURL = streetmixUserToAPI(streetURL);
    }
  } else {    // DEFAULTS if no URL provided then here are some defaults to choose from:
    // LOCAL
    // var streetURL = 'sample.json';

    // REMOTE WITH REDIRECT:
    var streetURL = 'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr';

    // DIRECT TO REMOTE FILE: - don't use this since it's hard to convert back to user friendly URL
    // var streetURL = 'https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876';
  };

  console.log("streetURL check: " + streetURL);
  loadStreet(streetURL);
  window.location.hash = '#' + streetmixAPIToUser(streetURL);
  document.getElementById("input-url").value = streetmixAPIToUser(streetURL);

  // Run processURLChange when Enter pressed on input field
  document.getElementById('input-url').onkeypress = function(e){
    if (!e) e = window.event;
    var keyCode = e.keyCode || e.which;
    if (keyCode == '13'){
      // Enter pressed
      processURLChange();
    }
  }

}
window.onload = initStreet;

// If URL Hash Changed load new street from this value
function locationHashChanged() {
  // check if valid hash
  // if yes, then clear old city // load new city with that hash
  var streetURL = location.hash.substring(1);
  console.log("hash changed to: " + streetURL);

  if (streetURL) {
    var pathArray = new URL(streetURL).pathname.split( '/' );
    // optimistically try to convert from streetmix URL to api url
    if (pathArray[1] != "api") {
      streetURL = streetmixUserToAPI(streetURL);
    }

    loadStreet(streetURL);

    // update the user interface to show the new URL
    document.getElementById("input-url").value = streetmixAPIToUser(streetURL);
  };
}
window.onhashchange = locationHashChanged;

// Load new street from input-url value
function processURLChange() {
  var streetURL = document.getElementById("input-url").value;
  console.log("hash changed to: " + streetURL);

  if (streetURL) {
    var pathArray = new URL(streetURL).pathname.split( '/' );
    // optimistically try to convert from streetmix URL to api url
    if (pathArray[1] != "api") {
      streetURL = streetmixUserToAPI(streetURL);
    }

    loadStreet(streetURL);
    window.location.hash = '#' + streetmixAPIToUser(streetURL);

  };
}



function streetmixUserToAPI(userURL) {
  // this takes in a user facing Streetmix.net URL like https://streetmix.net/kfarr/3/a-frame-city-builder-street-only
  // and turns it into the API redirect URL like https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr
  var pathArray = new URL(userURL).pathname.split( '/' );
  creatorId = pathArray[1];
  namespacedId = pathArray[2];
  return "https://streetmix.net/api/v1/streets?namespacedId=" + namespacedId + "&creatorId=" + creatorId;
};

function streetmixAPIToUser(APIURL) {
  // this takes in a Streetmix.net API redirect URL like https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr
  // and turns it into the user facing friendly Streetmix.net URL like https://streetmix.net/kfarr/3/a-frame-city-builder-street-only

  // modified from: https://stackoverflow.com/questions/2090551/parse-query-string-in-javascript
  function getQueryVariable(queryString, variable) {
    var vars = queryString.split('&');
    for (var i = 0; i < vars.length; i++) {
      var pair = vars[i].split('=');
      if (decodeURIComponent(pair[0]) == variable) {
        return decodeURIComponent(pair[1]);
      }
    }
    console.log('Query variable %s not found', variable);
  }
  var queryString = new URL(APIURL).search.substring(1);
  var namespacedId = getQueryVariable(queryString, "namespacedId");
  var creatorId = getQueryVariable(queryString, "creatorId");
  return "https://streetmix.net/" + creatorId + "/" + namespacedId;
};
