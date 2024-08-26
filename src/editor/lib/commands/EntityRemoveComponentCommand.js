import Events from '../Events';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class EntityRemoveComponentCommand extends Command {
  constructor(editor, entity, componentName) {
    super(editor);

    this.type = 'EntityRemoveComponentCommand';
    this.name = 'Remove Component';
    this.updatable = false;

    this.entity = entity;
    if (!this.entity.id) {
      this.entity.id = createUniqueId();
    }
    this.componentName = componentName;
    this.componentData = entity.getAttribute(componentName);
  }

  execute() {
    this.entity.removeAttribute(this.componentName);
    Events.emit('componentremove', {
      entity: this.entity,
      component: this.componentName
    });
  }

  undo() {
    // Get again the entity from id, the entity may have been recreated if it was removed then undone.
    const entity = document.getElementById(this.entity.id);
    if (this.entity !== entity) {
      this.entity = entity;
    }
    this.entity.setAttribute(this.componentName, this.componentData);
    Events.emit('componentadd', {
      entity: this.entity,
      component: this.componentName
    });
  }
}
