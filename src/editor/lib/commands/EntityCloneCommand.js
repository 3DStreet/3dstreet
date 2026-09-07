import Events from '../Events.js';
import { Command } from '../command.js';
import { cloneEntityImpl, createUniqueId, insertAfter } from '../entity.js';

export class EntityCloneCommand extends Command {
  static llmTool = {
    name: 'entityClone',
    description:
      'Clone an entity (including its children) and insert the copy as its next sibling. Returns with the clone selected; read getSelectedEntity for the new id.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to clone'
        }
      },
      required: ['entityId']
    }
  };

  // Editor callers pass the entity directly; the LLM registry passes the
  // `{entity}` payload its id-resolution produces. Accept both.
  constructor(editor, entityOrPayload) {
    super(editor);

    this.type = 'entityclone';
    this.name = 'Clone Entity';
    this.updatable = false;
    const entity = entityOrPayload.isEntity
      ? entityOrPayload
      : entityOrPayload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityIdToClone = entity.id;
    this.entityId = null;
    this.detachedClone = null;
  }

  execute(nextCommandCallback) {
    const entityToClone = document.getElementById(this.entityIdToClone);
    if (entityToClone) {
      // We keep a copy of the detached clone to keep the new ids of the
      // entity and children in the case we do a follow-up action like
      // entityupdate on the entity or one of the children, then undo entityupdate, undo entityclone,
      // redo entityclone with the same new ids, redo entityupdate that has a ref to a new id.
      if (!this.detachedClone) {
        this.detachedClone = cloneEntityImpl(entityToClone);
      }
      if (!this.detachedClone) return;
      const clone = this.detachedClone.cloneNode(true);
      clone.addEventListener(
        'loaded',
        function () {
          clone.pause();
          // A duplicated lane carries its source's separator stripe into its
          // new position (e.g. the outer lane's solid edge line); let the
          // street recompute the stripes on the clone's shared edges.
          const street = clone.parentEl?.components?.['managed-street'];
          if (street && clone.components['street-segment']) {
            street.updateAutoStriping(clone);
          }
          Events.emit('entityclone', clone);
          AFRAME.INSPECTOR.selectEntity(clone);
        },
        { once: true }
      );
      insertAfter(clone, entityToClone);
      this.entityId = clone.id;
      nextCommandCallback?.(clone);
      return clone;
    }
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (entity) {
      entity.parentNode.removeChild(entity);
      Events.emit('entityremoved', entity);
      this.editor.selectEntity(document.getElementById(this.entityIdToClone));
      nextCommandCallback?.(entity);
    }
  }
}
