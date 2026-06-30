import * as createFunctions from './createLayerFunctions';

export const streetLayersData = [
  {
    name: 'Create Intersection',
    img: '',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Create 90º intersection entity.',
    handlerFunction: createFunctions.createIntersection
  },
  {
    name: 'Street from Streetmix URL',
    img: 'ui_assets/cards/streetmix.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description:
      'Create an additional Streetmix street in your 3DStreet scene without replacing any existing streets.',
    handlerFunction: createFunctions.createStreetmixStreet
  },
  {
    name: '(Beta) Managed Street from Streetmix URL',
    img: '',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description:
      'Create a new street from Streetmix URL using the Managed Street component.',
    handlerFunction: createFunctions.createManagedStreetFromStreetmixURLPrompt
  },
  {
    name: '(Beta) Managed Street 40ft RoW / 24ft Roadway Width',
    img: 'ui_assets/cards/street-preset-40-24.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Premade Street 40ft Right of Way / 24ft Roadway Width',
    handlerFunction: createFunctions.create40ftRightOfWayManagedStreet
  },
  {
    name: '(Beta) Managed Street 60ft RoW / 36ft Roadway Width',
    img: 'ui_assets/cards/street-preset-60-36.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Premade Street 60ft Right of Way / 36ft Roadway Width',
    handlerFunction: createFunctions.create60ftRightOfWayManagedStreet
  },
  {
    name: '(Beta) Managed Street 80ft RoW / 56ft Roadway Width',
    img: 'ui_assets/cards/street-preset-80-56.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Premade Street 80ft Right of Way / 56ft Roadway Width',
    handlerFunction: createFunctions.create80ftRightOfWayManagedStreet
  },
  {
    name: '(Beta) Managed Street 94ft RoW / 70ft Roadway Width',
    img: 'ui_assets/cards/street-preset-94-70.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Premade Street 94ft Right of Way / 70ft Roadway Width',
    handlerFunction: createFunctions.create94ftRightOfWayManagedStreet
  },
  {
    name: '(Beta) Managed Street 150ft RoW / 124ft Roadway Width',
    img: 'ui_assets/cards/street-preset-150-124.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description: 'Premade Street 150ft Right of Way / 124ft Roadway Width',
    handlerFunction: createFunctions.create150ftRightOfWayManagedStreet
  },
  {
    name: '(Beta) Building Placement Demo',
    img: '',
    icon: 'ui_assets/cards/icons/3dst24.png',
    description:
      'Demo street with buildings on both sides using the new fit mode for building placement',
    handlerFunction: createFunctions.createBuildingDemoManagedStreet
  },
  {
    name: '(Beta) Managed Street from Streetplan URL',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create a new street from Streetplan URL using the Managed Street component.',
    handlerFunction: createFunctions.createManagedStreetFromStreetplanURLPrompt
  }
].map((layer, index) => ({ ...layer, id: index + 1 }));

// A-Frame geometry primitives — host shapes that surface first-class geometry +
// material controls in the properties sidebar (the host-primitive pattern).
export const shapeLayersData = [
  {
    name: 'Building Box',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a simple box roughly the size of a 3-story building, sitting on the ground in a bright blue. A quick placeholder for blocking out buildings.',
    handlerFunction: createFunctions.createBuildingBox
  },
  {
    name: 'Asphalt Circle',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a large flat asphalt circle on the ground. Geometry and material can be changed in the properties panel.',
    handlerFunction: createFunctions.createPrimitiveGeometry
  },
  {
    name: 'Grass Box',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a large green ground slab with animated instanced grass. The box dimensions, color, and grass options (density, blade height) are all editable in the properties panel.',
    handlerFunction: createFunctions.createGrassBox
  },
  {
    name: 'Concrete Cylinder',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a gray concrete cylinder roughly the size of an interstate highway support pillar. A quick placeholder for elevated-roadway columns.',
    handlerFunction: createFunctions.createConcreteCylinder
  },
  {
    name: 'Torus Knot',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a polished metallic torus knot. A decorative primitive that shows off the geometry and material (metalness/roughness) controls in the properties panel.',
    handlerFunction: createFunctions.createTorusKnot
  },
  {
    name: 'Highlight Ring',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Add a bright red ring, big enough to circle and highlight a real-world element like a vehicle, tree, or part of a lane.',
    handlerFunction: createFunctions.createHighlightRing
  }
].map((layer, index) => ({ ...layer, id: index + 1 }));

export const customLayersData = [
  {
    name: 'Upload Image',
    img: '',
    requiresPro: false,
    icon: 'ui_assets/cards/icons/gallery24.png',
    description:
      'Upload an image (sign, reference photo, custom map, etc.) from your device and place it in the scene.',
    handlerFunction: createFunctions.createImageEntity
  },
  {
    name: 'Upload 3D Model',
    img: '',
    requiresPro: false,
    icon: '',
    description:
      'Upload a glTF or GLB model from your device. It is rendered immediately and saved to your asset library.',
    handlerFunction: createFunctions.createCustomModel
  },
  {
    name: 'Upload Gaussian Splat',
    img: '',
    requiresPro: false,
    icon: '',
    description:
      'Upload a Gaussian Splat (.splat, .ply, .spz, .rad) from your device and place it in the scene.',
    handlerFunction: createFunctions.createSplatObject
  },
  {
    name: '360° Panorama Sphere',
    img: '',
    requiresPro: false,
    icon: '',
    description:
      'Create an immersive 360° environment from a panoramic image for AR/VR experiences.',
    handlerFunction: createFunctions.createPanoramaSphere
  },
  {
    name: 'Entity from extruded SVG',
    img: '',
    icon: '',
    requiresPro: false,
    description:
      'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.',
    handlerFunction: createFunctions.createSvgExtrudedEntity
  }
].map((layer, index) => ({ ...layer, id: index + 1 }));
