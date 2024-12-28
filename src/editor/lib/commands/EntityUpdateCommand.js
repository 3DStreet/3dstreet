import { Command } from '../command.js';
import { createUniqueId, updateEntity } from '../entity.js';

/**
 * @param editor Editor
 * @param payload: entity, component, property, value.
 * @constructor
 */
export class EntityUpdateCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'entityupdate';
    this.name = 'Update Entity';
    this.updatable = true;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.component = payload.component;
    this.property = payload.property ?? '';

    const component =
      entity.components[payload.component] ??
      AFRAME.components[payload.component];
    // First try to get `entity.components[payload.component]` to have the dynamic schema, and fallback to `AFRAME.components[payload.component]` if not found.
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
        if (this.editor.config.debugUndoRedo) {
          console.log(
            'entityupdate property',
            this.component,
            this.property,
            this.oldValue,
            this.newValue
          );
        }
      } else {
        this.newValue = component.isSingleProperty
          ? component.schema.stringify(payload.value)
          : payload.value;
        this.oldValue = component.isSingleProperty
          ? component.schema.stringify(
              payload.entity.getAttribute(payload.component)
            )
          : structuredClone(payload.entity.getDOMAttribute(payload.component));
        if (this.editor.config.debugUndoRedo) {
          console.log(
            'entityupdate component',
            this.component,
            this.oldValue,
            this.newValue
          );
        }
      }
    } else {
      // id, class, mixin, data attributes
      this.newValue = payload.value;
      this.oldValue = payload.entity.getAttribute(this.component);
      if (this.editor.config.debugUndoRedo) {
        console.log(
          'entityupdate attribute',
          this.component,
          this.oldValue,
          this.newValue
        );
      }
    }
  }

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      if (this.editor.selectedEntity && this.editor.selectedEntity !== entity) {
        // If the selected entity is not the entity we are undoing, select the entity.
        this.editor.selectEntity(entity);
      }

      if (this.editor.config.debugUndoRedo) {
        console.log(
          'execute',
          entity,
          this.component,
          this.property,
          this.newValue
        );
      }

      // If we set a single mixin, remove the current mixin first so that it removes the gltf-model
      // component, then set the new mixin that will load a new gltf model.
      // If we don't remove first, sometimes a newly selected model won't load.
      if (
        this.component === 'mixin' &&
        this.newValue &&
        this.newValue.indexOf(' ') === -1
      ) {
        entity.setAttribute('mixin', '');
      }
      updateEntity(entity, this.component, this.property, this.newValue);
      if (this.component === 'id') {
        this.entityId = this.newValue;
      }
      nextCommandCallback?.(entity);
    }
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      if (this.editor.selectedEntity && this.editor.selectedEntity !== entity) {
        // If the selected entity is not the entity we are undoing, select the entity.
        this.editor.selectEntity(entity);
      }
      if (
        this.component === 'mixin' &&
        this.oldValue &&
        this.oldValue.indexOf(' ') === -1
      ) {
        entity.setAttribute('mixin', '');
      }
      if (this.editor.config.debugUndoRedo) {
        console.log(
          'undo',
          entity,
          this.component,
          this.property,
          this.oldValue
        );
      }
      updateEntity(entity, this.component, this.property, this.oldValue);
      if (this.component === 'id') {
        this.entityId = this.oldValue;
      }
      nextCommandCallback?.(entity);
    }
  }

  update(command) {
    if (this.editor.config.debugUndoRedo) {
      console.log('update', command);
    }
    this.newValue = command.newValue;
  }
}
