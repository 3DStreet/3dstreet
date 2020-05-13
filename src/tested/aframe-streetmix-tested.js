
function isSidewalk (string) {
    // https://streetmix.net/api/v1/streets/3f1a9810-0a8f-11ea-adff-7fe273b63f1d
  //  return if string sidewalk* or "scooter-drop-zone", bikeshare, flex-zone-curb, transit-shelter
    const sidewalkList = ['scooter-drop-zone', 'bikeshare', 'flex-zone-curb', 'transit-shelter'];
    return string.substring(0, 8) == 'sidewalk' || sidewalkList.includes(string);
  }
  