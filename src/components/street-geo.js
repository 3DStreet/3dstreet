/* global AFRAME, THREE */
const MAPBOX_ACCESS_TOKEN_VALUE = 'pk.eyJ1Ijoia2llcmFuZmFyciIsImEiOiJjazB0NWh2YncwOW9rM25sd2p0YTlxemk2In0.mLl4sNGDFbz_QXk0GIK02Q';
const GOOGLE_API_KEY = 'AIzaSyAQshwLVKTpwTfPJxFEkEzOdP_cgmixTCQ';


AFRAME.registerComponent('street-geo', {
  schema: {
    longitude: { type: 'number', default: 0 },
    latitude: { type: 'number', default: 0 },
    elevation: { type: 'number', default: 0 },
    maps: { type: 'array', default: [] }
  },
  init: function () {
  	/* 
	  	Function names for the given function types must have the following format:
	  	create function: <mapType>Create,
	  	update function: <mapType>Update,
  	*/
    this.mapTypes = ['mapbox2d', 'google3d'];  
    this.elevationHeightConstant = 32.49158;	
  },
  update: function (oldData) {
    const data = this.data;
    const el = this.el;

    const updatedData = AFRAME.utils.diff(oldData, data);

    for (const mapType of this.mapTypes) {
    	// create map function with name: <mapType>Create
    	const createElementFunction = this[mapType + 'Create'].bind(this);
	    // create Map element and save a link to it in this[mapType]
	    if (data.maps.includes(mapType) && !this[mapType]) {
	    	this[mapType] = createElementFunction();
	    } else if (data.maps.includes(mapType) && (updatedData.longitude || updatedData.latitude || updatedData.elevation)) {
	    	// call update map function with name: <mapType>Update
	    	this[mapType + 'Update'].bind(this)();
	    } else if (this[mapType] && !data.maps.includes(mapType)) {
	    	// remove element from DOM and from this object
	    	this.el.removeChild(this[mapType]);
	    	this[mapType] = null;
	    }    	
    }
  },
  mapbox2dCreate: function () {
    const data = this.data;
    const el = this.el;

		const mapbox2dElement = document.createElement('a-entity');
		mapbox2dElement.setAttribute('data-layer-name', 'Mapbox Satellite Streets');
		mapbox2dElement.setAttribute('geometry', 'primitive: plane; width: 512; height: 512;');
		mapbox2dElement.setAttribute('material', 'color: #ffffff; shader: flat; side: both; transparent: true;');
		//mapbox2dElement.setAttribute('position', '-7 -1 -2');
		mapbox2dElement.setAttribute('rotation', '-90 -4.25 0');
		mapbox2dElement.setAttribute('anisotropy', '');
		mapbox2dElement.setAttribute('mapbox', {
				accessToken: MAPBOX_ACCESS_TOKEN_VALUE,
				center: `${data.longitude}, ${data.latitude}`,
				zoom: 15,
				style: 'mapbox://styles/mapbox/satellite-streets-v11',
				pxToWorldRatio: 4
			});
		mapbox2dElement.classList.add('autocreated');
		el.appendChild(mapbox2dElement);
		return mapbox2dElement;    
  },
  google3dCreate: function () {
    const data = this.data;
    const el = this.el;

		const google3dElement = document.createElement('a-entity');
		google3dElement.setAttribute('data-layer-name', 'Google 3D Tiles');
		google3dElement.setAttribute('loader-3dtiles', {
			url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
			long: data.longitude,
			lat: data.latitude,
			height: data.elevation - this.elevationHeightConstant ?? -26,
			googleApiKey: GOOGLE_API_KEY,
			geoTransform: 'WGS84Cartesian',
            maximumSSE: 48,
            maximumMem: 400,
            cameraEl: '#camera'
		});
		google3dElement.classList.add('autocreated');
		el.appendChild(google3dElement);
		return google3dElement;
  },
  google3dUpdate: function () {
  	const data = this.data;
  	this.google3d.setAttribute('loader-3dtiles', {
  		lat: data.latitude, 
  		long: data.longitude,
  		height: data.elevation - this.elevationHeightConstant ?? -26,
  	});
  },
  mapbox2dUpdate: function () {
		const data = this.data;
		this.mapbox2d.setAttribute('mapbox', {
			center: `${data.longitude}, ${data.latitude}`
		});

  },
  removeChildMaps: function () {
    const children = this.el.querySelectorAll('.autocreated');
    children.forEach(child => child.parentNode.removeChild(child));
  }
});
