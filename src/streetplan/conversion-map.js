// conversion map StreetPan -> Streetmix sidewalk segment types mapping
/*
StreetPlanType1:
 {
	StreetPlanSubtype: <String> StreetmixType,
	--- or ---
	StreetPlanSubtype: <Object> {
		"tag": StreetPlanTag,
		"type": StreetmixType,
		"variantString": Streetmix VariantString, can be formed based on other Streetplan parameters
		(Name or Tag) or be constant, like: 'sidewalk',

		"variantStringAdd": get parameter values from this list and generate variantString.
		Often variantString looks like this: 'outbound|regular|road' - example for bike-path.
		variantStringAdd will be: 'direction|material|variantString',

		"nameToVariantMap": mapping rule StreetPlan O1-Name -> VariantString,
		"tagToVariantMap": mapping rule StreetPlan O1-Tags -> VariantString,
		"names": names (StreetPlan O1-Name) for this Streetmix Segment type
		},
	--- or ---
	// for one (O1-Tags) there can be different streetmix segment types,
	// which are determined by the name (O1-Name)
	StreetPlanSubtype: <Array> [
		different options of tags (O1-Tags) and streetMix data for each
	]
 }
*/
const mapping = {
  Setback: {
    '': { type: 'sidewalk', variantString: 'empty' },
    Trees: { type: 'sidewalk-tree', variantString: 'big' },
    tree: { type: 'divider', variantString: 'palm-tree' },
    Benchs: { type: 'sidewalk-bench', variantStringAdd: 'side' }
  },
  Walkways: {
    '': { type: 'sidewalk', variantString: 'empty' },
    Trees: { type: 'sidewalk-tree', variantString: 'big' },
    pedestrian: { type: 'sidewalk', variantString: 'dense' },
    Benchs: { type: 'sidewalk-bench', variantStringAdd: 'side' },
    Tables: { type: 'outdoor-dining', variantString: 'occupied|sidewalk' }
  },
  Furniture: {
    '': { type: 'sidewalk', variantString: 'empty' },
    Trees: { type: 'sidewalk-tree', variantString: 'big' },
    season_tree: { type: 'sidewalk-tree', variantString: 'big' },
    Shelters: {
      type: 'transit-shelter',
      variantString: 'street-level',
      variantStringAdd: 'side|variantString'
    },
    Pedestrian: { type: 'sidewalk', variantString: 'dense' }
  },
  Curbside: {
    '': { type: 'sidewalk', variantString: 'empty' },
    Lights: {
      type: 'sidewalk-lamp',
      tagToVariantMap: {
        'Historic Lights': 'traditional',
        'Regular Lights': 'modern'
      },
      variantStringAdd: 'side|variantString'
    },
    Poles: { type: 'utilities', variantStringAdd: 'side' },
    BikeRacks: {
      type: 'sidewalk-bike-rack',
      nameToVariantMap: {
        'Sideview Modern': 'sidewalk-parallel',
        Sideview: 'sidewalk-parallel',
        'NYC Bike Rack': 'sidewalk'
      },
      variantStringAdd: 'side|variantString'
    }
  },
  BikesPaths: {
    '': { type: 'bike-lane', variantString: 'sidewalk' },
    Bikes: {
      type: 'bike-lane',
      variantString: 'sidewalk',
      variantStringAdd: 'direction|material|variantString'
    }
  },
  Gutter: {
    '': { type: 'divider', variantString: 'median' },
    Gutter: { type: 'divider', variantString: 'median' }
  },
  Transit: {
    '': {
      tag: 'Bus Vehicles',
      type: 'bus-lane',
      variantString: 'typical',
      variantStringAdd: 'direction|material|variantString'
    },
    Transit: [
      {
        tag: 'Rail Vehicles',
        type: 'streetcar',
        names: [
          'StreetCar Yellow',
          'StreetCar Blue',
          'StreetCar Red 1',
          'StreetCar Red 2'
        ],
        variantStringAdd: 'direction|material'
      },
      {
        tag: 'Rail Vehicles',
        type: 'light-rail',
        names: ['UTA LightRail'],
        variantStringAdd: 'direction|material'
      },
      // there are only reversed light rail vehicles in Streetplan
      {
        tag: 'Rail Vehicles Reversed',
        type: 'light-rail',
        variantStringAdd: 'direction|material'
      },
      {
        tag: 'Bus Vehicles',
        type: 'bus-lane',
        variantString: 'typical',
        variantStringAdd: 'direction|material|variantString'
      }
    ]
  },
  Cars: {
    '': {
      type: 'drive-lane',
      variantString: 'car',
      variantStringAdd: 'direction|variantString'
    },
    Autos: {
      type: 'drive-lane',
      variantString: 'car',
      variantStringAdd: 'direction|variantString'
    },
    Truck: {
      type: 'drive-lane',
      variantString: 'truck',
      variantStringAdd: 'direction|variantString'
    }
  },
  Parking: {
    '': {
      tag: 'Parking - Parallel',
      type: 'parking-lane',
      variantStringAdd: 'direction|side'
    },
    Parallel: {
      tag: 'Parking - Parallel',
      type: 'parking-lane',
      variantStringAdd: 'direction|side'
    },
    AngleNormal: {
      tag: 'Parking - Angle',
      type: 'parking-lane',
      nameToVariantMap: {
        'Away, L. Park, Head In': 'angled-rear-left',
        'Toward, R. Park, Head In': 'angled-front-right',
        'Toward, L. Park, Head In': 'angled-front-left',
        'Away, R. Park, Head In': 'angled-rear-right'
      },
      variantStringAdd: 'side'
    },
    Perpendicular: {
      type: 'parking-lane',
      variantString: 'sideways',
      variantStringAdd: 'variantString|side'
    }
  },
  Buffers: {
    '': { type: 'divider', variantString: 'median' },
    Trees: { type: 'divider', variantString: 'big-tree' },
    tree: { type: 'divider', variantString: 'palm-tree' },
    season_tree: { type: 'divider', variantString: 'big-tree' },
    median: { type: 'divider', variantString: 'planting-strip' },
    planter: { type: 'divider', variantString: 'planting-strip' }
  }
};
// copy repeating rules
mapping['Buffers']['AngleNormal'] = mapping['Parking']['AngleNormal'];
mapping['Buffers']['Autos'] = mapping['Cars']['Autos'];
mapping['Buffers']['Purpendicular'] = mapping['Parking']['Perpendicular'];
mapping['Median/Buffer'] = mapping['Buffers'];
mapping['Setback']['tree'] = mapping['Buffers']['tree'];
mapping['Setback']['Trees'] = mapping['Buffers']['Trees'];
mapping['Setback']['season_tree'] = mapping['Buffers']['season_tree'];
// fix for typo Purpendicular
mapping['Parking']['Purpendicular'] = mapping['Parking']['Perpendicular'];
mapping['Setback']['Purpendicular'] = mapping['Parking']['Perpendicular'];
mapping['Setback']['AngleNormal'] = mapping['Parking']['AngleNormal'];
mapping['Setback']['planter'] = mapping['Buffers']['planter'];
mapping['Setback']['BikeRacks'] = mapping['Curbside']['BikeRacks'];
mapping['Setback']['Tables'] = mapping['Walkways']['Tables'];
mapping['Setback']['Poles'] = mapping['Curbside']['Poles'];

