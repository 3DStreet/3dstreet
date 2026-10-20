/* global STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.jsx';
import { isGroupableItem } from '../groups/groupModel.js';
import { notePlacedOutsideOpenGroup } from '../groups/groupPlacement.js';
import { migrateImplicitStreetAlign } from '@/tested/migrate-street-align.js';
import { levelGroupPoses } from '@/tested/group-pose.js';
import { readMixinPose } from '../groups/groupLevel.js';
import { retargetStreetPath } from '@/tested/copied-street-path.js';

/**
 * Pastes a serialized entity (STREET.utils.getElementData format) into a
 * parent element. Used by the clipboard paste flow (lib/clipboard.js) for
 * streets, segments and plain entities alike — the target parent and index
 * are resolved by the caller.
 *
 * payload: { entityData, parentId, index?, name?, requireParent? }
 *   - entityData: object from STREET.utils.getElementData
 *   - parentId: id of the element to paste into
 *   - index: optional index among the parent's children to insert before;
 *     appends if omitted or out of range
 *   - name: optional history label (e.g. "Paste Segment")
 *   - requireParent: the paste must land in this parent (an open group); the
 *     command guard refuses it if the parent can no longer take it
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
    // rationale as EntityCloneCommand's detachedClone. The same goes for
    // pointing a pasted street at the copy of its path.
    this.entityData = JSON.parse(JSON.stringify(payload.entityData));
    const idMap = new Map();
    regenerateIds(this.entityData, true, idMap);
    retargetStreetPaths(this.entityData, idMap);
    this.entityId = this.entityData.id;
    this.parentId = payload.parentId;
    this.index = payload.index;
    this.requireParent = !!payload.requireParent;
    this.executed = false;
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
    // Clipboard text can come from a tab on a pre-#1863 build, where a
    // street-align without a length meant 'start'.
    migrateImplicitStreetAlign([entityData]);
    // It can also come from a build that let groups be scaled or tilted. The
    // pose is already local to the destination, so this keeps the pasted
    // group's position and heading there.
    levelGroupPoses(entityData, { mixinPose: readMixinPose });

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

    if (!this.executed) {
      this.executed = true;
      notePlacedOutsideOpenGroup(entity, {
        requireParent: this.requireParent,
        groupable: isGroupableItem(this.entityData)
      });
    }
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
function regenerateIds(entityData, isRoot, idMap) {
  if (isRoot || entityData.id) {
    const oldId = entityData.id;
    entityData.id = createUniqueId();
    // Recorded old id -> new id, for retargetStreetPaths.
    if (oldId) idMap.set(oldId, entityData.id);
  }
  if (entityData.children) {
    for (const child of entityData.children) {
      regenerateIds(child, false, idMap);
    }
  }
}

/**
 * Point each pasted street at the copy of the path shape it follows, when the
 * paste holds that shape (a street pasted without its path keeps following
 * the original, if it is still there).
 */
function retargetStreetPaths(entityData, idMap) {
  const components = entityData.components;
  if (components && components['managed-street'] !== undefined) {
    components['managed-street'] = retargetStreetPath(
      components['managed-street'],
      idMap
    );
  }
  if (entityData.children) {
    for (const child of entityData.children) {
      retargetStreetPaths(child, idMap);
    }
  }
}
