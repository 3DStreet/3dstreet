import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class ComponentAddCommand extends Command {
  constructor(editor, entity, componentName, componentData) {
    super(editor);

    this.type = 'componentadd';
    this.name = 'Add Component';
    this.updatable = false;

    this.entity = entity;
    if (!this.entity.id) {
      this.entity.id = createUniqueId();
    }
    this.componentName = componentName;
    this.componentData = componentData;
  }

  execute() {
    this.entity.setAttribute(this.componentName, this.componentData);
    Events.emit('componentadd', {
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
    this.entity.removeAttribute(this.componentName);
    Events.emit('componentremove', {
      entity: this.entity,
      component: this.componentName
    });
  }
}
