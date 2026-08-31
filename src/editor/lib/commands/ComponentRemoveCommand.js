import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';
import { getEditableEntity } from './llmToolGuards.js';

export class ComponentRemoveCommand extends Command {
  static llmTool = {
    name: 'componentRemove',
    description:
      'Remove an A-Frame component from an entity. Undoable — the removed value is restored on undo.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to remove the component from'
        },
        component: {
          type: 'string',
          description:
            "The component name as it appears on the entity (e.g. 'animation__spin')"
        }
      },
      required: ['entityId', 'component']
    }
  };

  // The constructor snapshots the current value via the component instance,
  // so only a live component can be removed — a plain attribute (data-*,
  // class) would crash it. Validate here so the model gets a clean error.
  static transformLLMArgs(args) {
    const entity = getEditableEntity(args.entityId, { allowRoot: true });
    const name = args.component;
    if (typeof name !== 'string' || !name) {
      throw new Error("'component' is required and must be a string");
    }
    if (!entity.components?.[name]) {
      const present = Object.keys(entity.components || {});
      throw new Error(
        `Entity ${args.entityId} has no component '${name}'. Components present: ${present.join(', ') || '(none)'}. For plain attributes use entityUpdate with value null.`
      );
    }
    return { entityId: args.entityId, component: name };
  }

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

  execute(nextCommandCallback) {
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

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.setAttribute(this.component, this.value);
      Events.emit('componentadd', {
        entity,
        component: this.component,
        value: this.value
      });
      nextCommandCallback?.(entity);
    }
  }
}
