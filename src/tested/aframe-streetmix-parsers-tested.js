function isSidewalk(string) {
  // eslint-disable-line no-unused-vars
  // https://streetmix.net/api/v1/streets/3f1a9810-0a8f-11ea-adff-7fe273b63f1d
  //  return if string sidewalk* or "scooter-drop-zone", bikeshare, flex-zone-curb, transit-shelter
  const sidewalkList = [
    'utilities',
    'scooter-drop-zone',
    'bikeshare',
    'flex-zone-curb',
    'transit-shelter',
    'brt-station',
    'street-vendor'
  ];
  return string.startsWith('sidewalk') || sidewalkList.includes(string);
}
module.exports.isSidewalk = isSidewalk;

// generate a JSON array representing buildings
// test createBuildingsArray(maxLength = 5) returns [{ tag: 'a-entity', mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0' }]
// test createBuildingsArray(maxLength = 10) returns [{ mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" }, {mixin: "SM3D_Bld_Mixed_Double_5fl", position: "0 0 5", tag: "a-entity"} ]
function createBuildingsArray(maxLength = 150, buildingType = 'narrow') {
  // eslint-disable-line no-unused-vars
  var buildings, psuedoRandom;
  if (buildingType === 'narrow' || buildingType === 'wide') {
    buildings = [
      { id: 'SM3D_Bld_Mixed_4fl', width: 5.251 },
      { id: 'SM3D_Bld_Mixed_Double_5fl', width: 10.9041 },
      { id: 'SM3D_Bld_Mixed_4fl_2', width: 5.309 },
      { id: 'SM3D_Bld_Mixed_5fl', width: 5.903 },
      { id: 'SM3D_Bld_Mixed_Corner_4fl', width: 5.644 }
    ];
    psuedoRandom = '41431323432402434130303230234102402341'; // 38 psuedorandom numbers 0-4, no identical units side-by-side
  } else if (buildingType === 'residential') {
    buildings = [
      { id: 'SM_Bld_House_Preset_03_1800', width: 20 },
      { id: 'SM_Bld_House_Preset_08_1809', width: 20 },
      { id: 'SM_Bld_House_Preset_09_1845', width: 20 }
    ];
    psuedoRandom = '12021201210101212021201012012021201210'; // 38 psuedorandom numbers 0-2, no identical units side-by-side
  } else if (buildingType === 'arcade') {
    buildings = [
      { id: 'arched-building-01', width: 9.191 },
      { id: 'arched-building-02', width: 11.19 },
      { id: 'arched-building-03', width: 13.191 },
      { id: 'arched-building-04', width: 15.191 }
    ];
    psuedoRandom = '03120223130210321203123023103201232013'; // 38 psuedorandom numbers 0-3, no identical units side-by-side
  } else {
    return [];
  }

  var i = 0;
  var length = 0;
  var buildingsArray = [];

  while (length < maxLength) {
    // get a building using the psuedo random number
    var building = buildings[parseInt(psuedoRandom[i])];
    var buildingEntity = {
      tag: 'a-entity',
      mixin: building.id,
      position: '' + (length + building.width / 2) + ' 0 0'
    };

    if (buildingEntity.mixin === 'SM_Bld_House_Preset_08_1809') {
      buildingEntity.child = {
        tag: 'a-plane',
        class: 'driveway',
        material: 'roughness:0.8',
        position: '-6.25 0.6 -8.75',
        rotation: '-90 0 0',
        src: '#asphalt-texture',
        width: 4,
        height: 4.6
      };
    }

    if (buildingEntity.mixin === 'SM_Bld_House_Preset_09_1845') {
      buildingEntity.child = {
        tag: 'a-plane',
        class: 'driveway',
        material: 'roughness:0.8',
        position: '-2.5 0.6 -7',
        rotation: '-90 0 0',
        src: '#asphalt-texture',
        width: 4,
        height: 8
      };
    }
    if (building.width + length <= maxLength) {
      buildingsArray.push(buildingEntity);
    }

    length += building.width;
    i++;
  }

  return buildingsArray;
}
module.exports.createBuildingsArray = createBuildingsArray;

// for an array of objects representing HTML, remove entities except those that match the mixinId specified
function filterBuildingsArrayByMixin(buildingsArray, mixinId) {
  // eslint-disable-line no-unused-vars
  var filteredBuildingsArray = [];
  buildingsArray.forEach((currentEntity, index) => {
    if (currentEntity.mixin === mixinId) {
      filteredBuildingsArray.push(currentEntity);
    }
  });
  return filteredBuildingsArray;
}
module.exports.filterBuildingsArrayByMixin = filterBuildingsArrayByMixin;

// for an array of objects representing HTML, for each object remove the property matching the passed string `key`
function removePropertyFromArray(htmlArray, key) {
  // eslint-disable-line no-unused-vars
  htmlArray.forEach((currentEntity, index) => {
    delete currentEntity[key];
  });
  return htmlArray;
}
module.exports.removePropertyFromArray = removePropertyFromArray;

function createClonedEntitiesArray({
  mixin = '',
  step = 15,
  radius = 60,
  rotation = '0 0 0',
  positionXYString = '0 0',
  randomY = false
}) {
  // eslint-disable-line no-unused-vars
  var clonedEntitiesArray = [];

  for (var j = radius * -1; j <= radius; j = j + step) {
    var clonedEntity = {
      tag: 'a-entity',
      position: positionXYString + ' ' + j
    };

    if (mixin) {
      clonedEntity.class = mixin;
      clonedEntity.mixin = mixin;
    }

    if (randomY) {
      clonedEntity.rotation = '0 ' + Math.floor(randomTestable() * 361) + ' 0'; // eslint-disable-line no-undef
    } else {
      clonedEntity.rotation = rotation;
    }

    clonedEntitiesArray.push(clonedEntity);
  }

  return clonedEntitiesArray;
}
module.exports.createClonedEntitiesArray = createClonedEntitiesArray;

// TODO: rename to createAmbientSoundsArray
function getAmbientSoundJSON(buildingsArray) {
  // eslint-disable-line no-unused-vars
  const ambientSounds = {
    fence: '#suburbs-mp3',
    grass: '#suburbs-mp3',
    'parking-lot': '#parking-lot-mp3',
    waterfront: '#waterfront',
    residential: '#suburbs2-mp3',
    narrow: '#ambientmp3',
    wide: '#ambientmp3'
  };

  var soundsArray = [];
  var prevURL = null;
  buildingsArray.forEach((currentValue, index) => {
    // <a-entity class="playme" sound="src: #ambientmp3; positional: false; loop: true;"></a-entity>
    if (prevURL && prevURL === ambientSounds[currentValue]) {
      return;
    }
    var soundEntity = {
      tag: 'a-entity',
      class: 'playme',
      sound:
        'src: ' +
        ambientSounds[currentValue] +
        '; positional: false; loop: true'
    };
    soundsArray.push(soundEntity);
    prevURL = ambientSounds[currentValue];
  });
  return soundsArray;
}
module.exports.getAmbientSoundJSON = getAmbientSoundJSON;
