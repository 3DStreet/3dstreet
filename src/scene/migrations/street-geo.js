// Legacy street-geo migrations, applied to the saved data before the entity
// is minted so the component (and any open editor panel) only ever sees
// migrated values.
import { parseStyle, walkEntities, writeBack } from './style.js';

const BLEND_MODE_OPACITY = {
  '30% Opacity': 30,
  '60% Opacity': 60
};

/**
 * Mutates the saved-scene entity tree in place. Returns the number of
 * street-geo entries rewritten.
 *
 * - The layer's visibility used to be toggled via the entity's `visible`
 *   attribute. The sidepanel now exposes this through the map type
 *   ("No Map" = off), so a hidden geo entity becomes `maps: none`.
 * - `blendingEnabled` / `blendMode` presets → `opacity` (#1738). Only google3d
 *   ever rendered blending, but switching map type never reset the flag, so
 *   scenes saved on other map types can carry a stale `blendingEnabled: true`
 *   — those migrate to the (default) full opacity. The non-opacity modes
 *   (Darker/Lighter) were broken in practice and are dropped.
 * - The single-plane `mapbox2d` layer was replaced by the tiled 2D basemap
 *   (#1962 step C); scenes saved on it load (and re-save) as `tiles2d`.
 */
export function migrateStreetGeo(entitiesData) {
  let rewritten = 0;
  walkEntities(entitiesData, (node) => {
    const components = node.components;
    const geoVal = components?.['street-geo'];
    if (geoVal === undefined || geoVal === null) return;
    const parsed = parseStyle(geoVal);
    let changed = false;

    if (components.visible === false || components.visible === 'false') {
      parsed.maps = 'none';
      delete components.visible;
      changed = true;
    }

    if ('blendingEnabled' in parsed || 'blendMode' in parsed) {
      const enabled =
        parsed.blendingEnabled === true || parsed.blendingEnabled === 'true';
      if (
        enabled &&
        (parsed.maps ?? 'google3d') === 'google3d' &&
        parsed.opacity === undefined
      ) {
        parsed.opacity =
          BLEND_MODE_OPACITY[parsed.blendMode ?? '30% Opacity'] ?? 100;
      }
      delete parsed.blendingEnabled;
      delete parsed.blendMode;
      changed = true;
    }

    if (parsed.maps === 'mapbox2d') {
      parsed.maps = 'tiles2d';
      changed = true;
    }

    if (changed) {
      components['street-geo'] = writeBack(geoVal, parsed);
      rewritten++;
    }
  });
  return rewritten;
}
