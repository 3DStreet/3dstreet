/* global THREE, STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

export class EntityReparentCommand extends Command {
  constructor(editor, payload = null) {
    super(editor);

    this.type = 'entityreparent';
    this.name = 'Reparent Entity';
    this.updatable = false;

    if (payload !== null) {
      const entity = payload.entity;
      if (!entity.id) {
        entity.id = createUniqueId();
      }

      this.entityId = entity.id;
      this.newParentEl = payload.parentEl; // this is the id
      this.newIndexInParent = payload.indexInParent;

      // Store current state for undo
      this.oldParentEl = entity.parentNode.id;
      this.oldIndexInParent = Array.from(entity.parentNode.children).indexOf(
        entity
      );

      // Serialize using the exact same function the save/load pipeline uses.
      // This is the proven format that createEntityFromObj can recreate
      // losslessly, including correct component dependency resolution.
      this.entityData = STREET.utils.getElementData(entity);

      // Store world position and quaternion before reparenting
      this.worldPosition = new THREE.Vector3();
      this.worldQuaternion = new THREE.Quaternion();
      entity.object3D.getWorldPosition(this.worldPosition);
      entity.object3D.getWorldQuaternion(this.worldQuaternion);
    }
  }

  updateLocalTransform(entity, newParent) {
    // Calculate the new local position and quaternion relative to the new parent
    // to maintain the same world position

    // Convert world position to local position relative to new parent
    const newLocalPosition = this.worldPosition.clone();
    newParent.object3D.worldToLocal(newLocalPosition);

    // Calculate the new local quaternion
    const parentWorldQuaternion = new THREE.Quaternion();
    newParent.object3D.getWorldQuaternion(parentWorldQuaternion);
    const newLocalQuaternion = parentWorldQuaternion
      .invert()
      .multiply(this.worldQuaternion);

    // Apply the new local transform to the entity
    entity.object3D.position.copy(newLocalPosition);
    entity.object3D.quaternion.copy(newLocalQuaternion);

    // Update A-Frame attributes to reflect the changes
    entity.setAttribute('position', {
      x: newLocalPosition.x,
      y: newLocalPosition.y,
      z: newLocalPosition.z
    });

    const euler = new THREE.Euler().setFromQuaternion(
      newLocalQuaternion,
      'YXZ'
    );
    entity.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z)
    });
  }

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    const newParent = document.getElementById(this.newParentEl);
    if (!newParent) {
      console.error(`Parent element with id ${this.newParentEl} not found`);
      return;
    }

    // Remove the entity from current parent
    if (entity.parentNode) {
      entity.parentNode.removeChild(entity);
    }

    // Determine the insertion point. When moving forward within the same
    // parent, removing the entity shifts subsequent siblings left by 1, so
    // we adjust the target index to compensate.
    let adjustedIndex = this.newIndexInParent;
    if (
      this.newParentEl === this.oldParentEl &&
      this.oldIndexInParent < this.newIndexInParent
    ) {
      adjustedIndex--;
    }
    const beforeEl =
      adjustedIndex >= 0 && adjustedIndex < newParent.children.length
        ? newParent.children[adjustedIndex]
        : null;

    // Deep-clone because createEntityFromObj mutates the data (deletes
    // geometry/material from components). We need the original intact for undo.
    const entityData = JSON.parse(JSON.stringify(this.entityData));

    // Recreate using the exact same function the save/load pipeline uses.
    // The beforeEl param inserts the freshly-created element at the right
    // position (this is NOT moving an existing entity — the element is new).
    const recreatedEntity = STREET.utils.createEntityFromObj(
      entityData,
      newParent,
      beforeEl
    );

    // Wait for entity to be loaded before emitting events.
    // createEntityFromObj also uses 'loaded' to set deferred components;
    // its handler was registered first so it runs before this one.
    recreatedEntity.addEventListener(
      'loaded',
      () => {
        recreatedEntity.pause();

        // Calculate new local position and quaternion relative to new parent
        this.updateLocalTransform(recreatedEntity, newParent);

        Events.emit('entityremoved', entity);
        Events.emit('entitycreated', recreatedEntity);

        this.editor.selectEntity(recreatedEntity);

        nextCommandCallback?.(recreatedEntity);
      },
      { once: true }
    );

    return recreatedEntity;
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;

    const oldParent = this.oldParentEl
      ? document.getElementById(this.oldParentEl)
      : null;
    if (!oldParent) {
      console.error(
        `Original parent element with id ${this.oldParentEl} not found`
      );
      return;
    }

    // Remove from current parent
    if (entity.parentNode) {
      entity.parentNode.removeChild(entity);
    }

    // Determine the insertion point
    const beforeEl =
      this.oldIndexInParent >= 0 &&
      this.oldIndexInParent < oldParent.children.length
        ? oldParent.children[this.oldIndexInParent]
        : null;

    // Deep-clone because createEntityFromObj mutates the data
    const entityData = JSON.parse(JSON.stringify(this.entityData));

    // Recreate using the exact same function the save/load pipeline uses
    const recreatedEntity = STREET.utils.createEntityFromObj(
      entityData,
      oldParent,
      beforeEl
    );

    // Wait for entity to be loaded before emitting events
    recreatedEntity.addEventListener(
      'loaded',
      () => {
        recreatedEntity.pause();

        // For undo, restore the original local transform relative to old parent
        this.updateLocalTransform(recreatedEntity, oldParent);

        Events.emit('entityremoved', entity);
        Events.emit('entitycreated', recreatedEntity);

        this.editor.selectEntity(recreatedEntity);

        nextCommandCallback?.(recreatedEntity);
      },
      { once: true }
    );

    return recreatedEntity;
  }
}
