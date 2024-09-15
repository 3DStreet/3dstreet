import { loadScript, roundCoord } from '../../../../../src/utils.js';

export function createSvgExtrudedEntity(position) {
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
    const definition = {
      element: 'a-entity',
      components: {
        position: position ?? '0 0 0',
        'svg-extruder': `svgString: ${svgString}`,
        'data-layer-name': 'SVG Path • My Custom Path'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}
export function createMapbox() {
  // This component accepts a long / lat and renders a plane with dimensions that
  // (should be) at a correct scale.
  const geoLayer = document.getElementById('reference-layers');
  let latitude = 0;
  let longitude = 0;
  const streetGeo = geoLayer?.getAttribute('street-geo');

  if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
    latitude = roundCoord(parseFloat(streetGeo['latitude']));
    longitude = roundCoord(parseFloat(streetGeo['longitude']));
  }

  AFRAME.INSPECTOR.execute(streetGeo ? 'entityupdate' : 'componentadd', {
    entity: geoLayer,
    component: 'street-geo',
    value: {
      latitude: latitude,
      longitude: longitude,
      maps: 'mapbox2d'
    }
  });
}

export function createStreetmixStreet(position, streetmixURL, hideBuildings) {
  // This code snippet allows the creation of an additional Streetmix street
  // in your 3DStreet scene without replacing any existing streets.
  if (streetmixURL === undefined) {
    streetmixURL = prompt(
      'Please enter a Streetmix URL',
      'https://streetmix.net/kfarr/3/3dstreet-demo-street'
    );
  }
  // position the street further from the current one so as not to overlap each other
  if (streetmixURL && streetmixURL !== '') {
    const definition = {
      id: streetmixURL,
      components: {
        position: position ?? '0 0 -20',
        'streetmix-loader': {
          streetmixStreetURL: streetmixURL,
          showBuildings: !hideBuildings
        }
      }
    };

    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function create40ftRightOfWay(position) {
  createStreetmixStreet(
    position,
    'https://streetmix.net/3dstreetapp/1/40ft-right-of-way-24ft-road-width',
    true
  );
}
export function create60ftRightOfWay(position) {
  createStreetmixStreet(
    position,
    'https://streetmix.net/3dstreetapp/2/60ft-right-of-way-36ft-road-width',
    true
  );
}
export function create80ftRightOfWay(position) {
  createStreetmixStreet(
    position,
    'https://streetmix.net/3dstreetapp/3/80ft-right-of-way-56ft-road-width',
    true
  );
}
export function create94ftRightOfWay(position) {
  createStreetmixStreet(
    position,
    'https://streetmix.net/3dstreetapp/4/94ft-right-of-way-70ft-road-width',
    true
  );
}
export function create150ftRightOfWay(position) {
  createStreetmixStreet(
    position,
    'https://streetmix.net/3dstreetapp/5/150ft-right-of-way-124ft-road-width',
    true
  );
}

export function create3DTiles() {
  // This code snippet adds an entity to load and display 3d tiles from
  // Google Maps Tiles API 3D Tiles endpoint. This will break your scene
  // and you cannot save it yet, so beware before testing.

  const create3DtilesElement = () => {
    const geoLayer = document.getElementById('reference-layers');
    let latitude = 0;
    let longitude = 0;
    let ellipsoidalHeight = 0;
    const streetGeo = geoLayer?.getAttribute('street-geo');

    if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
      latitude = roundCoord(parseFloat(streetGeo['latitude']));
      longitude = roundCoord(parseFloat(streetGeo['longitude']));
      ellipsoidalHeight = parseFloat(streetGeo['ellipsoidalHeight']) || 0;
    }

    AFRAME.INSPECTOR.execute(streetGeo ? 'entityupdate' : 'componentadd', {
      entity: geoLayer,
      component: 'street-geo',
      value: {
        latitude: latitude,
        longitude: longitude,
        ellipsoidalHeight: ellipsoidalHeight,
        maps: 'google3d'
      }
    });
  };

  if (AFRAME.components['loader-3dtiles']) {
    create3DtilesElement();
  } else {
    loadScript(
      new URL(
        '/src/lib/aframe-loader-3dtiles-component.min.js',
        import.meta.url
      ),
      create3DtilesElement
    );
  }
}

export function createCustomModel(position) {
  // accepts a path for a glTF (or glb) file hosted on any publicly accessible HTTP server.
  // Then create entity with model from that path by using gltf-model component
  const modelUrl = prompt(
    'Please enter a URL to custom glTF/GLB model',
    'https://cdn.glitch.global/690c7ea3-3f1c-434b-8b8d-3907b16de83c/Mission_Bay_school_low_poly_model_v03_draco.glb'
  );
  if (modelUrl && modelUrl !== '') {
    const definition = {
      class: 'custom-model',
      components: {
        position: position ?? '0 0 0',
        'gltf-model': `url(${modelUrl})`,
        'data-layer-name': 'glTF Model • My Custom Object'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createPrimitiveGeometry(position) {
  const definition = {
    'data-layer-name': 'Geometry • Traffic Circle Asphalt',
    components: {
      position: position ?? '0 0 0',
      geometry: 'primitive: circle; radius: 15;',
      rotation: '-90 -90 0',
      material: 'src: #asphalt-texture; repeat: 5 5;'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createImageEntity(position) {
  // This component accepts a svgString and creates a new entity with geometry extruded
  // from the svg and applies the default mixin material grass.
  const imagePath = prompt(
    'Please enter an image path that is publicly accessible on the web and starts with https://',
    `https://assets.3dstreet.app/images/signs/Sign-Speed-30kph-Kiritimati.png`
  );
  if (imagePath && imagePath !== '') {
    const definition = {
      element: 'a-entity',
      components: {
        position: position ?? '0 0 0', // TODO: How to override only the height (y) value? We don't want the sign in the ground
        geometry: 'primitive: plane; height: 1.5; width: 1;',
        material: `src: url(${imagePath})`,
        'data-layer-name': 'Image • User Specified Path'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createIntersection(position) {
  const definition = {
    'data-layer-name': 'Street • Intersection 90º',
    components: {
      position: position ?? '0 0 0',
      intersection: '',
      rotation: '-90 -90 0'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createSplatObject() {
  // accepts a path for a .splat file hosted on any publicly accessible HTTP server.
  // Then create entity with model from that path by using gaussian_splatting component
  const modelUrl = prompt(
    'Please enter a URL to custom Splat model',
    'https://cdn.glitch.me/f80a77a3-62a6-4024-9bef-a6b523d1abc0/gs_Bioswale3_treat.splat'
  );

  if (modelUrl && modelUrl !== '') {
    const definition = {
      class: 'splat-model',
      'data-layer-name': 'Splat Model • My Custom Object',
      'data-no-pause': '',
      components: {
        gaussian_splatting: `src: ${modelUrl}`
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}
