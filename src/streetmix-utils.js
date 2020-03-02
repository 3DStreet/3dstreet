
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

function openStreetmixURL() {
  var streetURL = document.getElementById("input-url").value;
  window.open(
    streetURL, "_blank");
}

function openJSONURL() {
  var streetURL = document.getElementById("input-url").value;
  window.open(
    streetmixUserToAPI(streetURL), "_blank");
}
