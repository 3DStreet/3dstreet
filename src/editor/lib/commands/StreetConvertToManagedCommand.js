/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.jsx';

/**
 * Convert a legacy `street` + `streetmix-loader` street into a managed street
 * (#1720 §4). Saved legacy streets never persist their Streetmix JSON, so the
 * managed street re-fetches from the loader's Streetmix URL: the result is the
 * street as it is on Streetmix today. Root transform, layer name and content
 * toggles carry over; edits made inside the legacy street do not. Undo
 * restores the legacy snapshot via the serialize/recreate pair the save/load
 * pipeline uses (see StreetConvertToShapesCommand).
 */
export class StreetConvertToManagedCommand extends Command {
  constructor(editor, payload = null) {
    super(editor);

    this.type = 'streetconverttomanaged';
    this.name = 'Convert Street to Managed Street';
    this.updatable = false;

    if (payload !== null) {
      const entity = payload.entity;
      if (!entity.id) {
        entity.id = createUniqueId();
      }
      this.entityId = entity.id;
      this.legacyData = STREET.utils.getElementData(entity);
      // Same root id as the legacy street, so restore() always finds the
      // current incarnation.
      this.managedData = buildManagedStreetData(entity, this.legacyData);
    }
  }

  restore(data, nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    const parent = entity.parentNode;
    const beforeEl = entity.nextElementSibling;
    parent.removeChild(entity);

    // Deep-clone because createEntityFromObj mutates the data
    const entityData = JSON.parse(JSON.stringify(data));
    const recreatedEntity = STREET.utils.createEntityFromObj(
      entityData,
      parent,
      beforeEl
    );

    recreatedEntity.addEventListener(
      'loaded',
      () => {
        recreatedEntity.pause();

        Events.emit('entityremoved', entity);
        Events.emit('entitycreated', recreatedEntity);

        this.editor.selectEntity(recreatedEntity);

        nextCommandCallback?.(recreatedEntity);
      },
      { once: true }
    );

    return recreatedEntity;
  }

  execute(nextCommandCallback) {
    return this.restore(this.managedData, nextCommandCallback);
  }

  undo(nextCommandCallback) {
    return this.restore(this.legacyData, nextCommandCallback);
  }
}

// The Streetmix page URL a legacy street was loaded from, or '' when it has
// none (template, JSON import, pre-loader scenes) and so cannot be converted.
export function getLegacyStreetmixURL(entity) {
  const loader = entity.getAttribute('streetmix-loader');
  return loader?.streetmixStreetURL || '';
}

// The legacy street's total width in meters, read from the parser's
// `.street-parent` offset (it is shifted left by half the width).
export function getLegacyStreetWidth(entity) {
  const streetParent = entity.querySelector(':scope > .street-parent');
  if (!streetParent) return null;
  return -streetParent.getAttribute('position').x * 2;
}

// Managed-street save form for the converted street. Transform and
// visibility come from the legacy snapshot as serialized; the managed loader
// names the layer from the fetched street.
function buildManagedStreetData(entity, legacyData) {
  const street = entity.getAttribute('street') || {};
  const loader = entity.getAttribute('streetmix-loader') || {};
  const components = {
    'managed-street': {
      sourceType: 'streetmix-url',
      sourceValue: getLegacyStreetmixURL(entity),
      length: street.length ?? 60,
      showBoundaries: loader.showBuildings ?? true,
      showGround: street.showGround ?? true,
      showStriping: street.showStriping ?? true,
      showVehicles: street.showVehicles ?? true,
      synchronize: true
    }
  };
  for (const name of ['position', 'rotation', 'scale', 'visible']) {
    if (name in legacyData.components) {
      components[name] = legacyData.components[name];
    }
  }
  return { id: entity.id, components };
}
