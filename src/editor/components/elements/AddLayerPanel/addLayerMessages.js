import { defineMessages } from 'react-intl';

/**
 * i18n for the Add Layer Panel.
 *
 * The panel is "populated" from two different sources, which need two
 * different localization strategies:
 *
 * 1. STATIC cards (Streets/Intersections, Shapes, Custom Layers) and the tab
 *    labels are hardcoded in `layersData.js` / `LayersOptions.js`. Their English
 *    text lives here in `defineMessages`, so `npm run i18n:extract` picks it up
 *    automatically and `npm run i18n:translate` fills the other catalogs. The
 *    data modules derive their canonical English `name`/`description` from these
 *    defaultMessages (see below) — a single source of truth.
 *
 * 2. CATALOG cards (Vehicles, Plants, Signs, …) are generated at runtime from
 *    `catalog.json` via `getGroupedMixinOptions()`. There is no literal string
 *    in the source for the extractor to see, so these are resolved by a dynamic
 *    id — `catalog.<mixinId>.name` / `catalog.<mixinId>.description` — with the
 *    English catalog value as the `defaultMessage` fallback. Until those keys
 *    are seeded into the catalogs (see `scripts/i18n/extract-catalog.mjs`, which
 *    walks catalog.json), react-intl falls back to English and the swallowed
 *    MISSING_TRANSLATION warning is a no-op.
 *
 * IMPORTANT: localization here is presentation-only. The English `name` is also
 * written to `data-layer-name` (saved into the scene JSON) and sent to
 * analytics, so it must stay stable and locale-independent. Only the text shown
 * on the card / in its hover tooltip is translated.
 */

// Tab labels — keyed by the `value` field in LayersOptions.js. Emoji are kept in
// the defaultMessage so translators only touch the word.
export const layerTabMessages = defineMessages({
  'Streets and Intersections': {
    id: 'addLayer.tab.streets',
    defaultMessage: '🚦 Streets'
  },
  'Traffic Control': {
    id: 'addLayer.tab.trafficControl',
    defaultMessage: '🚧 Control'
  },
  Signs: { id: 'addLayer.tab.signs', defaultMessage: '🚸 Signs' },
  Plants: { id: 'addLayer.tab.plants', defaultMessage: '🌿 Plants' },
  Fixtures: { id: 'addLayer.tab.fixtures', defaultMessage: '🚏 Fixtures' },
  People: { id: 'addLayer.tab.people', defaultMessage: '🚶 People' },
  Bicycles: { id: 'addLayer.tab.bicycles', defaultMessage: '🚲 Bicycles' },
  Vehicles: { id: 'addLayer.tab.vehicles', defaultMessage: '🚗 Vehicles' },
  Buildings: { id: 'addLayer.tab.buildings', defaultMessage: '🏠 Buildings' },
  Shapes: { id: 'addLayer.tab.shapes', defaultMessage: '🔵 Shapes' },
  'Custom Layers': { id: 'addLayer.tab.custom', defaultMessage: '⚙️ Custom' }
});

