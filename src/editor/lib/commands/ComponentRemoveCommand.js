import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class ComponentRemoveCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'componentremove';
    this.name = 'Remove Component';
    this.updatable = false;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.component = payload.component;

    const component =
      entity.components[payload.component] ??
      AFRAME.components[payload.component];
    this.value = component.isSingleProperty
      ? component.schema.stringify(entity.getAttribute(payload.component))
      : structuredClone(entity.getDOMAttribute(payload.component));
  }

  execute() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.removeAttribute(this.component);
      Events.emit('componentremove', {
        entity,
        component: this.component
      });
    }
  }

  undo() {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.setAttribute(this.component, this.value);
      Events.emit('componentadd', {
        entity,
        component: this.component,
        value: this.value
      });
    }
  }
}
