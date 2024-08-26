import Events from '../Events';
import { Command } from '../command.js';
import { findClosestEntity, prepareForSerialization } from '../entity.js';

export class EntityRemoveCommand extends Command {
  constructor(editor, entity) {
    super(editor);

    this.type = 'EntityRemoveCommand';
    this.name = 'Remove Entity';
    this.updatable = false;

    this.entity = entity;
    // Store the parent element and index for precise reinsertion
    this.parentEl = entity.parentNode;
    this.index = Array.from(this.parentEl.children).indexOf(entity);
  }

  execute() {
    const closest = findClosestEntity(this.entity);

    // Keep a clone not attached to DOM for undo
    this.entity.flushToDOM();
    const clone = prepareForSerialization(this.entity);

    // Remove entity
    this.editor.removeObject(this.entity.object3D);
    this.entity.parentNode.removeChild(this.entity);
    Events.emit('entityremoved', this.entity);

    // Replace this.entity by clone
    this.entity = clone;

    AFRAME.INSPECTOR.selectEntity(closest);
  }

  undo() {
    // Reinsert the entity at its original position using the stored index
    const referenceNode = this.parentEl.children[this.index] ?? null;
    this.parentEl.insertBefore(this.entity, referenceNode);

    // Emit event after entity is loaded
    this.entity.addEventListener(
      'loaded',
      () => {
        this.editor.selectEntity(this.entity);
        Events.emit('entitycreated', this.entity);
      },
      { once: true }
    );
  }
}