// Static card name/description strings. Keyed by a stable slug that the card in
// `layersData.js` references via `nameId`/`descriptionId`.
export const layerCardMessages = defineMessages({
  // --- Streets and Intersections ---
  createIntersectionName: {
    id: 'addLayer.card.createIntersection.name',
    defaultMessage: 'Create Intersection'
  },
  createIntersectionDesc: {
    id: 'addLayer.card.createIntersection.desc',
    defaultMessage: 'Create 90º intersection entity.'
  },
  streetmixStreetName: {
    id: 'addLayer.card.streetmixStreet.name',
    defaultMessage: 'Street from Streetmix URL'
  },
  streetmixStreetDesc: {
    id: 'addLayer.card.streetmixStreet.desc',
    defaultMessage:
      'Create an additional Streetmix street in your 3DStreet scene without replacing any existing streets.'
  },
  managedStreetmixName: {
    id: 'addLayer.card.managedStreetmix.name',
    defaultMessage: '(Beta) Managed Street from Streetmix URL'
  },
  managedStreetmixDesc: {
    id: 'addLayer.card.managedStreetmix.desc',
    defaultMessage:
      'Create a new street from Streetmix URL using the Managed Street component.'
  },
  managedStreet4024Name: {
    id: 'addLayer.card.managedStreet4024.name',
    defaultMessage: '(Beta) Managed Street 40ft RoW / 24ft Roadway Width'
  },
  managedStreet4024Desc: {
    id: 'addLayer.card.managedStreet4024.desc',
    defaultMessage: 'Premade Street 40ft Right of Way / 24ft Roadway Width'
  },
  managedStreet6036Name: {
    id: 'addLayer.card.managedStreet6036.name',
    defaultMessage: '(Beta) Managed Street 60ft RoW / 36ft Roadway Width'
  },
  managedStreet6036Desc: {
    id: 'addLayer.card.managedStreet6036.desc',
    defaultMessage: 'Premade Street 60ft Right of Way / 36ft Roadway Width'
  },
  managedStreet8056Name: {
    id: 'addLayer.card.managedStreet8056.name',
    defaultMessage: '(Beta) Managed Street 80ft RoW / 56ft Roadway Width'
  },
  managedStreet8056Desc: {
    id: 'addLayer.card.managedStreet8056.desc',
    defaultMessage: 'Premade Street 80ft Right of Way / 56ft Roadway Width'
  },
  managedStreet9470Name: {
    id: 'addLayer.card.managedStreet9470.name',
    defaultMessage: '(Beta) Managed Street 94ft RoW / 70ft Roadway Width'
  },
  managedStreet9470Desc: {
    id: 'addLayer.card.managedStreet9470.desc',
    defaultMessage: 'Premade Street 94ft Right of Way / 70ft Roadway Width'
  },
  managedStreet150124Name: {
    id: 'addLayer.card.managedStreet150124.name',
    defaultMessage: '(Beta) Managed Street 150ft RoW / 124ft Roadway Width'
  },
  managedStreet150124Desc: {
    id: 'addLayer.card.managedStreet150124.desc',
    defaultMessage: 'Premade Street 150ft Right of Way / 124ft Roadway Width'
  },
  buildingDemoName: {
    id: 'addLayer.card.buildingDemo.name',
    defaultMessage: '(Beta) Building Placement Demo'
  },
  buildingDemoDesc: {
    id: 'addLayer.card.buildingDemo.desc',
    defaultMessage:
      'Demo street with buildings on both sides using the new fit mode for building placement'
  },
  managedStreetplanName: {
    id: 'addLayer.card.managedStreetplan.name',
    defaultMessage: '(Beta) Managed Street from Streetplan URL'
  },
  managedStreetplanDesc: {
    id: 'addLayer.card.managedStreetplan.desc',
    defaultMessage:
      'Create a new street from Streetplan URL using the Managed Street component.'
  },

  // --- Shapes ---
  buildingBoxName: {
    id: 'addLayer.card.buildingBox.name',
    defaultMessage: 'Building Box'
  },
  buildingBoxDesc: {
    id: 'addLayer.card.buildingBox.desc',
    defaultMessage:
      'Add a simple box roughly the size of a 3-story building, sitting on the ground in a bright blue. A quick placeholder for blocking out buildings.'
  },
  asphaltCircleName: {
    id: 'addLayer.card.asphaltCircle.name',
    defaultMessage: 'Asphalt Circle'
  },
  asphaltCircleDesc: {
    id: 'addLayer.card.asphaltCircle.desc',
    defaultMessage:
      'Add a large flat asphalt circle on the ground. Geometry and material can be changed in the properties panel.'
  },
  grassBoxName: {
    id: 'addLayer.card.grassBox.name',
    defaultMessage: 'Grass Box'
  },
  grassBoxDesc: {
    id: 'addLayer.card.grassBox.desc',
    defaultMessage:
      'Add a large green ground slab with animated instanced grass. The box dimensions, color, and grass options (density, blade height) are all editable in the properties panel.'
  },
  concreteCylinderName: {
    id: 'addLayer.card.concreteCylinder.name',
    defaultMessage: 'Concrete Cylinder'
  },
  concreteCylinderDesc: {
    id: 'addLayer.card.concreteCylinder.desc',
    defaultMessage:
      'Add a gray concrete cylinder roughly the size of an interstate highway support pillar. A quick placeholder for elevated-roadway columns.'
  },
  torusKnotName: {
    id: 'addLayer.card.torusKnot.name',
    defaultMessage: 'Torus Knot'
  },
  torusKnotDesc: {
    id: 'addLayer.card.torusKnot.desc',
    defaultMessage:
      'Add a polished metallic torus knot. A decorative primitive that shows off the geometry and material (metalness/roughness) controls in the properties panel.'
  },
  highlightRingName: {
    id: 'addLayer.card.highlightRing.name',
    defaultMessage: 'Highlight Ring'
  },
  highlightRingDesc: {
    id: 'addLayer.card.highlightRing.desc',
    defaultMessage:
      'Add a bright red ring, big enough to circle and highlight a real-world element like a vehicle, tree, or part of a lane.'
  },

  // --- Custom Layers ---
  uploadImageName: {
    id: 'addLayer.card.uploadImage.name',
    defaultMessage: 'Upload Image'
  },
  uploadImageDesc: {
    id: 'addLayer.card.uploadImage.desc',
    defaultMessage:
      'Upload an image (sign, reference photo, custom map, etc.) from your device and place it in the scene.'
  },
  uploadModelName: {
    id: 'addLayer.card.uploadModel.name',
    defaultMessage: 'Upload 3D Model'
  },
  uploadModelDesc: {
    id: 'addLayer.card.uploadModel.desc',
    defaultMessage:
      'Upload a glTF or GLB model from your device. It is rendered immediately and saved to your asset library.'
  },
  driveableTukTukName: {
    id: 'addLayer.card.driveableTukTuk.name',
    defaultMessage: 'Driveable Tuk-tuk'
  },
  driveableTukTukDesc: {
    id: 'addLayer.card.driveableTukTuk.desc',
    defaultMessage:
      'A small three-wheeler-style driveable vehicle with the tuk-tuk catalog mesh. Can mount curbs at speed. Switch presets from the drive-controls properties panel.'
  },
  driveableDeliveryRobotName: {
    id: 'addLayer.card.driveableDeliveryRobot.name',
    defaultMessage: 'Driveable Delivery Robot'
  },
  driveableDeliveryRobotDesc: {
    id: 'addLayer.card.driveableDeliveryRobot.desc',
    defaultMessage:
      'A small-chassis driveable bot (~Starship/Serve-sized) with a procedural mesh + dynamic antenna. Like real delivery robots, it cannot mount standard 6" curbs. Switch presets from the drive-controls properties panel.'
  },
  driveableTaxiName: {
    id: 'addLayer.card.driveableTaxi.name',
    defaultMessage: 'Driveable Taxi'
  },
  driveableTaxiDesc: {
    id: 'addLayer.card.driveableTaxi.desc',
    defaultMessage:
      'A full-size sedan with real-car physics (~Camry-sized). Mounts standard curbs with momentum, hits real-world speeds. Switch presets from the drive-controls properties panel.'
  },
  raceTargetName: {
    id: 'addLayer.card.raceTarget.name',
    defaultMessage: 'Race Target'
  },
  raceTargetDesc: {
    id: 'addLayer.card.raceTarget.desc',
    defaultMessage:
      'A finish-line gate. Driving the player vehicle through it during play ends the race, pauses the simulation, and pins the finish time in the toolbar.'
  },
  uploadSplatName: {
    id: 'addLayer.card.uploadSplat.name',
    defaultMessage: 'Upload Gaussian Splat'
  },
  uploadSplatDesc: {
    id: 'addLayer.card.uploadSplat.desc',
    defaultMessage:
      'Upload a Gaussian Splat (.splat, .ply, .spz, .rad) from your device and place it in the scene.'
  },
  panoramaSphereName: {
    id: 'addLayer.card.panoramaSphere.name',
    defaultMessage: '360° Panorama Sphere'
  },
  panoramaSphereDesc: {
    id: 'addLayer.card.panoramaSphere.desc',
    defaultMessage:
      'Create an immersive 360° environment from a panoramic image for AR/VR experiences.'
  },
  svgExtrudedName: {
    id: 'addLayer.card.svgExtruded.name',
    defaultMessage: 'Entity from extruded SVG'
  },
  svgExtrudedDesc: {
    id: 'addLayer.card.svgExtruded.desc',
    defaultMessage:
      'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.'
  }
});

/**
 * Resolves the display name + description for an Add Layer card in the active
 * locale, without disturbing the canonical English `name` used for
 * `data-layer-name` / analytics.
 *
 * - Static cards carry `nameId`/`descriptionId` message descriptors.
 * - Catalog-driven cards (with a `mixinId`) are looked up by dynamic id, falling
 *   back to the English catalog text.
 */
export function localizeCard(intl, card) {
  let name = card.name;
  let description = card.description;

  if (card.nameId) {
    name = intl.formatMessage(card.nameId);
  } else if (card.mixinId) {
    name = intl.formatMessage({
      id: `catalog.${card.mixinId}.name`,
      defaultMessage: card.name || card.mixinId
    });
  }

  if (card.descriptionId) {
    description = intl.formatMessage(card.descriptionId);
  } else if (card.mixinId && card.description) {
    description = intl.formatMessage({
      id: `catalog.${card.mixinId}.description`,
      defaultMessage: card.description
    });
  }

  return { name, description };
}

/**
 * Resolves the localized tab label for a LayersOptions entry, falling back to
 * the hardcoded English label if no message is defined for its value.
 */
export function localizeTabLabel(intl, option) {
  const message = layerTabMessages[option.value];
  return message ? intl.formatMessage(message) : option.label;
}
