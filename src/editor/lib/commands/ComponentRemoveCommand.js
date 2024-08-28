import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class ComponentRemoveCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'componentremove';
    this.name = 'Remove Component';
    this.updatable = false;

    this.entity = payload.entity;
    if (!this.entity.id) {
      this.entity.id = createUniqueId();
    }
    this.component = payload.component;
    this.value = this.entity.getAttribute(this.component);
  }

  execute() {
    this.entity.removeAttribute(this.component);
    Events.emit('componentremove', {
      entity: this.entity,
      component: this.component
    });
  }

  undo() {
    // Get again the entity from id, the entity may have been recreated if it was removed then undone.
    const entity = document.getElementById(this.entity.id);
    if (this.entity !== entity) {
      this.entity = entity;
    }
    this.entity.setAttribute(this.component, this.value);
    Events.emit('componentadd', {
      entity: this.entity,
      component: this.component,
      value: this.value
    });
  }
}
