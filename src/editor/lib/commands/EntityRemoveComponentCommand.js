import Events from '../Events';
import { Command } from '../command.js';

export class EntityRemoveComponentCommand extends Command {
  constructor(editor, entity, componentName) {
    super(editor);

    this.type = 'EntityRemoveComponentCommand';
    this.name = 'Remove Component';
    this.updatable = false;

    this.entity = entity;
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
    this.entity.setAttribute(this.componentName, this.componentData);
    Events.emit('componentadd', {
      entity: this.entity,
      component: this.componentName
    });
  }
}
