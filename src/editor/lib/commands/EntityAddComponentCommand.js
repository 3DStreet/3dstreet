import Events from '../Events';
import { Command } from '../command.js';

export class EntityAddComponentCommand extends Command {
  constructor(editor, entity, componentName, componentData) {
    super(editor);

    this.type = 'EntityAddComponentCommand';
    this.name = 'Add Component';
    this.updatable = false;

    this.entity = entity;
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
    this.entity.removeAttribute(this.componentName);
    Events.emit('componentremove', {
      entity: this.entity,
      component: this.componentName
    });
  }
}
