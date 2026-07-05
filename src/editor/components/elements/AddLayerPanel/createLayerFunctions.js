import { createUniqueId } from '../../../lib/entity.js';
import * as defaultStreetObjects from './defaultStreets.js';
import { uploadAndPlaceAsset } from '../../../lib/asset-upload/uploadAndPlaceAsset.js';
import {
  GLB_EXTS,
  IMAGE_EXTS,
  SPLAT_EXTS
} from '@shared/asset-upload/uploadAsset.js';
import Events from '../../../lib/Events.js';

// Per-kind file picker filters for the upload-backed custom layers, derived from
// the shared extension allowlists in src/shared/asset-upload/uploadAsset.js so
// each card accepts exactly what the upload pipeline accepts for that kind.
const ASSET_PICKER_ACCEPT = {
  glb: GLB_EXTS.join(','),
  image: IMAGE_EXTS.join(','),
  splat: SPLAT_EXTS.join(',')
};

// Opens the native file-select dialog (same flow as the File ▸ Import menu and
// drag-and-drop), then hands the chosen file to the asset upload pipeline. The
// pipeline renders a local placeholder immediately and uploads to the user's
// asset library in the background (auth + quota are enforced there).
function openAssetUploadPicker(position, kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ASSET_PICKER_ACCEPT[kind];
  input.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      // Reveal the Assets panel so the user sees the upload begin and its
      // progress, even if the left panel was showing Layers or Geospatial.
      Events.emit('openassetspanel');
      await uploadAndPlaceAsset(file, position);
    }
  };
  input.click();
}

// Builds a position string that keeps an entity's base on the ground. `position`
// is a THREE.Vector3 when dropped onto the scene, or undefined when the card is
// clicked (entity is centered at the origin).
function groundedPositionString(position, yOffset) {
  if (position && typeof position.x === 'number') {
    return `${position.x} ${position.y + yOffset} ${position.z}`;
  }
  return `0 ${yOffset} 0`;
}

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

export function createManagedStreetFromStreetmixURLPrompt(
  position,
  hideBuildings
) {
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
          showBoundaries: !hideBuildings,
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
  // Upload a glTF/GLB model from the user's device. The chosen file is rendered
  // locally and stored in the user's asset library via the upload pipeline.
  openAssetUploadPicker(position, 'glb');
}

export function createBuildingBox(position) {
  // A simple massing block roughly the size of a 3-story building (~10m tall),
  // sitting on the ground in a bright primary blue. Meant as an easy placeholder
  // for non-technical users to block out buildings.
  const height = 10; // ~3 stories
  const definition = {
    components: {
      position: groundedPositionString(position, height / 2),
      geometry: `primitive: box; width: 10; height: ${height}; depth: 10;`,
      material: 'color: #2962ff; roughness: 0.8;',
      'data-layer-name': 'Building Box • 3 Stories',
      shadow: 'receive: true; cast: true;'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createGrassBox(position) {
  // A large, thin green slab (4x the building box footprint, 0.5m thick) to act
  // as a ground/lawn for non-street scenes that don't already have terrain.
  // Offset down by half its thickness so its top surface sits exactly at y=0 and
  // objects placed on the ground rest flush on top of it.
  //
  // The box ships with the street-generated-grass generator attached as a live
  // demo of the host-primitive + generator pattern: the box's geometry/material
  // and the grass options (density, blade height, …) all surface as first-class
  // controls in the properties sidebar. The animated blades are autocreated
  // children regenerated from config, so saving the scene stores only the box +
  // the grass config, not the blades. See docs/host-generator-pattern.md.
  const thickness = 0.5;
  const definition = {
    components: {
      position: groundedPositionString(position, -thickness / 2),
      geometry: `primitive: box; width: 40; height: ${thickness}; depth: 40;`,
      material: 'color: #4c9a2a; roughness: 1;',
      'street-generated-grass': '',
      'data-layer-name': 'Grass Box • Ground',
      shadow: 'receive: true;'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createConcreteCylinder(position) {
  // A gray concrete cylinder roughly the size of an interstate highway support
  // pillar (~1.2m diameter, ~8m tall), sitting on the ground. A quick placeholder
  // for elevated-roadway columns.
  const height = 8;
  const definition = {
    components: {
      position: groundedPositionString(position, height / 2),
      geometry: `primitive: cylinder; radius: 0.6; height: ${height};`,
      material: 'color: #9e9e9e; roughness: 0.9;',
      'data-layer-name': 'Concrete Cylinder • Highway Pillar',
      shadow: 'receive: true; cast: true;'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createTorusKnot(position) {
  // A polished metallic torus knot — a decorative primitive that shows off the
  // geometry + material featured controls (metalness/roughness). Lifted off the
  // ground so the full knot is visible. Geometry and material are editable in
  // the properties panel.
  const definition = {
    components: {
      position: groundedPositionString(position, 3),
      geometry: 'primitive: torusKnot; radius: 2.33; radiusTubular: 0.43;',
      material: 'color: #a6a6a6; metalness: 0.75; roughness: 0.23;',
      'data-layer-name': 'Torus Knot',
      shadow: 'receive: true; cast: true;'
    }
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

export function createHighlightRing(position) {
  // A bright red ring laid flat on the ground, large enough to circle and
  // highlight a real-world street element (vehicle, tree, lane area, etc.).
  // Uses the flat shader so it stays vivid regardless of scene lighting.
  const definition = {
    components: {
      position: groundedPositionString(position, 0.1),
      rotation: '0 0 0',
      geometry: 'primitive: torus; radius: 3; radiusTubular: 0.15;',
      material: 'shader: flat; color: #ff0000; side: double;',
      'data-layer-name': 'Highlight Ring • Red'
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

export function createImageEntity(position) {
  // Upload an image (sign, reference photo, custom map, etc.) from the user's
  // device. The upload pipeline sizes the image plane and stores it in the
  // user's asset library.
  openAssetUploadPicker(position, 'image');
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
  // Upload a Gaussian Splat (.splat, .ply, .spz, .rad) from the user's device.
  // The upload pipeline renders it locally and stores it in the user's asset
  // library (and queues RAD/LOD conversion where applicable).
  openAssetUploadPicker(position, 'splat');
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
