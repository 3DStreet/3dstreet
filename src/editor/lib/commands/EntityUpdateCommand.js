import Events from '../Events';
import { Command } from '../command.js';

function updateEntity(entity, component, property, value) {
  if (property) {
    if (value === null || value === undefined) {
      // Remove property.
      entity.removeAttribute(component, property);
    } else {
      // Set property.
      entity.setAttribute(component, property, value);
    }
  } else {
    if (value === null || value === undefined) {
      // Remove component.
      entity.removeAttribute(component);
    } else {
      // Set component.
      entity.setAttribute(component, value);
    }
  }
}

/**
 * @param editor Editor
 * @param payload: entity, component, property, value.
 * @constructor
 */
export class EntityUpdateCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'EntityUpdateCommand';
    this.name = 'Update Entity';
    this.updatable = true;

    this.entity = payload.entity;
    this.component = payload.component;
    this.property = payload.property;

    const component =
      this.entity.components[payload.component] ??
      AFRAME.components[payload.component];
    // First try to get `this.entity.components[payload.component]` to have the dynamic schema, and fallback to `AFRAME.components[payload.component]` if not found.
    // This is to properly stringify some properties that uses for example vec2 or vec3 on material component.
    // This is important to fallback to `AFRAME.components[payload.component]` for primitive components position rotation and scale
    // that may not have been created initially on the entity.
    if (component) {
      if (payload.property) {
        if (component.schema[payload.property]) {
          this.newValue = component.schema[payload.property].stringify(
            payload.value
          );
          this.oldValue = component.schema[payload.property].stringify(
            payload.entity.getAttribute(payload.component)[payload.property]
          );
        } else {
          // Just in case dynamic schema is not properly updated and we set an unknown property. I don't think this should happen.
          this.newValue = payload.value;
          this.oldValue = payload.entity.getAttribute(payload.component)[
            payload.property
          ];
        }
        if (this.editor.debugUndoRedo) {
          console.log(this.component, this.oldValue, this.newValue);
        }
      } else {
        this.newValue = component.schema.stringify(payload.value);
        this.oldValue = component.schema.stringify(
          payload.entity.getAttribute(payload.component)
        );
        if (this.editor.debugUndoRedo) {
          console.log(this.component, this.oldValue, this.newValue);
        }
      }
    }
  }

  execute() {
    if (this.editor.debugUndoRedo) {
      console.log(
        'execute',
        this.entity,
        this.component,
        this.property,
        this.newValue
      );
    }
    updateEntity(this.entity, this.component, this.property, this.newValue);
    Events.emit('entityupdate', {
      entity: this.entity,
      component: this.component,
      property: this.property,
      value: this.newValue
    });
  }

  undo() {
    if (
      this.editor.selectedEntity &&
      this.editor.selectedEntity !== this.entity
    ) {
      // If the selected entity is not the entity we are undoing, select the entity.
      this.editor.selectEntity(this.entity);
    }
    updateEntity(this.entity, this.component, this.property, this.oldValue);
    Events.emit('entityupdate', {
      entity: this.entity,
      component: this.component,
      property: this.property,
      value: this.oldValue
    });
  }

  update(command) {
    if (this.editor.debugUndoRedo) {
      console.log('update', command);
    }
    this.newValue = command.newValue;
  }
}
