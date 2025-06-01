import Events from '../Events';
import { Command } from '../command.js';
import { createEntity, createUniqueId } from '../entity.js';

/**
 * @param editor Editor
 * @param definition Entity definition
 * @param callback Optional callback to call after the entity is created,
 *                 get as argument the created entity.
 * @constructor
 */
export class EntityCreateCommand extends Command {
  constructor(editor, definition, callback = undefined) {
    super(editor);

    this.type = 'entitycreate';
    this.name = 'Create Entity';
    this.definition = definition;
    this.callback = callback;
    this.entityId = null;
    // If we have parentEl in the definition, be sure it has an id and store the definition with the id
    if (
      this.definition.parentEl &&
      typeof this.definition.parentEl !== 'string'
    ) {
      if (!this.definition.parentEl.id) {
        this.definition.parentEl.id = createUniqueId();
      }
      this.definition = {
        ...this.definition,
        parentEl: this.definition.parentEl.id
      };
    }
  }

  execute(nextCommandCallback) {
    let definition = this.definition;
    const callback = (entity) => {
      this.editor.selectEntity(entity);
      this.callback?.(entity);
      nextCommandCallback?.(entity);
    };
    let parentEl;
    if (this.definition.parentEl) {
      parentEl = document.getElementById(this.definition.parentEl);
    }
    if (!parentEl) {
      parentEl = document.querySelector(this.editor.config.defaultParent);
    }
    // If we undo and redo, use the previous id so next redo actions (for example entityupdate to move the position) works correctly
    if (this.entityId) {
      definition = { ...this.definition, id: this.entityId };
    }

    const entity = createEntity(definition, callback, parentEl);
    this.entityId = entity.id;
    return entity;
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
      this.editor.selectEntity(null);
      nextCommandCallback?.(entity);
    }
  }
}
