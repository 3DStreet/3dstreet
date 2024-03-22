// conversion map StreetPan -> Streetmix
// sidewalk segment types mapping
/*
StreetPlanType1:
 {
	StreetPlanSubtype: StreetmixType,
	--- or ---
	StreetPlanSubtype: {
		"tag": StreetPlanTag, 
		"type": StreetmixType, 
		"variantString": StreetmixVariantString,
		"variantStringAdd": get parameter values from this list and generate variantString,
		"nameToVariantMap": mapping rule StreetPlan O1-Name -> VariantString
		"names": names (StreetPlan O1-Name) for this Streetmix Segment type
		},
	--- or ---
	// for one (O1-Tags) there can be different streetmix segment types, 
	// which are determined by the name (O1-Name)
	StreetPlanSubtype: [
		different options of tags (O1-Tags) and streetMix data for each
	]
 }
*/
const mapping = {
	"Walkways": {
		"Trees": "sidewalk-tree",
		"pedestrian": "sidewalk",
		"Benchs": "sidewalk-bench",
		"Tables": "outdoor-dining"
	},
	"Furniture": {
		"Trees": "sidewalk-tree",
		"season_tree": "sidewalk-tree",
		"Shelters": "transit-shelter",
		"planter": {"type": "divider", "variantString": "planting-strip"},
		"Pedestrian": "sidewalk",
		"Benchs": "sidewalk-bench",
		"Tables": "outdoor-dining",
		"BikeRacks": "sidewalk-bike-rack"
	},
	"Curbside": {
		"Lights": "sidewalk-lamp",
		"Shelters": "transit-shelter",
		"Poles": "utilities",
		"Benchs": "sidewalk-bench",
		"BikeRacks": "sidewalk-bike-rack"
	},
	"BikesPaths": {
		"Bikes": "bike-lane"
	},
	"Gutter": {
		"Gutter": "temporary"
	},
	"Transit": {
		"Transit": [
			{ "tag": "Rail Vehicles", "type": "streetcar", "names": 
				["StreetCar Yellow", "StreetCar Blue", "StreetCar Red 1", "StreetCar Red 2"], 
				"variantStringAdd": "direction" },
			{ "tag": "Rail Vehicles", "type": "light-rail", "names": ["UTA LightRail"], "variantStringAdd": "direction" }, 
			// there are only reversed light rail vehicles in Streetplan
			{ "tag": "Rail Vehicles Reversed", "type": "light-rail", "variantStringAdd": "direction" }, 
			{ "tag": "Bus Vehicles", "type": "bus-lane", "variantStringAdd": "direction" }
		]
	},
	"Cars": {
		"Autos": {"type": "drive-lane", "variantString": "car"},
		"Truck": {"type": "drive-lane", "variantString": "truck"}
	},
	"Parking": {
		"Parallel": 
			{"tag": "Parking - Parallel", "type": "parking-lane", "variantStringAdd": "direction|side"}
		,
		"AngleNormal": 
			{"tag": "Parking - Angle", "type": "parking-lane", "nameToVariantMap": {
				"Away, L. Park, Head In": "angled-rear-left",
				"Toward, R. Park, Head In": "angled-front-right",
				"Toward, L. Park, Head In": "angled-front-left",
				"Away, R. Park, Head In": "angled-rear-right"
				},
				"variantStringAdd": "side"
			}
	},
	"Buffers": {
		"Trees": {"type": "divider", "variantString": "big-tree"},
		"tree": {"type": "divider", "variantString": "palm-tree"},
		"season_tree": {"type": "divider", "variantString": "big-tree"},
		"median": {"type": "divider", "variantString": "planting-strip"},
		"Autos": {"type": "drive-lane", "variantString": "car"},
		"AngleNormal": {},
		"Purpendicular": {"type": "parking-lane", "variantString": "sideways", "variantStringAdd": "side"},
		"planter": {"type": "divider", "variantString": "planting-strip"}
	}
}
// copy repeating rules
mapping["Buffers"]["AngleNormal"] = mapping["Parking"]["AngleNormal"];
mapping["Median/Buffer"] = mapping["Buffers"];

