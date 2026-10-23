/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.jsx';

/**
 * Removes a street-segment from a managed-street and serializes it for undo.
 *
 * payload: { entity, name? }
 *   - entity: the street-segment DOM element to remove
 *   - name: optional history label (e.g. "Remove bike lane")
 */
export class SegmentRemoveCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'segmentremove';
    this.name = payload.name || 'Remove Segment';
    this.updatable = false;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.parentId = entity.parentNode?.id;
    this.indexInParent = Array.from(entity.parentNode.children).indexOf(entity);

    // Serialize using the save/load pipeline format so we can recreate
    // losslessly on undo (matches EntityReparentCommand). getElementData reads
    // live component data via getAttribute, so flushToDOM is not needed.
    this.entityData = STREET.utils.getElementData(entity);
  }

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;
    entity.parentNode.removeChild(entity);
    Events.emit('entityremoved', entity);
    if (this.editor.selectedEntity === entity) {
      this.editor.selectEntity(null);
    }
    nextCommandCallback?.(null);
  }

  undo(nextCommandCallback) {
    const parent = document.getElementById(this.parentId);
    if (!parent) {
      console.error(
        `[segmentremove] parent ${this.parentId} not found on undo`
      );
      return;
    }

    const beforeEl =
      this.indexInParent >= 0 && this.indexInParent < parent.children.length
        ? parent.children[this.indexInParent]
        : null;

    // Deep-clone because createEntityFromObj mutates the data
    const entityData = structuredClone(this.entityData);
    const recreated = STREET.utils.createEntityFromObj(
      entityData,
      parent,
      beforeEl
    );

    recreated.addEventListener(
      'loaded',
      () => {
        Events.emit('entitycreated', recreated);
        this.editor.selectEntity(recreated);
        nextCommandCallback?.(recreated);
      },
      { once: true }
    );
  }
}
