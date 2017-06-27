

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
}

// Scale - Normally a MagicaVoxel voxel = 1 meter in A-Frame by default
// However for this project each voxel represents 1 decimeter (1/10th of a meter).
// We need to reduce the size of the model (scale * 0.1) to compensate.
const voxelScaleFactor = 0.1;

function processSegments(segments, streetElementId) {
  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {

    var segmentType = segments[i].type;
    var segmentWidthInFeet = segments[i].width;
    var segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    console.log("Type: " + segmentType + "; Width: " + segmentWidthInFeet + "ft / " + segmentWidthInMeters + "m");

    var modelWidthInMeters = defaultModelWidthsInMeters[segmentType];
    console.log("Model Default Width: " + modelWidthInMeters + "m");

    // what is "delta" between default width and requested width?
    // default * scale = requested :: scale = requested / default
    // For example: requested width = 2m, but default model width is 1.8. 2 / 1.8 = 1.111111111
    var scaleX = segmentWidthInMeters / modelWidthInMeters * voxelScaleFactor;
    var scaleY = voxelScaleFactor;
    var scaleZ = voxelScaleFactor;
    console.log("Scale: " + scaleX);

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    console.log("Cumulative Street Width: " + cumulativeWidthInMeters + "m");

    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    var positionY = 0;

    // get variantString
    var variantList = segments[i].variantString.split("|");
    console.log(variantList);

    // Note: segment 3d models are outbound by default
    // If segment variant inbound, rotate segment model by 180 degrees
    var rotationY = (variantList[0] == "inbound") ? 180 : 0;

    // the 3d model file name of a segment type is usually identical, let's start with that
    var objectFileName = segments[i].type;

    // there are some cases to look at segment variants in order to find the right model
    // if type && variant2 then use model  ... there's definitely a better way to do this ...
    if (segments[i].type == "drive-lane" && variantList[1] == "sharrow") {objectFileName = "drive-lane-sharrow"};
    if (segments[i].type == "turn-lane" && variantList[1] == "both") {objectFileName = "turn-lane-both"};
    if (segments[i].type == "turn-lane" && variantList[1] == "shared") {objectFileName = "turn-lane-shared"};
    if (segments[i].type == "turn-lane" && variantList[1] == "left") {objectFileName = "turn-lane-left"};
    if (segments[i].type == "turn-lane" && variantList[1] == "left-straight") {objectFileName = "turn-lane-left-straight"};
    if (segments[i].type == "turn-lane" && variantList[1] == "straight") {objectFileName = "turn-lane-straight"};
    if (segments[i].type == "turn-lane" && variantList[1] == "right") {
      objectFileName = "turn-lane-left";
      scaleX = scaleX * (-1);
      scaleY = scaleY * (-1); // this is added otherwise scaleX invert renders the model darker for some reason
      positionY = positionY + 0.1; // this is added because scaleY invert displaces the lane down by 0.1 for some reason
    }
    if (segments[i].type == "turn-lane" && variantList[1] == "right-straight") {
      objectFileName = "turn-lane-left-straight";
      scaleX = scaleX * (-1);
      scaleY = scaleY * (-1); // this is added otherwise scaleX invert renders the model darker for some reason
      positionY = positionY + 0.1; // this is added because scaleY invert displaces the lane down by 0.1 for some reason
    }

    // add new object
    var segmentEl = document.createElement("a-entity");
    segmentEl.setAttribute("scale", scaleX + " " + scaleY + " " + scaleZ);
    segmentEl.setAttribute("position", positionX + " " + positionY + " 0");
    segmentEl.setAttribute("rotation", "0 " + rotationY + " 0")
    segmentEl.setAttribute("obj-model", "obj", "url(assets/segments/" + objectFileName + ".obj)");
    segmentEl.setAttribute("obj-model", "mtl", "#magica-mtl");
    document.getElementById(streetElementId).appendChild(segmentEl);
  };
};

function loadStreet(streetURL) {
  // getjson replacement from http://youmightnotneedjquery.com/#json
  var request = new XMLHttpRequest();
  request.open('GET', streetURL, true);
  request.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      // Connection success
      var streetmixObject = JSON.parse(this.response);
      var streetmixSegments = streetmixObject.data.street.segments;
      processSegments(streetmixSegments, "street");
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

// LOCAL
// var streetURL = 'sample.json';

// REMOTE WITH REDIRECT
var streetURL = 'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr';

// DIRECT TO REMOTE FILE
// var streetURL = 'https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876';

loadStreet(streetURL);