const directionMap = {
	"Coming": "inbound",
	"Going": "outbound",
	// make default outbound direction for both variant
	"Both": "both",
	"NA": ""
}


// StreetMix variantString often has additional parameters via |, for example: taxi|outbound|right
// generate a streetMix variantString from the listed parameters in variantStringAdd
function generateVariantString(variantStringKeys, streetmixData) {

	return streetmixData['variantString'] += variantStringKeys.split('|').reduce(
		(wholeString, currKey) => wholeString += streetmixData[currKey]
	, '');
}

function getDataFromSubtypeMap(convertRule, streetmixData, streetplanData) {
	if (typeof convertRule === 'string') {
		// convertRule is a Streetmix type. 
		// Later will add another options for this case
		streetmixData['type'] = convertRule;
	} else if (Array.isArray(convertRule)) {
		// in this case, different segment subtype options 
		// are associated with the different Streetmix types
		// find Streetmix segment data by Streetplan tag and names(?)
		const variantData = convertRule.find((element) => {
			const tagValMatches = element['tag'] === streetplanData['O1-Tags'];
			if (tagValMatches && element['names']) {
				return element['names'].includes(streetplanData['O1-Name']);
			}
			return tagValMatches;
		});
		streetmixData['type'] = variantData['type'];
		const variantStringKeys = variantData['variantStringAdd'];
		if (variantStringKeys) {
			streetmixData['variantString'] += generateVariantString(variantStringKeys, streetmixData);
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

		// get variantString from "O1-Name" (StreetPlan Object Name) -> variantString mapping data
		const nameToVariantMap = convertRule['nameToVariantMap'];
		if (nameToVariantMap && nameToVariantMap[streetplanData['O1-Name']]) {
			streetmixData['variantString'] = nameToVariantMap[streetplanData['O1-Name']];
		}

		if (convertRule['variantStringAdd']) {
			streetmixData['variantString'] += generateVariantString(convertRule['variantStringAdd'], streetmixData);
		}
	}

	return streetmixData;
}

// convert streetPlan segment data to Streetmix segment data
function convertSegment(data) {
	let streetmixData = {};
	// streetmix variantString
	let variantString = '';
	const streetplanType = data['Type'];
	const streetplanSubtype = data['Subtype'];
	// mapping rule for current Streetplan subtypes
	const subtypeMap = mapping[streetplanType];

	// convert elevation value to Streetmix format: 0, 1, 2
	streetmixData['elevation'] = data["MaterialH"] / 0.5;
	streetmixData['width'] = data['width'];
	streetmixData['direction'] = directionMap[data['Direction']];
	if (data['side']) {
		streetmixData['side'] = data['side'];
	}

	if (subtypeMap) {
		const convertRule = subtypeMap[streetplanSubtype];
		if (convertRule) {
			streetmixData = getDataFromSubtypeMap(convertRule, streetmixData, data);
		} else {
			streetmixData['type'] = streetplanType;
		    //STREET.notify.warningMessage(`The '${streetplanSubtype}' subtype of StreetPlan segment '${segmentType}' is not yet supported in 3DStreet`);
		    console.log(`The '${streetplanSubtype}' subtype of StreetPlan segment '${streetplanType}' is not yet supported in 3DStreet`);
		}
	} else {
		streetmixData['type'] = streetplanType;
	    //STREET.notify.warningMessage(`The '${streetplanType}' StreetPlan segment type is not yet supported in 3DStreet`);
	    console.log(`The '${streetplanType}' StreetPlan segment type is not yet supported in 3DStreet`);
	}
	return streetmixData;
}

module.exports.convertSegment = convertSegment;
