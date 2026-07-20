import * as createFunctions from './createLayerFunctions';
import { layerCardMessages as m } from './addLayerMessages';

// Each card's canonical English `name`/`description` is derived from the shared
// i18n messages (single source of truth), while `nameId`/`descriptionId` carry
// the message descriptors used to render the localized text. The English `name`
// is what gets written to `data-layer-name` and sent to analytics, so it must
// stay locale-independent — see addLayerMessages.js.
const card = (nameMsg, descMsg, rest) => ({
  name: nameMsg.defaultMessage,
  nameId: nameMsg,
  description: descMsg.defaultMessage,
  descriptionId: descMsg,
  ...rest
});

export const streetLayersData = [
  card(m.createIntersectionName, m.createIntersectionDesc, {
    img: '',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.createIntersection
  }),
  card(m.streetmixStreetName, m.streetmixStreetDesc, {
    img: 'ui_assets/cards/streetmix.jpg',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    handlerFunction: createFunctions.createStreetmixStreet
  }),
  card(m.managedStreetmixName, m.managedStreetmixDesc, {
    img: '',
    icon: 'ui_assets/cards/icons/streetmix24.png',
    handlerFunction: createFunctions.createManagedStreetFromStreetmixURLPrompt
  }),
  card(m.managedStreet4024Name, m.managedStreet4024Desc, {
    img: 'ui_assets/cards/street-preset-40-24.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.create40ftRightOfWayManagedStreet
  }),
  card(m.managedStreet6036Name, m.managedStreet6036Desc, {
    img: 'ui_assets/cards/street-preset-60-36.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.create60ftRightOfWayManagedStreet
  }),
  card(m.managedStreet8056Name, m.managedStreet8056Desc, {
    img: 'ui_assets/cards/street-preset-80-56.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.create80ftRightOfWayManagedStreet
  }),
  card(m.managedStreet9470Name, m.managedStreet9470Desc, {
    img: 'ui_assets/cards/street-preset-94-70.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.create94ftRightOfWayManagedStreet
  }),
  card(m.managedStreet150124Name, m.managedStreet150124Desc, {
    img: 'ui_assets/cards/street-preset-150-124.jpg',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.create150ftRightOfWayManagedStreet
  }),
  card(m.buildingDemoName, m.buildingDemoDesc, {
    img: '',
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.createBuildingDemoManagedStreet
  }),
  card(m.managedStreetplanName, m.managedStreetplanDesc, {
    img: '',
    requiresPro: true,
    icon: '',
    handlerFunction: createFunctions.createManagedStreetFromStreetplanURLPrompt
  })
].map((layer, index) => ({ ...layer, id: index + 1 }));

// A-Frame geometry primitives — host shapes that surface first-class geometry +
// material controls in the properties sidebar (the host-primitive pattern).
export const shapeLayersData = [
  card(m.buildingBoxName, m.buildingBoxDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createBuildingBox
  }),
  card(m.asphaltCircleName, m.asphaltCircleDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createPrimitiveGeometry
  }),
  card(m.grassBoxName, m.grassBoxDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createGrassBox
  }),
  card(m.concreteCylinderName, m.concreteCylinderDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createConcreteCylinder
  }),
  card(m.torusKnotName, m.torusKnotDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createTorusKnot
  }),
  card(m.highlightRingName, m.highlightRingDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createHighlightRing
  })
].map((layer, index) => ({ ...layer, id: index + 1 }));

export const customLayersData = [
  {
    name: 'Tax Parcels Data Layer',
    img: '',
    requiresPro: false,
    icon: '',
    description:
      'ZoningViz POC: interactive tax parcel layer. Hover the map to inspect any parcel (zoning, height limit, redevelopment probability); click to pin details. Requires a scene location and a local ZoningViz server on port 8081.',
    handlerFunction: createFunctions.createParcelDataLayer
  },
  {
    name: 'Zoning Simulation Wizard',
    img: '',
    requiresPro: true,
    icon: '',
    description:
      'ZoningViz POC (Pro): simulate 10–20 years of redevelopment under a zoning scenario for this location and add the resulting buildings to the scene. Requires a local ZoningViz server on port 8081.',
    handlerFunction: createFunctions.openZoningWizard
  },
  card(m.uploadImageName, m.uploadImageDesc, {
    img: '',
    requiresPro: false,
    icon: 'ui_assets/cards/icons/gallery24.png',
    handlerFunction: createFunctions.createImageEntity
  }),
  card(m.uploadModelName, m.uploadModelDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createCustomModel
  }),
  card(m.driveableTukTukName, m.driveableTukTukDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createDriveableTukTuk
  }),
  card(m.driveableDeliveryRobotName, m.driveableDeliveryRobotDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createDriveableDeliveryRobot
  }),
  // Driveable Taxi card intentionally not surfaced yet (model/handling
  // not ready) — the 'taxi' preset, createDriveableTaxi handler, and
  // i18n messages all exist, so restoring it is one card() entry here.
  card(m.raceTargetName, m.raceTargetDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createRaceTarget
  }),
  card(m.trafficReplayName, m.trafficReplayDesc, {
    img: '',
    requiresPro: false,
    icon: 'ui_assets/cards/icons/3dst24.png',
    handlerFunction: createFunctions.createTrafficReplay
  }),
  card(m.uploadSplatName, m.uploadSplatDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createSplatObject
  }),
  card(m.panoramaSphereName, m.panoramaSphereDesc, {
    img: '',
    requiresPro: false,
    icon: '',
    handlerFunction: createFunctions.createPanoramaSphere
  }),
  card(m.svgExtrudedName, m.svgExtrudedDesc, {
    img: '',
    icon: '',
    requiresPro: false,
    handlerFunction: createFunctions.createSvgExtrudedEntity
  })
].map((layer, index) => ({ ...layer, id: index + 1 }));
