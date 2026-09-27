// Per-entity street-segment / managed-street migrations, applied over a
// saved-scene entity tree. The value-level conversions live in
// src/tested/street-segment-utils.js (shared with the json-blob importer);
// this module only walks the tree and applies them in the right order.
//
// - street-segment used to store its vertical offset as an integer `level`
//   (1 level == 0.15m curb height); the current schema only knows metric
//   `elevation`. Without this conversion A-Frame drops the unknown property
//   and raised segments (e.g. sidewalks) would load flush with the road.
// - `type: building` was renamed to `type: boundary` (and the managed-street
//   `showBuildings` toggle to `showBoundaries`).
// - `surface: hatched` became a street-generated-striping treatment (#1728);
//   the migration touches the whole components object because it also adds
//   the striping component.
// - street-generated-pedestrians lost its own `direction` (walks in the
//   segment direction instead).
import {
  migrateSegmentLevelToElevation,
  migrateSegmentBuildingType,
  migrateSegmentHatchedSurface,
  migratePedestriansDirection,
  migrateShowBuildingsFlag
} from '../../tested/street-segment-utils.js';
import { walkEntities } from './style.js';

/** Mutates the saved-scene entity tree in place; returns the tree. */
export function migrateStreetSegments(entitiesData) {
  walkEntities(entitiesData, (node) => {
    const components = node.components;
    if (!components) return;
    if (components['street-segment']) {
      components['street-segment'] = migrateSegmentBuildingType(
        migrateSegmentLevelToElevation(components['street-segment'])
      );
      migrateSegmentHatchedSurface(components);
      migratePedestriansDirection(components);
    }
    if (components['managed-street']) {
      components['managed-street'] = migrateShowBuildingsFlag(
        components['managed-street']
      );
    }
  });
  return entitiesData;
}
