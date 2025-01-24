import Events from '../Events.js';
import { Command } from '../command.js';
import { cloneEntityImpl, createUniqueId } from '../entity.js';

export class EntityCloneCommand extends Command {
  constructor(editor, entity) {
    super(editor);

    this.type = 'entityclone';
    this.name = 'Clone Entity';
    this.updatable = false;
    if (!entity.id) {
      entity.id = createUniqueId(); // if entity to clone doesn't have an id, create one
    }
    this.entityIdToClone = entity.id; // save the id of the entity to clone
    this.entityId = null; // this will be the id of the newly cloned entity
  }

  execute(nextCommandCallback) {
    const entityToClone = document.getElementById(this.entityIdToClone);
    if (entityToClone) {
      const clone = cloneEntityImpl(entityToClone, this.entityId); // why is this.entityId passed? will this always be null?
      this.entityId = clone.id; // use ID set by cloneEntityImpl function
      nextCommandCallback?.(clone);
      return clone;
    }
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
      this.editor.selectEntity(document.getElementById(this.entityIdToClone));
      nextCommandCallback?.(entity);
    }
  }
}