mapping['Curbside']['Shelters'] = mapping['Furniture']['Shelters'];
mapping['Curbside']['Benchs'] = mapping['Walkways']['Benchs'];

mapping['Furniture']['planter'] = mapping['Buffers']['planter'];
mapping['Furniture']['Benchs'] = mapping['Walkways']['Benchs'];
mapping['Furniture']['BikeRacks'] = mapping['Curbside']['BikeRacks'];
mapping['Furniture']['Tables'] = mapping['Walkways']['Tables'];

const directionMap = {
  Coming: 'inbound',
  Going: 'outbound',
  // make default outbound direction for both variant
  Both: 'both',
  NA: ''
};

const materialMap = {
  'Asphalt Black': 'regular',
  'Asphalt Blue': 'blue',
  'Asphalt Red 1': 'red',
  'Asphalt Red 2': 'red',
  'Asphalt Green': 'green',
  'Asphalt Old': 'regular',
  Grass: 'grass',
  'Grass Dead': 'grass'
};

// StreetMix variantString often has additional parameters via |, for example: taxi|outbound|right
// generate a streetMix like variantString from the listed parameters in variantStringAdd
function generateVariantString(variantStringKeys, streetmixData) {
  const variantString = variantStringKeys
    .split('|')
    .map((currKey) => streetmixData[currKey])
    .join('|');
  return variantString;
}

