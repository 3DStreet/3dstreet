import Events from '../Events';
import { Command } from '../command.js';
import { findClosestEntity, prepareForSerialization } from '../entity.js';
import { deleteAsset } from '../../api/storage.js';

export class EntityRemoveCommand extends Command {
  constructor(editor, entity) {
    super(editor);

    this.type = 'entityremove';
    this.name = 'Remove Entity';
    this.updatable = false;

    this.entity = entity;
    // Store the parent element and index for precise reinsertion
    this.parentEl = entity.parentNode;
    this.index = Array.from(this.parentEl.children).indexOf(entity);
  }

  execute(nextCommandCallback) {
    const closest = findClosestEntity(this.entity);

    // If the entity is a custom model from 3dstreet, delete it from storage
    if (this.entity.getAttribute('data-asset-source') === '3dstreet') {
      const modelUrlAttr = this.entity.getAttribute('gltf-model');
      if (modelUrlAttr) {
        // Extract URL from "url(...)" string
        const urlMatch = /url\(([^)]+)\)/.exec(modelUrlAttr);
        if (urlMatch && urlMatch[1]) {
          const modelUrl = urlMatch[1];
          // It's a fire-and-forget, no need to await
          deleteAsset(modelUrl);
        }
      }
    }

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
    // Reinsert the entity at its original position using the stored index
    const referenceNode = this.parentEl.children[this.index] ?? null;
    this.parentEl.insertBefore(this.entity, referenceNode);

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
