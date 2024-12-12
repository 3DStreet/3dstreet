import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class EntityRenameCommand extends Command {
  constructor(editor, entity) {
    super(editor);

    this.type = 'entityrename';
    this.name = 'Rename Entity';
    this.updatable = false;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityIdToRename = entity.id;
    this.entityId = null;
  }

  execute() {
    const entityToRename = document.getElementById(this.entityIdToRename);
    // prompt for new name
    const newName = prompt(
      'Enter new name for entity',
      entityToRename.getAttribute('data-layer-name')
    );

    if (entityToRename && newName) {
      entityToRename.setAttribute('data-layer-name', newName);
    }
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      // entity.parentNode.removeChild(entity);
      // Events.emit('entityremoved', entity);
      // this.editor.selectEntity(document.getElementById(this.entityIdToClone));
      console.log('cannot undo rename');
    }
  }
}