function getDataFromSubtypeMap(convertRule, streetmixData, streetplanData) {
  if (typeof convertRule === 'string') {
    // convertRule is a Streetmix type.
    // Later will add another options for this case
    streetmixData['type'] = convertRule;
  } else if (Array.isArray(convertRule)) {
    // in this case, different segment subtype options
    // are associated with the different Streetmix types

    // find the desired Streetmix segment data from the array by Streetplan tag and names(?)
    const variantData = convertRule.find((element) => {
      const tagValMatches = element['tag'] === streetplanData['O1-Tags'];
      if (tagValMatches && element['names']) {
        return element['names'].includes(streetplanData['O1-Name']);
      }
      return tagValMatches;
    });

    streetmixData['variantString'] = '';

    const variantString = variantData['variantString'];
    if (variantString && typeof variantString === 'string') {
      streetmixData['variantString'] = variantString;
    }

    // generate a streetMix like variantString from the listed parameter values
    streetmixData['type'] = variantData['type'];
    const variantStringKeys = variantData['variantStringAdd'];
    if (variantStringKeys) {
      streetmixData['variantString'] = generateVariantString(
        variantStringKeys,
        streetmixData
      );
    }
  } else if (typeof convertRule === 'object') {
    // in this case, different variants of the segment subtype
    // are associated with different variantString of the Streetmix segment

    streetmixData['type'] = convertRule['type'];
    streetmixData['variantString'] = '';

    const variantString = convertRule['variantString'];
    if (variantString && typeof variantString === 'string') {
      streetmixData['variantString'] = variantString;
    }

    // get variantString from {"O1-Name" (StreetPlan Object Name) : variantString} mapping data
    const nameToVariantMap = convertRule['nameToVariantMap'];
    if (nameToVariantMap && nameToVariantMap[streetplanData['O1-Name']]) {
      streetmixData['variantString'] =
        nameToVariantMap[streetplanData['O1-Name']];
    }

    // get variantString from {"O1-Tags" (StreetPlan Tag) : variantString} mapping data
    const tagToVariantMap = convertRule['tagToVariantMap'];
    if (tagToVariantMap && tagToVariantMap[streetplanData['O1-Tags']]) {
      streetmixData['variantString'] =
        tagToVariantMap[streetplanData['O1-Tags']];
    }

    // generate a streetMix like variantString from the listed parameter values
    const variantStringKeys = convertRule['variantStringAdd'];
    if (variantStringKeys) {
      streetmixData['variantString'] = generateVariantString(
        variantStringKeys,
        streetmixData
      );
    }
  }

  return streetmixData;
}

// convert streetPlan segment data to Streetmix segment data
function convertSegment(data) {
  let streetmixData = {};
  const streetplanType = data['Type'];
  const streetplanSubtype = data['Subtype'];
  // mapping rule for current Streetplan subtypes
  const subtypeMap = mapping[streetplanType];

  // convert elevation value to Streetmix format: 0, 1, 2
  streetmixData['elevation'] = data['MaterialH'] / 0.5;
  streetmixData['width'] = data['width'];
  streetmixData['direction'] = directionMap[data['Direction']];
  if (data['side']) {
    streetmixData['side'] = data['side'];
  }
  if (data['Material']) {
    streetmixData['material'] = materialMap[data['Material']];
  }

  if (subtypeMap) {
    const convertRule = subtypeMap[streetplanSubtype];
    if (convertRule) {
      streetmixData = getDataFromSubtypeMap(convertRule, streetmixData, data);
    } else {
      streetmixData['type'] = streetplanType;
      // STREET.notify.warningMessage(`The '${streetplanSubtype}' subtype of StreetPlan segment '${segmentType}' is not yet supported in 3DStreet`);
      console.log(
        `The '${streetplanSubtype}' subtype of StreetPlan segment '${streetplanType}' is not yet supported in 3DStreet`
      );
    }
  } else {
    streetmixData['type'] = streetplanType;
    // STREET.notify.warningMessage(`The '${streetplanType}' StreetPlan segment type is not yet supported in 3DStreet`);
    console.log(
      `The '${streetplanType}' StreetPlan segment type is not yet supported in 3DStreet`
    );
  }
  return streetmixData;
}

module.exports.convertSegment = convertSegment;
