import { createUniqueId } from '../../../lib/entity.js';
import * as defaultStreetObjects from './defaultStreets.js';
import { VEHICLE_PRESETS } from '../../../../aframe-components/play/vehicle-presets.js';

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

export function createManagedStreetFromStreetmixURLPrompt(position) {
  // This creates a new Managed Street
  let streetmixURL = prompt(
    'Please enter a Streetmix URL',
    'https://streetmix.net/kfarr/3/3dstreet-demo-street'
  );

  if (streetmixURL && streetmixURL !== '') {
    const definition = {
      id: createUniqueId(),
      components: {
        position: position ?? '0 0 0',
        'managed-street': {
          sourceType: 'streetmix-url',
          sourceValue: streetmixURL,
          showVehicles: true,
          showStriping: true,
          synchronize: true
        }
      }
    };

    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createManagedStreetFromStreetplanURLPrompt(position) {
  // This creates a new Managed Street
  let streetplanURL = prompt(
    'Please enter a StreetPlan URL',
    'https://streetplan.net/3dstreet/89474'
  );

  if (streetplanURL && streetplanURL !== '') {
    const definition = {
      id: createUniqueId(),
      components: {
        position: position ?? '0 0 0',
        'managed-street': {
          sourceType: 'streetplan-url',
          sourceValue: streetplanURL,
          showVehicles: true,
          showStriping: true,
          synchronize: true
        }
      }
    };

    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createManagedStreetFromStreetObject(position, streetObject) {
  // This creates a new Managed Street
  if (streetObject && streetObject !== '') {
    const definition = {
      id: createUniqueId(),
      components: {
        position: position ?? '0 0 0',
        'managed-street': {
          sourceType: 'json-blob',
          sourceValue: JSON.stringify(streetObject),
          showVehicles: true,
          showStriping: true,
          synchronize: true
        }
      }
    };

    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createStreetmixStreet(position, streetmixURL, hideBuildings) {
  // legacy
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
      id: createUniqueId(),
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

export function create60ftRightOfWayManagedStreet(position) {
  console.log(
    'create60ftRightOfWayManagedStreet',
    defaultStreetObjects.stroad60ftROW
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.stroad60ftROW
  );
}

export function create40ftRightOfWayManagedStreet(position) {
  console.log(
    'create40ftRightOfWayManagedStreet',
    defaultStreetObjects.stroad40ftROW
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.stroad40ftROW
  );
}

export function create80ftRightOfWayManagedStreet(position) {
  console.log(
    'create80ftRightOfWayManagedStreet',
    defaultStreetObjects.stroad80ftROW
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.stroad80ftROW
  );
}

export function create94ftRightOfWayManagedStreet(position) {
  console.log(
    'create94ftRightOfWayManagedStreet',
    defaultStreetObjects.stroad94ftROW
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.stroad94ftROW
  );
}

export function create150ftRightOfWayManagedStreet(position) {
  console.log(
    'create150ftRightOfWayManagedStreet',
    defaultStreetObjects.stroad150ftROW
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.stroad150ftROW
  );
}

export function createBuildingDemoManagedStreet(position) {
  console.log(
    'createBuildingDemoManagedStreet',
    defaultStreetObjects.buildingDemo
  );
  createManagedStreetFromStreetObject(
    position,
    defaultStreetObjects.buildingDemo
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
        'data-layer-name': 'glTF Model • My Custom Object',
        shadow: 'receive: true; cast: true;'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

export function createRaceTarget(position) {
  const definition = {
    'data-layer-name': 'Race Target',
    components: {
      position: position ?? '0 0 0',
      'race-target': 'width: 6; height: 4; color: #2196f3'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createPrimitiveGeometry(position) {
  const definition = {
    'data-layer-name': 'Geometry • Circle Asphalt',
    components: {
      position: position ?? '0 0 0',
      geometry: 'primitive: circle; radius: 15;',
      rotation: '-90 -90 0',
      material: 'src: #asphalt-texture; repeat: 5 5;',
      shadow: ''
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

/**
 * Spawn a driveable-vehicle entity from a named preset
 * (`tuk-tuk`, `delivery-bot`, `taxi`). The preset bundle in
 * `vehicle-presets.js` drives chassis size, engine/brake/steer
 * tuning, wheel dimensions, AND the mesh — either a catalog mixin
 * or a registered procedural component.
 *
 * Switching preset later in the property panel re-applies the
 * whole bundle via drive-controls' update() hook, so users aren't
 * locked into whichever preset they spawned with.
 */
function createDriveableFromPreset(presetName, layerName, position) {
  const p = VEHICLE_PRESETS[presetName];
  if (!p) {
    console.error('createDriveableFromPreset: unknown preset', presetName);
    return;
  }
  // Build the drive-controls attribute string from the preset.
  // `preset: ...` is included so the schema field reflects the
  // current choice in the property panel.
  const driveControlsStr = [
    `preset: ${presetName}`,
    `vehicleSize: ${p.vehicleSize.x} ${p.vehicleSize.y} ${p.vehicleSize.z}`,
    `accelerateForce: ${p.accelerateForce}`,
    `brakeForce: ${p.brakeForce}`,
    `steerAngle: ${p.steerAngle}`,
    `wheelRadius: ${p.wheelRadius}`,
    `wheelWidth: ${p.wheelWidth}`,
    `wheelLayout: ${p.wheelLayout || 'four-wheel'}`,
    `meshYOffset: ${p.meshYOffset || 0}`
  ].join('; ');

  // Mesh-slot child: catalog mixin OR procedural component. The
  // 180° editor-rotation trick aligns the mesh's +Z forward with
  // the entity's -Z forward marker.
  const meshSlotComponents = {
    'vehicle-mesh-slot': '',
    rotation: '0 180 0',
    shadow: 'cast: true; receive: true'
  };
  if (p.meshComponent) {
    meshSlotComponents[p.meshComponent] = '';
  } else if (p.meshMixin) {
    meshSlotComponents.mixin = p.meshMixin;
  }

  const definition = {
    'data-layer-name': layerName,
    components: {
      position: position ?? '0 1 0',
      'drive-controls': driveControlsStr,
      geometry: `primitive: box; width: ${p.vehicleSize.x}; height: ${p.vehicleSize.y}; depth: ${p.vehicleSize.z}`,
      material: `color: ${p.placeholderColor}; opacity: 0.0; transparent: true`,
      shadow: 'cast: false; receive: false'
    },
    children: [
      {
        'data-layer-name': 'Vehicle Mesh',
        components: meshSlotComponents
      }
    ]
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createDriveableTukTuk(position) {
  createDriveableFromPreset('tuk-tuk', 'Driveable Tuk-tuk', position);
}

export function createDriveableDeliveryRobot(position) {
  createDriveableFromPreset(
    'delivery-bot',
    'Driveable Delivery Robot',
    position
  );
}

export function createDriveableTaxi(position) {
  createDriveableFromPreset('taxi', 'Driveable Taxi', position);
}

// Backwards compat: old layersData entries that referenced
// `createDriveableVehicle` keep working and now point at the
// Delivery Robot preset.
export const createDriveableVehicle = createDriveableDeliveryRobot;

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

export function createSplatObject(position) {
  // accepts a path for a .splat, .ply, or .spz file hosted on a CORS-enabled HTTP server.
  // Then create entity with model from that path by using splat component (Spark library)
  // Note: GitHub raw URLs don't work due to CORS. Use a CDN or CORS-enabled server.
  const modelUrl = prompt(
    "Enter URL to a Gaussian Splat (.splat, .ply, .spz)\n\nNote: Host must allow CORS. GitHub raw URLs won't work.",
    'https://sparkjs.dev/assets/splats/butterfly.spz'
  );

  if (modelUrl && modelUrl !== '') {
    const definition = {
      class: 'splat-model',
      'data-layer-name': 'Splat Model • My Custom Object',
      components: {
        position: position ?? '0 0 0',
        splat: `src: ${modelUrl}`
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}

// --- Traffic Replay ---------------------------------------------------------
// Ingest an anonymized replay manifest (see scripts/tmd-replay/) and attach it
// to a managed-street as a `street-traffic-replay` component. v1 takes a
// pre-converted JSON manifest; .sqlite-in-browser conversion is a fast-follow.

function notifyError(msg) {
  if (window.STREET?.notify?.errorMessage) {
    window.STREET.notify.errorMessage(msg);
  } else console.error('[traffic-replay]', msg);
}
function notifySuccess(msg) {
  if (window.STREET?.notify?.successMessage) {
    window.STREET.notify.successMessage(msg);
  } else console.log('[traffic-replay]', msg);
}

// Walk up from the current selection to the managed-street it belongs to; fall
// back to the first managed-street in the scene.
function findTargetManagedStreet() {
  let el = window.AFRAME?.INSPECTOR?.selectedEntity;
  while (el && el.components) {
    if (el.components['managed-street']) return el;
    el = el.parentElement;
  }
  return document.querySelector('[managed-street]');
}

function summarizeManifest(manifest) {
  const counts =
    manifest.meta?.countsByMode ||
    manifest.agents.reduce((acc, a) => {
      acc[a.mode] = (acc[a.mode] || 0) + 1;
      return acc;
    }, {});
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return `${manifest.agents.length} agents (${parts})`;
}

function attachReplayManifest(manifest) {
  const summary = summarizeManifest(manifest);
  const manifestData = JSON.stringify(manifest);
  const target = findTargetManagedStreet();

  if (target) {
    // Attach to the existing managed-street and make it playable.
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: target,
      component: 'street-traffic-replay',
      property: 'manifestData',
      value: manifestData,
      noSelectEntity: true
    });
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: target,
      component: 'managed-street',
      property: 'playable',
      value: true,
      noSelectEntity: true
    });
    notifySuccess(
      `Traffic Replay added to your street — ${summary}. Press Play.`
    );
  } else {
    // No street yet: create a default cross-section that carries the replay.
    const definition = {
      id: createUniqueId(),
      'data-layer-name': 'Traffic Replay Street',
      components: {
        position: '0 0 0',
        'managed-street': {
          sourceType: 'json-blob',
          sourceValue: JSON.stringify(defaultStreetObjects.stroad60ftROW),
          showStriping: true,
          showVehicles: false,
          synchronize: true,
          playable: true
        },
        'street-traffic-replay': {
          manifestData,
          timeScale: 1,
          loop: true
        }
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
    notifySuccess(`Traffic Replay street created — ${summary}. Press Play.`);
  }
}

export function createTrafficReplay() {
  // v1: pick a pre-converted JSON manifest from disk.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let manifest;
    try {
      manifest = JSON.parse(await file.text());
    } catch (err) {
      notifyError('Could not parse that file as JSON.');
      return;
    }
    if (
      !manifest ||
      !Array.isArray(manifest.agents) ||
      !manifest.agents.length
    ) {
      notifyError('That JSON is not a replay manifest (no "agents" array).');
      return;
    }
    attachReplayManifest(manifest);
  });
  input.click();
}

export function createPanoramaSphere() {
  // Create a sphere with panorama texture for AR/VR experiences
  const panoramaUrl = prompt(
    'Please enter a URL to a 360° panorama image',
    'https://kfarr.github.io/ar-tour-assets/panoramic/world_b5da22ec-c745-40b3-ac6b-01247b8c212b_skybox.png'
  );

  if (panoramaUrl && panoramaUrl !== '') {
    const definition = {
      element: 'a-entity',
      components: {
        geometry:
          'primitive: sphere; radius: 100; segmentsWidth: 64; segmentsHeight: 32',
        material: `shader: flat; side: back; src: ${panoramaUrl}`,
        scale: '-1 1 1',
        'data-layer-name': 'Sphere Geometry • 360° Panorama'
      }
    };
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  }
}
