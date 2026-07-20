/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';
import { buildStreetShapesData } from '../convertToShapes.js';

/**
 * Convert a managed street into plain, freely-editable entities ("shapes",
 * #1215): bake the live procedural output (segment surfaces, generated
 * clones, stencils, striping, rails, ground) into ordinary entities and strip
 * every managed component. One-way as a workflow — a converted street can't
 * be re-managed — but undoable in-session: undo restores a pre-conversion
 * snapshot via the same serialize/recreate pair the save/load pipeline uses
 * (see StreetReloadCommand).
 */
export class StreetConvertToShapesCommand extends Command {
  constructor(editor, payload = null) {
    super(editor);

    this.type = 'streetconverttoshapes';
    this.name = 'Convert Street to Shapes';
    this.updatable = false;

    if (payload !== null) {
      const entity = payload.entity;
      if (!entity.id) {
        entity.id = createUniqueId();
      }
      this.entityId = entity.id;
      // Standard save-form snapshot (procedural children excluded — they
      // regenerate from component config) for undo...
      this.managedData = STREET.utils.getElementData(entity);
      // ...and the baked plain-entity tree for execute/redo. Both keep the
      // same root id, so restore() can always find the current incarnation.
      this.shapesData = buildStreetShapesData(entity);
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
    return this.restore(this.shapesData, nextCommandCallback);
  }

  undo(nextCommandCallback) {
    return this.restore(this.managedData, nextCommandCallback);
  }
}
