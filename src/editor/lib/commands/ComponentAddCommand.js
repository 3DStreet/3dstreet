import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class ComponentAddCommand extends Command {
  static llmTool = {
    name: 'componentAdd',
    description:
      "Add an A-Frame component to an entity with an optional initial value (e.g. component 'animation__spin', value 'property: rotation; to: 0 360 0; loop: true; dur: 4000'). Use entityUpdate to change a component the entity already has, and managedStreetUpdate for street-segment generated components.",
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to add the component to'
        },
        component: {
          type: 'string',
          description:
            "The component name, including a multi-instance suffix when several of the same type are wanted (e.g. 'animation__spin')"
        },
        value: {
          type: 'string',
          description:
            "Initial component value as an A-Frame attribute string ('prop: v; prop2: v2'); omit for component defaults"
        }
      },
      required: ['entityId', 'component']
    }
  };

  // A hallucinated component name would otherwise become an inert HTML
  // attribute while the tool still reports "executed" — validate against
  // A-Frame's component registry (base name, so multi-instance suffixes
  // validate against their base component).
  // Components may be added to the scene roots themselves (e.g. #environment).
  static llmAllowRootTarget = true;

  static transformLLMArgs(args, { entity } = {}) {
    const name = args.component;
    if (typeof name !== 'string' || !name) {
      throw new Error("'component' is required and must be a string");
    }
    const baseName = name.split('__')[0];
    if (!AFRAME.components[baseName]) {
      throw new Error(
        `Unknown component '${name}' — A-Frame has no such component registered`
      );
    }
    if (entity.components?.[name] || entity.hasAttribute(name)) {
      throw new Error(
        `Entity ${args.entityId} already has component '${name}' — use entityUpdate to change it`
      );
    }
    return {
      entityId: args.entityId,
      component: name,
      value: args.value ?? ''
    };
  }

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

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.setAttribute(this.component, this.value);
      Events.emit('componentadd', {
        entity: entity,
        component: this.component,
        value: this.value
      });
      nextCommandCallback?.(entity);
    }
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.removeAttribute(this.component);
      Events.emit('componentremove', {
        entity,
        component: this.component
      });
      nextCommandCallback?.(entity);
    }
  }
}
