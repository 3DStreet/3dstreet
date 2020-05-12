
function streetmixUserToAPI (userURL) {
  // this takes in a user facing Streetmix.net URL like https://streetmix.net/kfarr/3/a-frame-city-builder-street-only
  // and turns it into the API redirect URL like https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr
  var pathArray = new URL(userURL).pathname.split('/');
  creatorId = pathArray[1];
  namespacedId = pathArray[2];
  if (creatorId == '-') {
    return 'https://streetmix.net/api/v1/streets?namespacedId=' + namespacedId;
  } else {
    return 'https://streetmix.net/api/v1/streets?namespacedId=' + namespacedId + '&creatorId=' + creatorId;
  }
}
