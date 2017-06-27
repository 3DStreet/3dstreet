

// Each segment "type" is a separate model created in MagicaVoxel.
// These are the intended default widths of the models in meters.
const defaultModelWidthsInMeters = {
  "bike-lane": 1.8,
  "drive-lane": 3,
  "divider": 0.3,
  "parking-lane": 2.4
}

// Normally a MagicaVoxel voxel = 1 meter in A-Frame by default
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
    console.log("Scale: " + scaleX);

    cumulativeWidthInMeters = cumulativeWidthInMeters + segmentWidthInMeters;
    console.log("Cumulative Street Width: " + cumulativeWidthInMeters + "m");

    // add new object
    var segmentEl = document.createElement("a-entity");
    segmentEl.setAttribute("scale", scaleX + " " + voxelScaleFactor + " " + voxelScaleFactor);
    var positionX = cumulativeWidthInMeters - (0.5 * segmentWidthInMeters);
    segmentEl.setAttribute("position", positionX + " 0 0");
    segmentEl.setAttribute("obj-model", "obj", "url(assets/segments/" + segments[i].type + ".obj)");
    // segmentEl.setAttribute("obj-model", "mtl", "url(assets/" + segments[i].type + ".mtl)");
    segmentEl.setAttribute("obj-model", "mtl", "url(assets/segments/magica.mtl)");
    document.getElementById(streetElementId).appendChild(segmentEl);
  };
};

// getjson replacement from http://youmightnotneedjquery.com/#json
var request = new XMLHttpRequest();

// LOCAL
request.open('GET', 'sample.json', true);

// REMOTE WITH REDIRECT
// request.open('GET', 'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr', true);

// DIRECT TO REMOTE FILE
// request.open('GET', 'https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876', true);

request.onload = function() {
  if (this.status >= 200 && this.status < 400) {
    // Connection success
    var streetmixObject = JSON.parse(this.response);
    var streetmixSegments = streetmixObject.data.street.segments;
    processSegments(streetmixSegments, "street");

    // processSegments(streetmixSegments, "street1");
    // processSegments(streetmixSegments, "street2");
    // processSegments(streetmixSegments, "street3");
    // processSegments(streetmixSegments, "street4");
    // processSegments(streetmixSegments, "street5");
    // processSegments(streetmixSegments, "street6");

    // processSegments(streetmixSegments, "street-1");
    // processSegments(streetmixSegments, "street-2");
    // processSegments(streetmixSegments, "street-3");
    // processSegments(streetmixSegments, "street-4");

    // Use JavaScript to repeat the street METHOD ONE
    var streetEl = document.getElementById("street");

    streetEl.flushToDOM(true);

    // Copy the element and its child nodes
    var streetElCopy = streetEl.cloneNode(true);
    streetElCopy.id = "street-clone";
    streetElCopy.setAttribute("position", "0 0 -12.5");
    document.getElementById("streets").appendChild(streetElCopy);

    // Use JavaScript to repeat the street METHOD TWO
    // var streetEl = document.getElementById("street");
    // streetEl.flushToDOM();
    // document.getElementById("street2").innerHTML = streetEl.innerHTML;
    // // document.getElementById("streets").appendChild(streetElCopy);

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
