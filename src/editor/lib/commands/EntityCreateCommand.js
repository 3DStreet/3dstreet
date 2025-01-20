import Events from '../Events';
import { Command } from '../command.js';
import { createEntity } from '../entity.js';

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
      if (typeof this.definition.parentEl === 'string') {
        parentEl = document.getElementById(this.definition.parentEl);
      } else {
        parentEl = this.definition.parentEl;
      }
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
