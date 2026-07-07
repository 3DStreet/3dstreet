/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

/**
 * Pastes a serialized entity (STREET.utils.getElementData format) into a
 * parent element. Used by the clipboard paste flow (lib/clipboard.js) for
 * streets, segments and plain entities alike — the target parent and index
 * are resolved by the caller.
 *
 * payload: { entityData, parentId, index?, name? }
 *   - entityData: object from STREET.utils.getElementData
 *   - parentId: id of the element to paste into
 *   - index: optional index among the parent's children to insert before;
 *     appends if omitted or out of range
 *   - name: optional history label (e.g. "Paste Segment")
 */
export class EntityPasteCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'entitypaste';
    this.name = payload.name || 'Paste';
    this.updatable = false;

    // Deep-clone and regenerate every id once, up front. The clipboard data
    // may be pasted repeatedly or next to its still-present source, so the
    // ids it carries can never be trusted. Regenerating in the constructor
    // (not execute) means undo/redo reuse the same ids, so follow-up commands
    // holding a ref to the pasted entity survive an undo/redo cycle — same
    // rationale as EntityCloneCommand's detachedClone.
    this.entityData = JSON.parse(JSON.stringify(payload.entityData));
    regenerateIds(this.entityData);
    this.entityId = this.entityData.id;
    this.parentId = payload.parentId;
    this.index = payload.index;
  }

  execute(nextCommandCallback) {
    const parentEl = document.getElementById(this.parentId);
    if (!parentEl) {
      console.error(`[entitypaste] parent ${this.parentId} not found`);
      return;
    }

    const beforeEl =
      this.index !== undefined &&
      this.index >= 0 &&
      this.index < parentEl.children.length
        ? parentEl.children[this.index]
        : null;

    // Deep-clone because createEntityFromObj mutates the data (deletes
    // geometry/material from components). We need the original intact for
    // a later redo.
    const entityData = JSON.parse(JSON.stringify(this.entityData));

    const entity = STREET.utils.createEntityFromObj(
      entityData,
      parentEl,
      beforeEl
    );

    entity.addEventListener(
      'loaded',
      () => {
        entity.pause();
        Events.emit('entitycreated', entity);
        this.editor.selectEntity(entity);
        nextCommandCallback?.(entity);
      },
      { once: true }
    );

    return entity;
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    entity.parentNode.removeChild(entity);
    Events.emit('entityremoved', entity);
    this.editor.selectEntity(null);
    nextCommandCallback?.(null);
  }
}

/**
 * Walk a getElementData tree and give the root a fresh id. Descendants only
 * get a fresh id when they carried one (an id-less child can't collide, and
 * the root always needs one so undo can find the pasted entity).
 */
function regenerateIds(entityData, isRoot = true) {
  if (isRoot || entityData.id) {
    entityData.id = createUniqueId();
  }
  if (entityData.children) {
    for (const child of entityData.children) {
      regenerateIds(child, false);
    }
  }
}
