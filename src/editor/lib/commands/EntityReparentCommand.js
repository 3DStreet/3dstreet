/* global THREE, STREET */
import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';
import { getEditableEntity } from './llmToolGuards.js';

export class EntityReparentCommand extends Command {
  static llmTool = {
    name: 'entityReparent',
    description:
      'Move an entity under a different parent entity, preserving its world position. Also reorders within the same parent when newParentId is the current parent.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          description: 'The ID of the entity to move'
        },
        newParentId: {
          type: 'string',
          description: 'The ID of the entity to become the new parent'
        },
        index: {
          type: 'number',
          description:
            'Child index (0-based) to insert at in the new parent; appends when omitted'
        }
      },
      required: ['entityId', 'newParentId']
    }
  };

  // Reshape LLM args into the {entity, parentEl (id string), indexInParent}
  // payload the constructor expects. parentEl stays an id — the registry's
  // adapter only resolves `entityId`/`parentId` keys, and both the command
  // and the transform guard (`data-transform-no-reparent`) want the id.
  static transformLLMArgs(args) {
    const entity = getEditableEntity(args.entityId);
    const parent = getEditableEntity(args.newParentId, {
      allowRoot: true,
      role: 'newParent'
    });
    if (entity === parent || entity.contains(parent)) {
      throw new Error(
        'Cannot reparent an entity into itself or its own descendant'
      );
    }
    const indexInParent =
      typeof args.index === 'number' ? args.index : parent.children.length;
    return {
      entityId: args.entityId,
      parentEl: args.newParentId,
      indexInParent
    };
  }

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

      // Store world position, quaternion, and scale before reparenting
      this.worldPosition = new THREE.Vector3();
      this.worldQuaternion = new THREE.Quaternion();
      this.worldScale = new THREE.Vector3();
      entity.object3D.getWorldPosition(this.worldPosition);
      entity.object3D.getWorldQuaternion(this.worldQuaternion);
      entity.object3D.getWorldScale(this.worldScale);
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

    // Calculate the new local scale
    const parentWorldScale = new THREE.Vector3();
    newParent.object3D.getWorldScale(parentWorldScale);
    const newLocalScale = new THREE.Vector3(
      this.worldScale.x / parentWorldScale.x,
      this.worldScale.y / parentWorldScale.y,
      this.worldScale.z / parentWorldScale.z
    );

    // Apply the new local transform to the entity
    entity.setAttribute('position', {
      x: newLocalPosition.x,
      y: newLocalPosition.y,
      z: newLocalPosition.z
    });

    const euler = new THREE.Euler().setFromQuaternion(
      newLocalQuaternion,
      'YXZ'
    );
    const rotX = THREE.MathUtils.radToDeg(euler.x);
    const rotY = THREE.MathUtils.radToDeg(euler.y);
    const rotZ = THREE.MathUtils.radToDeg(euler.z);
    if (rotX === 0 && rotY === 0 && rotZ === 0) {
      entity.removeAttribute('rotation');
    } else {
      entity.setAttribute('rotation', { x: rotX, y: rotY, z: rotZ });
    }

    if (
      newLocalScale.x === 1 &&
      newLocalScale.y === 1 &&
      newLocalScale.z === 1
    ) {
      entity.removeAttribute('scale');
    } else {
      entity.setAttribute('scale', {
        x: newLocalScale.x,
        y: newLocalScale.y,
        z: newLocalScale.z
      });
    }
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

    // Update position/rotation/scale components relative to new parent
    this.updateLocalTransform(recreatedEntity, newParent);

    // Wait for entity to be loaded before emitting events
    recreatedEntity.addEventListener(
      'loaded',
      () => {
        recreatedEntity.pause();

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
