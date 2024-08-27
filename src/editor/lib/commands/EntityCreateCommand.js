import Events from '../Events';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

const NOT_COMPONENTS = ['id', 'class', 'mixin'];

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
    this.entity = null;
  }

  execute() {
    const definition = this.definition;
    this.entity = document.createElement(definition.element || 'a-entity');
    const entity = this.entity;

    // Set id
    if (definition.id) {
      entity.id = definition.id;
    } else {
      this.entity.id = createUniqueId();
    }

    // Set class, mixin
    for (const attribute of NOT_COMPONENTS) {
      if (attribute !== 'id' && definition[attribute]) {
        entity.setAttribute(attribute, definition[attribute]);
      }
    }

    // Set data attributes
    for (const key in definition) {
      if (key.startsWith('data-')) {
        entity.setAttribute(key, definition[key]);
      }
    }

    // Set components
    for (const componentName in definition.components) {
      const componentValue = definition.components[componentName];
      entity.setAttribute(componentName, componentValue);
    }

    // Emit event after entity is loaded
    this.entity.addEventListener(
      'loaded',
      () => {
        this.editor.selectEntity(this.entity);
        Events.emit('entitycreated', this.entity);
      },
      { once: true }
    );

    // Add to parentEl if defined of fallback to scene container
    const parentEl =
      this.definition.parentEl ?? document.querySelector('#street-container');
    parentEl.appendChild(this.entity);
    return entity;
  }

  undo() {
    if (this.entity) {
      this.editor.selectEntity(null);
      this.editor.removeObject(this.entity.object3D);
      this.entity.parentNode.removeChild(this.entity);
      Events.emit('entityremoved', this.entity);
      this.entity = null;
    }
  }
}
