import * as createFunctions from './createLayerFunctions';

export const streetLayersData = [
  {
    name: 'Create Intersection',
    img: '',
    requiresPro: true,
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
    name: '(Beta) Managed Street from Streetplan URL',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create a new street from Streetplan URL using the Managed Street component.',
    handlerFunction: createFunctions.createManagedStreetFromStreetplanURLPrompt
  }
].map((layer, index) => ({ ...layer, id: index + 1 }));

export const customLayersData = [
  {
    name: 'Entity from extruded SVG',
    img: '',
    icon: '',
    requiresPro: true,
    description:
      'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.',
    handlerFunction: createFunctions.createSvgExtrudedEntity
  },
  {
    name: 'glTF model from URL',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with model from path for a glTF (or Glb) file hosted on any publicly accessible HTTP server.',
    handlerFunction: createFunctions.createCustomModel
  },
  {
    name: 'Create primitive geometry',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'Create entity with A-Frame primitive geometry. Geometry type could be changed in properties panel.',
    handlerFunction: createFunctions.createPrimitiveGeometry
  },
  {
    name: 'Place New Image Entity',
    img: '',
    requiresPro: true,
    icon: 'ui_assets/cards/icons/gallery24.png',
    description:
      'Place an image such as a sign, reference photo, custom map, etc.',
    handlerFunction: createFunctions.createImageEntity
  }
].map((layer, index) => ({ ...layer, id: index + 1 }));
