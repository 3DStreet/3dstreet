function isSidewalk (string) { // eslint-disable-line no-unused-vars
  // https://streetmix.net/api/v1/streets/3f1a9810-0a8f-11ea-adff-7fe273b63f1d
  //  return if string sidewalk* or "scooter-drop-zone", bikeshare, flex-zone-curb, transit-shelter
  const sidewalkList = ['scooter-drop-zone', 'bikeshare', 'flex-zone-curb', 'transit-shelter'];
  return string.startsWith('sidewalk') || sidewalkList.includes(string);
}

// generate a JSON array representing buildings
// test createBuildingsArray(maxLength = 5) returns [{ tag: 'a-entity', mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0' }]
// test createBuildingsArray(maxLength = 10) returns [{ mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" }, {mixin: "SM3D_Bld_Mixed_Double_5fl", position: "0 0 5", tag: "a-entity"} ]
function createBuildingsArray (maxLength = 150) { // eslint-disable-line no-unused-vars
  const buildings = [
    { id: 'SM3D_Bld_Mixed_4fl', width: 5 },
    { id: 'SM3D_Bld_Mixed_Double_5fl', width: 10 },
    { id: 'SM3D_Bld_Mixed_4fl_2', width: 5 },
    { id: 'SM3D_Bld_Mixed_5fl', width: 5 },
    { id: 'SM3D_Bld_Mixed_Corner_4fl', width: 5 }
  ];

  // psuedoRandom array of numbers 0-5 for placing buildings
  const psuedoRandom = '41431323432402434130303230234102402341';

  // until row of buildings length is = or > maxLength
  var i = 0;
  var length = 0;
  var buildingsArray = [];

  while (length < maxLength) {
    // get a building using the psuedo random number
    var building = buildings[parseInt(psuedoRandom[i])];
    var buildingEntity = {
      tag: 'a-entity',
      mixin: building.id,
      position: '0 0 ' + length
    };
    buildingsArray.push(buildingEntity);

    length += building.width;
    i++;
  }

  return buildingsArray;
}

// given an object such as { mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" } return an HTML Element with matching attributes
function createElementFromObject (object = {}) { // eslint-disable-line no-unused-vars
  // assumes each object has a "tag" key/value pair TODO: "a-entity" is default tag if none is present
  const el = document.createElement(object.tag);
  delete object.tag;
  for (const [key, value] of Object.entries(object)) {
    el.setAttribute(key, value);
  }
  return el;
}

// return a parent element with children appended from the array of objects
function appendChildElementsFromArray (array = [], parentEl) { // eslint-disable-line no-unused-vars
  // for each object that represents an "a-entity" element to be created
  array.forEach(function (object, index) {
    parentEl.appendChild(createElementFromObject(object));
  });
  return parentEl;
}
