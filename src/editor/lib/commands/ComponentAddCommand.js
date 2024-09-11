import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class ComponentAddCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'componentadd';
    this.name = 'Add Component';
    this.updatable = false;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.component = payload.component;
    this.value = payload.value;
  }

  execute() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.setAttribute(this.component, this.value);
      Events.emit('componentadd', {
        entity: entity,
        component: this.component,
        value: this.value
      });
    }
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.removeAttribute(this.component);
      Events.emit('componentremove', {
        entity,
        component: this.component
      });
    }
  }
}
