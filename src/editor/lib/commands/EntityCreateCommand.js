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
    const definition = this.definition;
    const callback = (entity) => {
      this.editor.selectEntity(entity);
    };
    const parentEl =
      this.definition.parentEl ?? document.querySelector('#street-container');
    const entity = createEntity(definition, callback, parentEl);
    this.entityId = entity.id;
    return entity;
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      this.editor.selectEntity(null);
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
    }
  }
}
