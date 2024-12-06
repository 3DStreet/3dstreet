import {
  createSvgExtrudedEntity,
  createStreetmixStreet,
  createCustomModel,
  createPrimitiveGeometry,
  createIntersection,
  create40ftRightOfWay,
  create60ftRightOfWay,
  create80ftRightOfWay,
  create94ftRightOfWay,
  create150ftRightOfWay,
  createImageEntity,
  createManagedStreet
} from './createLayerFunctions';

export const streetLayersData = [
  {
    name: 'Street from Streetmix URL',
    img: 'ui_assets/cards/streetmix.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description:
      'Create an additional Streetmix street in your 3DStreet scene without replacing any existing streets.',
    id: 1,
    handlerFunction: createStreetmixStreet
  },
  {
    name: '40ft RoW / 24ft Roadway Width',
    img: 'ui_assets/cards/street-preset-40-24.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description: 'Premade Street 40ft Right of Way / 24ft Roadway Width',
    id: 2,
    handlerFunction: create40ftRightOfWay
  },
  {
    name: '60ft RoW / 36ft Roadway Width',
    img: 'ui_assets/cards/street-preset-60-36.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description: 'Premade Street 60ft Right of Way / 36ft Roadway Width',
    id: 3,
    handlerFunction: create60ftRightOfWay
  },
  {
    name: '80ft RoW / 56ft Roadway Width',
    img: 'ui_assets/cards/street-preset-80-56.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description: 'Premade Street 80ft Right of Way / 56ft Roadway Width',
    id: 4,
    handlerFunction: create80ftRightOfWay
  },
  {
    name: '94ft RoW / 70ft Roadway Width',
    img: 'ui_assets/cards/street-preset-94-70.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description: 'Premade Street 94ft Right of Way / 70ft Roadway Width',
    id: 5,
    handlerFunction: create94ftRightOfWay
  },
  {
    name: '150ft RoW / 124ft Roadway Width',
    img: 'ui_assets/cards/street-preset-150-124.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    description: 'Premade Street 150ft Right of Way / 124ft Roadway Width',
    id: 6,
    handlerFunction: create150ftRightOfWay
  },
  {
    name: 'Create intersection',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create intersection entity. Parameters of intersection component could be changed in properties panel.',
    id: 7,
    handlerFunction: createIntersection
  }
];

export const customLayersData = [
  {
    name: 'Entity from extruded SVG',
    img: '',
    icon: '',
    requiresPro: true,
    description:
      'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.',
    id: 1,
    handlerFunction: createSvgExtrudedEntity
  },
  {
    name: 'glTF model from URL',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with model from path for a glTF (or Glb) file hosted on any publicly accessible HTTP server.',
    id: 2,
    handlerFunction: createCustomModel
  },
  {
    name: 'Create primitive geometry',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with A-Frame primitive geometry. Geometry type could be changed in properties panel.',
    id: 3,
    handlerFunction: createPrimitiveGeometry
  },
  {
    name: 'Place New Image Entity',
    img: '',
    requiresPro: true,
    icon: 'ui_assets/cards/icons/gallery24.png',
    description:
      'Place an image such as a sign, reference photo, custom map, etc.',
    id: 4,
    handlerFunction: createImageEntity
  },
  {
    name: 'Create Managed Street (Beta)',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create a new street from Streetmix using the Managed Street component.',
    id: 5,
    handlerFunction: createManagedStreet
  }
];
