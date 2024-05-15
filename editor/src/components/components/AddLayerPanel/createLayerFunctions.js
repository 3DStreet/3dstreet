import Events from '/src/lib/Events';

function createSvgExtrudedEntity() {
  // This component accepts a svgString and creates a new entity with geometry extruded
  // from the svg and applies the default mixin material grass.
  const svgString = prompt(
    'Please enter string with SVG tag for create extruded entity',
    `<svg id="traffic-circle-svg" width="1562" height="1722" viewBox="0 0 1562 1722" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="747" cy="884" r="376" fill="white"/>
            <path d="M170 921C110.447 960.339 73.1658 978.46 0 1004L24 1070.5C87.6715 1053.2 126.721 1054.53 200.5 1070.5C180.691 1013.73 173.793 981.04 170 921Z" fill="white"/>
            <path d="M920.5 16.5L873 0C826.761 111.5 798.791 179.933 747 307.5C818.049 307.14 904.5 334 904.5 334C896.322 273.342 871.658 119.714 920.5 16.5Z" fill="white"/>
            <path d="M1562 797C1475.23 805.17 1419.94 800.652 1310 777C1322.14 822.934 1324.73 853.264 1326 911C1426.16 863.684 1479.82 844.12 1562 847V797Z" fill="white"/>
            <path d="M832 1467C782.879 1472.52 753.742 1472.69 697 1467C729.414 1550.35 751.819 1619.31 761 1722H803.5C806.545 1646.07 790.668 1543.99 832 1467Z" fill="white"/>
        </svg>`
  );
  if (svgString && svgString !== '') {
    const newEl = document.createElement('a-entity');
    newEl.setAttribute('svg-extruder', `svgString: ${svgString}`);
    newEl.setAttribute('data-layer-name', 'SVG Path • My Custom Path');
    const parentEl = document.querySelector('#street-container');
    parentEl.appendChild(newEl);
    // update sceneGraph
    Events.emit('entitycreated', newEl);
  }
}

function createMapbox() {
  // This component accepts a long / lat and renders a plane with dimensions that
  // (should be) at a correct scale.
  const newEl = document.createElement('a-entity');
  newEl.setAttribute('geometry', 'primitive: plane; width: 512; height: 512;');
  newEl.setAttribute('rotation', '-90 0 0');
  newEl.setAttribute(
    'mapbox',
    `center: -122.417490, 37.765190; 
		zoom: 18; 
		accessToken: pk.eyJ1Ijoia2llcmFuZmFyciIsImEiOiJjazB0NWh2YncwOW9rM25sd2p0YTlxemk2In0.mLl4sNGDFbz_QXk0GIK02Q; 
		style: mapbox://styles/mapbox/satellite-streets-v11; 
		pxToWorldRatio: 4;`
  );
  newEl.setAttribute('data-layer-name', 'Aerial Imagery • Mapbox Satellite');
  const parentEl = document.querySelector('#reference-layers');
  parentEl.appendChild(newEl);
  // update sceneGraph
  Events.emit('entitycreated', newEl);
}

function createStreetmixStreet() {
  // This code snippet allows the creation of an additional Streetmix street
  // in your 3DStreet scene without replacing any existing streets.
  const streetmixURL = prompt(
    'Please enter a Streetmix URL',
    'https://streetmix.net/kfarr/128/owens-st'
  );
  if (streetmixURL && streetmixURL !== '') {
    const newEl = document.createElement('a-entity');
    newEl.setAttribute('id', streetmixURL);
    // position the street further from the current one so as not to overlap each other
    newEl.setAttribute('position', '0 0 -100');
    newEl.setAttribute(
      'streetmix-loader',
      `streetmixStreetURL: ${streetmixURL}`
    );
    const parentEl = document.querySelector('#street-container');
    parentEl.appendChild(newEl);
    // update sceneGraph
    Events.emit('entitycreated', newEl);
  }
}

function loadScript(url, callback) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;

  script.onload = function () {
    callback();
  };

  document.head.appendChild(script);
}

function create3DTiles() {
  const create3DtilesElement = () => {
    const newEl = document.createElement('a-entity');
    newEl.setAttribute('data-no-pause', '');
    newEl.setAttribute('id', 'tileset');
    newEl.setAttribute('data-layer-name', 'Aerial Imagery • Google 3D Tiles');
    newEl.setAttribute(
      'loader-3dtiles',
      `
		    lat: 37.77522354250163;
		    long: -122.41931773049723;
		    height: -16.5;
		    url: https://tile.googleapis.com/v1/3dtiles/root.json; 
		    googleApiKey: AIzaSyAQshwLVKTpwTfPJxFEkEzOdP_cgmixTCQ; 
		    geoTransform: WGS84Cartesian; 
		    maximumSSE: 48; 
		    maximumMem: 400;
		    cameraEl: #camera
		`
    );

    const refLayers = document.querySelector('#reference-layers');
    // remove all reference elements
    while (refLayers.firstChild) {
      refLayers.removeChild(refLayers.firstChild);
    }
    refLayers.appendChild(newEl);
    document.querySelector('#tileset').play();
    // update sceneGraph
    Events.emit('entitycreated', newEl);
  };
  // This code snippet adds an entity to load and display 3d tiles from Google Maps Tiles API 3D Tiles endpoint. This will break your scene and you cannot save it yet, so beware before testing.
  if (AFRAME.components['loader-3dtiles']) {
    create3DtilesElement();
  } else {
    loadScript(
      'https://cdn.jsdelivr.net/npm/3dstreet@0.4.12/src/lib/aframe-loader-3dtiles-component.min.js',
      create3DtilesElement
    );
  }
}

function createCustomModel() {
  // accepts a path for a glTF (or glb) file hosted on any publicly accessible HTTP server.
  // Then create entity with model from that path by using gltf-model component
  const modelUrl = prompt(
    'Please enter a URL to custom glTF/Glb model',
    'https://cdn.glitch.global/690c7ea3-3f1c-434b-8b8d-3907b16de83c/Mission_Bay_school_low_poly_model_v03_draco.glb'
  );
  if (modelUrl && modelUrl !== '') {
    const newEl = document.createElement('a-entity');
    newEl.classList.add('custom-model');
    newEl.setAttribute('gltf-model', `url(${modelUrl})`);
    newEl.setAttribute('data-layer-name', 'glTF Model • My Custom Object');
    const parentEl = document.querySelector('#street-container');
    parentEl.appendChild(newEl);
    // update sceneGraph
    Events.emit('entitycreated', newEl);
  }
}

function createPrimitiveGeometry() {
  const newEl = document.createElement('a-entity');
  newEl.setAttribute('geometry', 'primitive: circle; radius: 50;');
  newEl.setAttribute('rotation', '-90 0 0');
  newEl.setAttribute(
    'data-layer-name',
    'Plane Geometry • Traffic Circle Asphalt'
  );
  newEl.setAttribute('material', 'src: #asphalt-texture; repeat: 5 5;');
  const parentEl = document.querySelector('#street-container');
  parentEl.appendChild(newEl);
  // update sceneGraph
  Events.emit('entitycreated', newEl);
}

export {
  createSvgExtrudedEntity,
  createMapbox,
  createStreetmixStreet,
  create3DTiles,
  createCustomModel,
  createPrimitiveGeometry
};
