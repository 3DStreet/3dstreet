import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class EntityRenameCommand extends Command {
  constructor(editor, entity) {
    super(editor);

    this.type = 'entityrename';
    this.name = 'Rename Entity';
    this.updatable = true; // Allow updating for consecutive renames

    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.oldName = entity.getAttribute('data-layer-name') || '';
    this.newName = null; // Will be set during execute
  }

  execute() {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    // If newName hasn't been set (first execution), prompt for it
    if (this.newName === null) {
      const promptedName = prompt('Enter new name for entity', this.oldName);
      // If user cancels or enters empty name, abort
      if (!promptedName) return;
      this.newName = promptedName;
    }

    // Apply the new name
    entity.setAttribute('data-layer-name', this.newName);
    Events.emit('entityrenamed', {
      entity,
      oldName: this.oldName,
      newName: this.newName
    });
    AFRAME.INSPECTOR.selectEntity(entity);
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      // Restore the old name
      entity.setAttribute('data-layer-name', this.oldName);
      Events.emit('entityrenamed', {
        entity,
        oldName: this.newName,
        newName: this.oldName
      });
      AFRAME.INSPECTOR.selectEntity(entity);
    }
  }

  update(command) {
    // Handle consecutive renames by updating the newName
    this.newName = command.newName;
  }
}
