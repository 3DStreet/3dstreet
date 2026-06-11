import { Parser } from 'expr-eval';
import { Command } from '../command.js';
import { createUniqueId, updateEntity } from '../entity.js';

/**
 * @param editor Editor
 * @param payload: entity, component, property, value.
 * @constructor
 */
export class EntityUpdateCommand extends Command {
  static llmTool = {
    name: 'entityUpdate',
    description:
      'Update an entity in the A-Frame scene with new properties or components',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to update'
        },
        component: {
          type: 'string',
          description:
            'The component to update (e.g., position, rotation, mixin)'
        },
        property: {
          type: 'string',
          description: 'The property to update within the component (optional)'
        },
        value: {
          type: 'string',
          description: 'The new value to set'
        },
        expressionForValue: {
          type: 'string',
          description:
            'Mathematical expression to evaluate for the value (e.g., "5 - 2"). Use this instead of value when calculation is needed.'
        }
      },
      required: ['entityId', 'component']
    }
  };

  // Resolve expressionForValue → numeric value before dispatch. The id→DOM
  // resolution for entityId is handled by the registry's generic adapter.
  static transformLLMArgs(args) {
    const out = { ...args };
    if (out.expressionForValue) {
      const expr = String(out.expressionForValue).trim();
      if (!/^[-+0-9\s()*/%.]*$/.test(expr)) {
        throw new Error('Invalid expression: contains forbidden characters');
      }
      out.value = new Parser().evaluate(expr);
      delete out.expressionForValue;
    }
    if (out.value === undefined) {
      throw new Error('Either value or expressionForValue must be provided');
    }
    return out;
  }

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
    this.noSelectEntity = payload.noSelectEntity ?? false;
    this.onEntityUpdate = payload.onEntityUpdate;

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
          const schemaProperty = component.schema[payload.property];
          const isSelectorType =
            schemaProperty.type === 'selector' ||
            schemaProperty.type === 'selectorAll';
          this.newValue =
            payload.value === null
              ? null
              : isSelectorType
                ? payload.value
                : schemaProperty.stringify(payload.value);
          this.oldValue = isSelectorType
            ? (entity.getDOMAttribute(payload.component)?.[payload.property] ??
              '')
            : schemaProperty.stringify(
                entity.getAttribute(payload.component)[payload.property]
              );
        } else {
          // Just in case dynamic schema is not properly updated and we set an unknown property. I don't think this should happen.
          this.newValue = payload.value;
          this.oldValue = entity.getAttribute(payload.component)[
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
        this.newValue =
          payload.value === null
            ? null
            : component.isSingleProperty
              ? component.schema.stringify(payload.value)
              : payload.value;
        this.oldValue = component.isSingleProperty
          ? component.schema.stringify(entity.getAttribute(payload.component))
          : structuredClone(entity.getDOMAttribute(payload.component));
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
      this.oldValue = entity.getAttribute(this.component);
      if (this.editor.config.debugUndoRedo) {
        console.log(
          'entityupdate attribute',
          this.component,
          this.oldValue,
          this.newValue
        );
      }
    }

    // For position/rotation/scale, getAttribute returns the live object3D
    // values, so the oldValue captured above is wrong for callers that
    // mutate the object before executing the command (the transform gizmo).
    // Such callers pass the true pre-change value explicitly.
    if (payload.oldValue !== undefined) {
      this.oldValue = payload.oldValue;
    }
  }

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      if (
        this.editor.selectedEntity &&
        this.editor.selectedEntity !== entity &&
        !this.noSelectEntity
      ) {
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
      this.onEntityUpdate?.(entity);
      nextCommandCallback?.(entity);
    }
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      if (
        this.editor.selectedEntity &&
        this.editor.selectedEntity !== entity &&
        !this.noSelectEntity
      ) {
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
      this.onEntityUpdate?.(entity);
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
