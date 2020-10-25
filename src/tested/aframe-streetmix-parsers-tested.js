function isSidewalk (string) { // eslint-disable-line no-unused-vars
  // https://streetmix.net/api/v1/streets/3f1a9810-0a8f-11ea-adff-7fe273b63f1d
  //  return if string sidewalk* or "scooter-drop-zone", bikeshare, flex-zone-curb, transit-shelter
  const sidewalkList = ['scooter-drop-zone', 'bikeshare', 'flex-zone-curb', 'transit-shelter'];
  return string.startsWith('sidewalk') || sidewalkList.includes(string);
}

// generate a JSON array representing buildings
// test createBuildingsArray(maxLength = 5) returns [{ tag: 'a-entity', mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0' }]
// test createBuildingsArray(maxLength = 10) returns [{ mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" }, {mixin: "SM3D_Bld_Mixed_Double_5fl", position: "0 0 5", tag: "a-entity"} ]
function createBuildingsArray (maxLength = 150, buildingType = 'narrow') { // eslint-disable-line no-unused-vars
  var buildings, psuedoRandom;
  if (buildingType === 'narrow' || buildingType === 'wide') {
    buildings = [
      { id: 'SM3D_Bld_Mixed_4fl', width: 5.25221 },
      { id: 'SM3D_Bld_Mixed_Double_5fl', width: 10.9041 },
      { id: 'SM3D_Bld_Mixed_4fl_2', width: 5.58889 },
      { id: 'SM3D_Bld_Mixed_5fl', width: 6.47593 },
      { id: 'SM3D_Bld_Mixed_Corner_4fl', width: 6.94809 }
    ];
    psuedoRandom = '41431323432402434130303230234102402341'; // 38 psuedorandom numbers 0-4, no identical units side-by-side
  } else if (buildingType === 'residential') {
    buildings = [
      { id: 'SM_Bld_House_Preset_03_1800', width: 20 },
      { id: 'SM_Bld_House_Preset_08_1809', width: 20 },
      { id: 'SM_Bld_House_Preset_09_1845', width: 20 }
    ];
    psuedoRandom = '12021201210101212021201012012021201210'; // 38 psuedorandom numbers 0-2, no identical units side-by-side
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
    buildingsArray.push(buildingEntity);

    length += building.width;
    i++;
  }

  return buildingsArray;
}

// for an array of objects representing HTML, remove entities except those that match the mixinId specified
function filterBuildingsArrayByMixin (buildingsArray, mixinId) { // eslint-disable-line no-unused-vars
  var filteredBuildingsArray = [];
  buildingsArray.forEach((currentEntity, index) => {
    if (currentEntity.mixin === mixinId) {
      filteredBuildingsArray.push(currentEntity);
    }
  });
  return filteredBuildingsArray;
}

// for an array of objects representing HTML, for each object remove the property matching the passed string `key`
function removePropertyFromArray (htmlArray, key) { // eslint-disable-line no-unused-vars
  htmlArray.forEach((currentEntity, index) => {
    delete currentEntity[key];
  });
  return htmlArray;
}

function createClonedEntitiesArray ({ mixin = '', step = 15, radius = 60, rotation = '0 0 0', positionXYString = '0 0', randomY = false }) { // eslint-disable-line no-unused-vars
  var clonedEntitiesArray = [];

  for (var j = (radius * -1); j <= radius; j = j + step) {
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

// TODO: rename to createAmbientSoundsArray
function getAmbientSoundJSON (buildingsArray) { // eslint-disable-line no-unused-vars
  const ambientSounds = {
    fence: 'assets/audio/AMB_Suburbs_Afternoon_Woods_Spring_Small_ST_MKH8050-30shortened_amplified.mp3',
    grass: 'assets/audio/AMB_Suburbs_Afternoon_Woods_Spring_Small_ST_MKH8050-30shortened_amplified.mp3',
    'parking-lot': 'assets/audio/Parking_lot_ambience_looping.mp3',
    waterfront: 'assets/audio/combined_UKdock4_and_water_pier_underneath_ambience.mp3',
    residential: 'assets/audio/AMB_Suburbs_Spring_Day_Lawnmowers_Birds_MS_ST_MKH8050-30shortened.mp3',
    narrow: 'assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3',
    wide: 'assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3'
  };

  var soundsArray = [];
  var prevURL = null;
  buildingsArray.forEach((currentValue, index) => {
    // <a-entity class="playme" sound="src: #ambientmp3; positional: false; loop: true;"></a-entity>
    if (prevURL && (prevURL === ambientSounds[currentValue])) { return; }
    var soundEntity = {
      tag: 'a-entity',
      class: 'playme',
      sound: 'src: url(' + ambientSounds[currentValue] + '); positional: false; loop: true'
    };
    soundsArray.push(soundEntity);
    prevURL = ambientSounds[currentValue];
  });
  return soundsArray;
}

// possible input values: grass, fence, narrow, wide, waterfront, residential, parking-lot
function createGroundArray (buildingString) { // eslint-disable-line no-unused-vars
  var groundArray = [];
  var mixin = 'ground-grass'; // default output is grass ground type

  if (buildingString === 'waterfront') { return groundArray; }
  if (['narrow', 'wide'].includes(buildingString)) { mixin = 'ground-asphalt'; }
  if (buildingString === 'parking-lot') { mixin = 'ground-parking-lot'; }

  var groundEntity = {
    tag: 'a-entity',
    position: '0 -0.2 0',
    mixin: mixin
  };
  groundArray.push(groundEntity);

  return groundArray;
}
