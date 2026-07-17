/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

/**
 * Reload a managed street from its source (Streetmix/StreetPlan URL or
 * json-blob), replacing all segments. Undo restores a pre-reload snapshot of
 * the whole street entity via the same serialize/recreate pair the save/load
 * pipeline uses (see EntityReparentCommand).
 */
export class StreetReloadCommand extends Command {
  constructor(editor, payload = null) {
    super(editor);

    this.type = 'streetreload';
    this.name = 'Reload Street from Source';
    this.updatable = false;

    if (payload !== null) {
      const entity = payload.entity;
      if (!entity.id) {
        entity.id = createUniqueId();
      }
      this.entityId = entity.id;
      this.oldData = STREET.utils.getElementData(entity);
      // Captured lazily on first undo so redo can restore the reloaded state
      // without refetching from the network.
      this.newData = null;
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
    // Redo path: restore the captured post-reload state instead of refetching
    if (this.newData) {
      return this.restore(this.newData, nextCommandCallback);
    }

    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    entity.components['managed-street']?.refreshFromSource();
    nextCommandCallback?.(entity);
    return entity;
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    if (!this.newData) {
      this.newData = STREET.utils.getElementData(entity);
    }
    return this.restore(this.oldData, nextCommandCallback);
  }
}
