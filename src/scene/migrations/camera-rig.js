// Components removed alongside the legacy viewer mode. Stripped from a saved
// cameraRig entry on load so old scenes still open; re-save drops them.
// Scoped to the cameraRig — the only entity legacy saves wrote them to — so a
// user-authored entity carrying e.g. look-controls is not silently stripped.
import { walkEntities } from './style.js';

export const LEGACY_STRIPPED_COMPONENTS = [
  'viewer-mode',
  'cursor-teleport',
  'movement-controls',
  'look-controls',
  'hand-controls',
  'blink-controls'
];

/**
 * Mutates the saved-scene entity tree in place. Returns the number of legacy
 * components removed.
 */
export function migrateCameraRig(entitiesData) {
  let stripped = 0;
  walkEntities(entitiesData, (node) => {
    if (node.id !== 'cameraRig' || !node.components) return;
    for (const legacy of LEGACY_STRIPPED_COMPONENTS) {
      if (legacy in node.components) {
        delete node.components[legacy];
        stripped++;
      }
    }
  });
  return stripped;
}
