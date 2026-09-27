// Scene-load migrations for saved 3DStreet scene JSON.
//
// Every saved scene passes through `migrateSceneJSON` once, before any entity
// is minted, so components (and any open editor panel) only ever see current
// values and the next save writes the migrated form. Pasted entity data
// (clipboard text from a tab on an older build) passes through
// `migrateEntityData`. Undo/redo, reparent and reload round-trips serialize
// live, already-migrated entities and do not migrate again.
//
// All migrations are pure, mutate the JSON in place, and are idempotent:
// there is no version gate (`version` in the saved file is written but never
// read), so each one must be a no-op on already-migrated data. Keep them
// AFRAME-free (see ./style.js) so they stay unit-testable in jsdom.
//
// Adding a migration: write it as its own module here with a test in
// test/editor/sceneMigrations.test.js, then register it below. Entity-tree
// migrations (anything a user could paste) go in `migrateEntityData`;
// scene-level ones (memory, the geo layer, the user layers root) in
// `migrateSceneJSON`.
import { migrateLegacyFlatteningShape } from './flattening-shape.js';
import { migrateMeasureLinesToShapes } from './measure-lines.js';
import { migrateImplicitStreetAlign } from './street-align.js';
import { migrateStreetGeo } from './street-geo.js';
import { migrateCameraRig } from './camera-rig.js';
import { migrateStreetSegments } from './street-segments.js';
import { migrateDefaultSnapshotToViewerStart } from './viewer-start.js';

const USER_LAYERS_ROOT_ID = 'street-container';

// Never apply a saved visible:false to the User Layers root. Some older
// scenes were saved with it (an old UI exposed an eye toggle on the
// container), which blanks the whole scene on load; and because the
// singleton #street-container element is reused across loads, it then
// blanks every scene loaded after it in the same session. Container
// visibility is session UI state, not scene data: ignored here, stripped
// on save (convertDOMElToObject), healed by newScene (street-utils.js).
function stripUserLayersRootVisibility(entitiesData) {
  if (!Array.isArray(entitiesData)) return;
  for (const entityData of entitiesData) {
    if (entityData?.id === USER_LAYERS_ROOT_ID && entityData.components) {
      delete entityData.components.visible;
    }
  }
}

/**
 * Migrate an entity tree (the saved `data` array, or `[entityData]` for a
 * pasted entity). Mutates in place and returns the same array.
 */
export function migrateEntityData(entitiesData) {
  if (!Array.isArray(entitiesData)) return entitiesData;
  migrateMeasureLinesToShapes(entitiesData);
  migrateImplicitStreetAlign(entitiesData);
  migrateCameraRig(entitiesData);
  migrateStreetSegments(entitiesData);
  return entitiesData;
}

/**
 * Migrate a whole saved scene (`{ data, memory, ... }`) in place.
 * @returns {{ viewerStartMigrated: boolean }} the flag the scene carries from
 *   now on (mirror it into the store so the save path writes it back).
 */
export function migrateSceneJSON(sceneJSON) {
  const data = sceneJSON?.data;
  const memory = sceneJSON?.memory;
  const viewerStart = migrateDefaultSnapshotToViewerStart(data, memory);
  if (viewerStart.migrated) {
    console.log(
      '[migration] default snapshot pose → Starting View entity (viewer-start)'
    );
  }
  migrateLegacyFlatteningShape(data);
  migrateEntityData(data);
  migrateStreetGeo(data);
  stripUserLayersRootVisibility(data);
  return { viewerStartMigrated: viewerStart.viewerStartMigrated };
}

export {
  migrateLegacyFlatteningShape,
  migrateMeasureLinesToShapes,
  migrateImplicitStreetAlign,
  migrateStreetGeo,
  migrateCameraRig,
  migrateStreetSegments,
  migrateDefaultSnapshotToViewerStart
};
