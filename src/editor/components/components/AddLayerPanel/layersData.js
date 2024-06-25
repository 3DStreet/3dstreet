import {
  createSvgExtrudedEntity,
  createMapbox,
  createStreetmixStreet,
  create3DTiles,
  createCustomModel,
  createPrimitiveGeometry,
  createIntersection
} from './createLayerFunctions';

// data for PRO layers cards
const layersData = [
  {
    name: 'Mapbox 2D Aerial',
    img: 'ui_assets/cards/mapbox2d.jpg',
    icon: 'ui_assets/cards/icons/mapbox24.png',
    requiresPro: true,
    description:
      'Create entity with mapbox component, that accepts a long / lat and renders a plane with dimensions that (should be) at a correct scale.',
    id: 1,
    handlerFunction: createMapbox
  },
  {
    name: 'Street from Streetmix URL',
    img: 'ui_assets/cards/streetmix.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    requiresPro: true,
    description:
      'Create an additional Streetmix street in your 3DStreet scene without replacing any existing streets.',
    id: 2,
    handlerFunction: createStreetmixStreet
  },
  {
    name: 'Entity from extruded SVG',
    img: '',
    icon: '',
    requiresPro: true,
    description:
      'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.',
    id: 3,
    handlerFunction: createSvgExtrudedEntity
  },
  {
    name: 'Google Maps 3D Tiles',
    img: 'ui_assets/cards/google3d.jpg',
    icon: 'ui_assets/cards/icons/google24.png',
    requiresPro: true,
    description:
      'Adds an entity to load and display 3d tiles from Google Maps Tiles API 3D Tiles endpoint. This will break your scene and you cannot save it yet, so beware before testing.',
    id: 4,
    handlerFunction: create3DTiles
  },
  {
    name: 'glTF model from URL',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with model from path for a glTF (or Glb) file hosted on any publicly accessible HTTP server.',
    id: 5,
    handlerFunction: createCustomModel
  },
  {
    name: 'Create primitive geometry',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with A-Frame primitive geometry. Geometry type could be changed in properties panel.',
    id: 6,
    handlerFunction: createPrimitiveGeometry
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

export { layersData };
