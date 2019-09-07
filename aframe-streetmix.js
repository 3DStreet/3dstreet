

// Models - Each segment "type" is a separate model created in MagicaVoxel.
// Orientation - default model orientation is "outbound" (away from camera)

// Width - These are the intended default widths of the models in meters.
const defaultModelWidthsInMeters = {
  "bike-lane": 1.8,
  "drive-lane": 3,
  "divider": 0.3,
  "parking-lane": 2.4,
  "sidewalk": 3,
  "turn-lane": 3,
  "bus-lane": 3,
  "light-rail": 3,
  "streetcar": 3,
  "sidewalk-wayfinding": 3,
}

// Scale - Normally a MagicaVoxel voxel = 1 meter in A-Frame by default
// However for this project each voxel represents 1 decimeter (1/10th of a meter).
// We need to reduce the size of the model (scale * 0.1) to compensate.
const voxelScaleFactor = 0.1;

function processSegments(segments, streetElementId) {
  // takes a street's `segments` (array) from streetmix and a `streetElementId` (string) and places objects to make up a street with all segments
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
    console.log(variantList);

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY = (variantList[0] == "inbound") ? 180 : 0;

    // the 3d model file name of a segment type is usually identical, let's start with that
    var mixinId = segments[i].type;

    // there are some cases to look at segment variants in order to find the right model
    // if type && variant2 then use model  ... there's definitely a better way to do this ...
    if (segments[i].type == "drive-lane" && variantList[1] == "sharrow") {mixinId = "drive-lane-sharrow"};
    if (segments[i].type == "turn-lane" && variantList[1] == "both") {mixinId = "turn-lane-both"};
    if (segments[i].type == "turn-lane" && variantList[1] == "shared") {mixinId = "turn-lane-shared"};
    if (segments[i].type == "turn-lane" && variantList[1] == "left") {mixinId = "turn-lane-left"};
    if (segments[i].type == "turn-lane" && variantList[1] == "left-straight") {mixinId = "turn-lane-left-straight"};
    if (segments[i].type == "turn-lane" && variantList[1] == "straight") {mixinId = "turn-lane-straight"};
    if (segments[i].type == "turn-lane" && variantList[1] == "right") {
      mixinId = "turn-lane-left";
      // NEGATIVE SCALE NOT RECOMMENDED - https://github.com/aframevr/aframe/issues/717
      scaleX = scaleX * (-1);
      scaleY = scaleY * (-1); // this is added otherwise scaleX invert renders the model darker for some reason
      positionY = positionY + 0.1; // this is added because scaleY invert displaces the lane down by 0.1 for some reason
    }
    if (segments[i].type == "turn-lane" && variantList[1] == "right-straight") {
      mixinId = "turn-lane-left-straight";
      scaleX = scaleX * (-1);
      scaleY = scaleY * (-1); // this is added otherwise scaleX invert renders the model darker for some reason
      positionY = positionY + 0.1; // this is added because scaleY invert displaces the lane down by 0.1 for some reason
    }
    if (segments[i].type == "divider" && variantList[0] == "bollard") {mixinId = "divider-bollard"};
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

    // add new object
    var segmentEl = document.createElement("a-entity");
    segmentEl.setAttribute("scale", scaleX + " " + scaleY + " " + scaleZ);
    segmentEl.setAttribute("position", positionX + " " + positionY + " 0");
    segmentEl.setAttribute("rotation", "0 " + rotationY + " 0")
    segmentEl.setAttribute("mixin", mixinId + "-vox");
    document.getElementById(streetElementId).appendChild(segmentEl);

  };
};

function loadStreet(streetURL) {
  // Erase exiting city (if any)
  for (var i=-6; i<7; i++) {
    var streetEl = document.getElementById("street" + i);
    while (streetEl.firstChild) {
      streetEl.removeChild(streetEl.firstChild);
    }
  }

  // getjson replacement from http://youmightnotneedjquery.com/#json
  var request = new XMLHttpRequest();
  request.open('GET', streetURL, true);
  request.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      // Connection success
      var streetmixObject = JSON.parse(this.response);
      var streetmixSegments = streetmixObject.data.street.segments;
      processSegments(streetmixSegments, "street0");
      processSegments(streetmixSegments, "street1");
      processSegments(streetmixSegments, "street2");
      processSegments(streetmixSegments, "street3");
      processSegments(streetmixSegments, "street4");
      processSegments(streetmixSegments, "street5");
      processSegments(streetmixSegments, "street6");
      processSegments(streetmixSegments, "street-1");
      processSegments(streetmixSegments, "street-2");
      processSegments(streetmixSegments, "street-3");
      processSegments(streetmixSegments, "street-4");
      processSegments(streetmixSegments, "street-5");
      processSegments(streetmixSegments, "street-6");
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
