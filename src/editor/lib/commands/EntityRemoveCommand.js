import Events from '../Events';
import { Command } from '../command.js';
import {
  createUniqueId,
  findClosestEntity,
  prepareForSerialization
} from '../entity.js';

export class EntityRemoveCommand extends Command {
  static llmTool = {
    name: 'entityRemove',
    description: 'Remove an entity from the scene. Undoable via the undo tool.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to remove'
        }
      },
      required: ['entityId']
    }
  };

  // Editor callers pass the entity directly; the LLM registry passes the
  // `{entity}` payload its id-resolution produces. Accept both.
  constructor(editor, entityOrPayload) {
    super(editor);

    this.type = 'entityremove';
    this.name = 'Remove Entity';
    this.updatable = false;

    const entity = entityOrPayload.isEntity
      ? entityOrPayload
      : entityOrPayload.entity;
    this.entity = entity;
    // Store the parent and index for precise reinsertion. The parent is
    // found again by id on undo: moving it in the layer panel replaces its
    // element, so the element held here may be gone by then. An id-less
    // parent is given one, as creating into it already does.
    this.parentEl = entity.parentNode;
    if (!this.parentEl.id) {
      this.parentEl.setAttribute('id', createUniqueId());
    }
    this.parentId = this.parentEl.id;
    this.index = Array.from(this.parentEl.children).indexOf(entity);
  }

  // The parent to restore into: the element now carrying the stored id, or
  // the stored element itself if that id no longer resolves but the element
  // is still in the scene.
  resolveParent() {
    const byId = document.getElementById(this.parentId);
    if (byId) return byId;
    return this.parentEl.isConnected ? this.parentEl : null;
  }

  execute(nextCommandCallback) {
    const closest = findClosestEntity(this.entity);

    // Keep a clone not attached to DOM for undo
    this.entity.flushToDOM();
    const clone = prepareForSerialization(this.entity);

    // Remove entity
    this.entity.parentNode.removeChild(this.entity);
    Events.emit('entityremoved', this.entity);

    // Replace this.entity by clone
    this.entity = clone;

    this.editor.selectEntity(closest);
    nextCommandCallback?.(null);
  }

  undo(nextCommandCallback) {
    const parentEl = this.resolveParent();
    if (!parentEl) {
      console.error(`Parent element with id ${this.parentId} not found`);
      return;
    }
    // Reinsert the entity at its original position using the stored index
    const referenceNode = parentEl.children[this.index] ?? null;
    parentEl.insertBefore(this.entity, referenceNode);

    // Emit event after entity is loaded
    this.entity.addEventListener(
      'loaded',
      () => {
        this.entity.pause();
        Events.emit('entitycreated', this.entity);
        this.editor.selectEntity(this.entity);
        nextCommandCallback?.(this.entity);
      },
      { once: true }
    );
  }
}
