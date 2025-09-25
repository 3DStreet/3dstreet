/* global THREE */
import Events from '../Events.js';
import { Command } from '../command.js';
import {
  createUniqueId,
  exportEntityToObject,
  objectToElement
} from '../entity.js';

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

      // Store entity data for recreation
      this.entityData = exportEntityToObject(entity);

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

    // Recreate entity from data to ensure clean state
    const recreatedEntity = objectToElement(this.entityData);
    recreatedEntity.id = this.entityId; // Ensure same ID

    // Insert at specific position
    if (
      this.newIndexInParent >= 0 &&
      this.newIndexInParent < newParent.children.length
    ) {
      const referenceChild = newParent.children[this.newIndexInParent];
      newParent.insertBefore(recreatedEntity, referenceChild);
    } else {
      newParent.appendChild(recreatedEntity);
    }

    // Wait for entity to be loaded before emitting events
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

    // Recreate entity from stored data
    const recreatedEntity = objectToElement(this.entityData);
    recreatedEntity.id = this.entityId; // Ensure same ID

    // Insert at original position
    if (
      this.oldIndexInParent >= 0 &&
      this.oldIndexInParent < oldParent.children.length
    ) {
      const referenceChild = oldParent.children[this.oldIndexInParent];
      oldParent.insertBefore(recreatedEntity, referenceChild);
    } else {
      oldParent.appendChild(recreatedEntity);
    }

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
