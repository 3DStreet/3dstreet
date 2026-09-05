import { Command } from '../command.js';
import { createUniqueId, updateEntity } from '../entity.js';

/**
 * Move one shape vertex to a new position.
 *
 * WHY THIS DOES NOT EXTEND EntityUpdateCommand, even though the body below is
 * a pared-down copy of it: static class fields are inherited through the
 * prototype chain, so a subclass would carry EntityUpdateCommand's
 * `static llmTool` — and the command registry reads that INHERITED value and
 * throws on a duplicate tool name at MODULE EVALUATION. The editor would not
 * load at all. Tidying this into a subclass therefore takes the whole editor
 * down, and does so before a single frame renders. (The registry reading an
 * inherited static rather than an own property is arguably the underlying bug,
 * but it is shared infrastructure and this command does not need it changed.)
 *
 * The other divergence is `updatable = false`. History coalesces consecutive
 * updatable commands on the same entity and component within 500 ms into one
 * undo step, which would merge two quick drags of the same vertex — and every
 * vertex edit has to be individually undoable.
 *
 * @param editor Editor
 * @param payload: entity, component, property, value, oldValue, noSelectEntity
 */
export class ShapeVertexMoveCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'shapevertexmove';
    this.name = 'Move Shape Vertex';
    this.updatable = false;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.component = payload.component ?? 'position';
    this.property = payload.property ?? '';
    this.noSelectEntity = payload.noSelectEntity ?? true;
    this.newValue = payload.value;
    // getAttribute('position') proxies the live object3D, so once a drag has
    // moved the vertex the "current" value is already the new one. The caller
    // snapshots the value from before the drag and passes it in.
    this.oldValue = payload.oldValue;
  }

  execute(nextCommandCallback) {
    this._apply(this.newValue, nextCommandCallback);
  }

  undo(nextCommandCallback) {
    this._apply(this.oldValue, nextCommandCallback);
  }

  _apply(value, nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;
    if (
      this.editor.selectedEntity &&
      this.editor.selectedEntity !== entity &&
      !this.noSelectEntity
    ) {
      this.editor.selectEntity(entity);
    }
    updateEntity(entity, this.component, this.property, value);
    nextCommandCallback?.(entity);
  }
}
