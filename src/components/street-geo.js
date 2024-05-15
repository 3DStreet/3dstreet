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
    const data = this.data;
    const el = this.el;
    
    // create Mapbox 2D
    if (data.maps.includes('mapbox2d')) {
    	const centerValue = `${data.longitude}, ${data.latitude}`;  	

		const mapboxElement = document.createElement('a-entity');
		mapboxElement.setAttribute('data-layer-name', 'Mapbox Satellite Streets');
		mapboxElement.setAttribute('geometry', 'primitive: plane; width: 512; height: 512;');
		mapboxElement.setAttribute('material', 'color: #ffffff; shader: flat; side: both; transparent: true;');
		//mapboxElement.setAttribute('position', '-7 -1 -2');
        mapboxElement.setAttribute('rotation', '-90 -4.25 0');
        mapboxElement.setAttribute('anisotropy', '');
		mapboxElement.setAttribute('mapbox', {
				accessToken: MAPBOX_ACCESS_TOKEN_VALUE,
				center: centerValue,
				zoom: 15,
				style: 'mapbox://styles/mapbox/satellite-streets-v11',
				pxToWorldRatio: 4
			});
		mapboxElement.classList.add('autocreated');
		el.appendChild(mapboxElement);
    }

    // create Google 3D Tiles
    if (data.maps.includes('google3d')) {
		const tilesElement = document.createElement('a-entity');
		tilesElement.setAttribute('loader-3dtiles', {
			url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
			long: data.longitude,
			lat: data.latitude,
			height: -16.5,
			googleApiKey: GOOGLE_API_KEY,
			geoTransform: 'WGS84Cartesian',
            maximumSSE: 48,
            maximumMem: 400,
            cameraEl: '#camera'
		});
		tilesElement.classList.add('autocreated');
		el.appendChild(tilesElement);
    }
  },

  remove: function () {
    const children = this.el.querySelectorAll('.autocreated');
    children.forEach(child => child.parentNode.removeChild(child));
  }
});
