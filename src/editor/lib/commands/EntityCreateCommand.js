import Events from '../Events';
import { Command } from '../command.js';
import { createEntity } from '../entity.js';

/**
 * Helper function to add a new entity with a list of components
 * @param  {object} definition Entity definition to add, only components is required:
 *   {element: 'a-entity', id: "hbiuSdYL2", class: "box", components: {geometry: 'primitive:box'}}
 * @return {Element} Entity created
 */
export class EntityCreateCommand extends Command {
  constructor(editor, definition) {
    super(editor);

    this.type = 'entitycreate';
    this.name = 'Create Entity';
    this.definition = definition;
    this.entityId = null;
  }

  execute() {
    let definition = this.definition;
    const callback = (entity) => {
      this.editor.selectEntity(entity);
    };
    const parentEl =
      this.definition.parentEl ??
      document.querySelector(this.editor.config.defaultParent);
    // If we undo and redo, use the previous id so next redo actions (for example entityupdate to move the position) works correctly
    if (this.entityId) {
      definition = { ...this.definition, id: this.entityId };
    }

    const entity = createEntity(definition, callback, parentEl);
    this.entityId = entity.id;
    return entity;
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
      this.editor.selectEntity(null);
    }
  }
}
