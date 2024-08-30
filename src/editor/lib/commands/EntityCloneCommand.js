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
      entity.id = createUniqueId();
    }
    this.entityIdToClone = entity.id;
    this.entityId = null;
  }

  execute() {
    const entityToClone = document.getElementById(this.entityIdToClone);
    if (entityToClone) {
      const clone = cloneEntityImpl(entityToClone, this.entityId);
      this.entityId = clone.id;
      return clone;
    }
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
      this.editor.selectEntity(document.getElementById(this.entityIdToClone));
    }
  }
}
