

// Each segment "type" is a separate model created in MagicaVoxel.
// These are the intended default widths of the models in meters.
const defaultModelWidthsInMeters = {
  "bike-lane": 1.8,
  "drive-lane": 3,
  "divider": 0.3,
  "parking-lane": 2.4
}

// Normally a MagicaVoxel voxel = 1 meter in A-Frame by default, however for this project each voxel represents 1 decimeter (1/10th of a meter).
// We need to reduce the size of the model (scale * 0.1) to compensate.
const voxelScaleFactor = 0.1;

function processSegments(segments) {
  var cumulativeWidthInMeters = 0;
  for (var i = 0; i < segments.length; i++) {

    var segmentType = segments[i].type;
    var segmentWidthInFeet = segments[i].width;
    var segmentWidthInMeters = segmentWidthInFeet * 0.3048;
    console.log("Type: " + segmentType + "; Width: " + segmentWidthInFeet + "ft / " + segmentWidthInMeters + "m");

    var modelWidthInMeters = defaultModelWidthsInMeters[segmentType];
    console.log("Model Default Width: " + modelWidthInMeters + "m");

    // what is "delta" between default width and requested width?
    // For example: requested width = 2m, but default model width is 1.8. 2 / 1.8 = 1.111111111
    // default * scale = requested :: scale = requested / default
    var scale = segmentWidthInMeters / modelWidthInMeters * voxelScaleFactor;
    console.log("Scale: " + scale + "m");

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    console.log("Cumulative Street Width: " + cumulativeWidthInMeters + "m");

    // add new object
    var segmentEl = document.createElement("a-entity");
    segmentEl.setAttribute("scale", scale + " " + voxelScaleFactor + " " + voxelScaleFactor);


    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    segmentEl.setAttribute("position", positionX + " 0 0");
    segmentEl.setAttribute("obj-model", "obj", "url(assets/" + segments[i].type + ".obj)");
    segmentEl.setAttribute("obj-model", "mtl", "url(assets/" + segments[i].type + ".mtl)");
    document.getElementById("street").appendChild(segmentEl);
  };
};

// getjson replacement from http://youmightnotneedjquery.com/#json
var request = new XMLHttpRequest();

// LOCAL
// request.open('GET', 'sample.json', true);

// REMOTE WITH REDIRECT - CAUSES CORS ERROR
// request.open('GET', 'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr', true);

// DIRECT TO REMOTE FILE
request.open('GET', 'https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876', true);

request.onload = function() {
  if (this.status >= 200 && this.status < 400) {
    // Connection success
    var streetmixObject = JSON.parse(this.response);
    var streetmixSegments = streetmixObject.data.street.segments;
    processSegments(streetmixSegments);
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
