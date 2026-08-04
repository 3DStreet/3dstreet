import Events from '../Events';
import { Command } from '../command.js';

/**
 * Remove one vertex from a shape.
 *
 * EntityRemoveCommand cannot be used here for two independent reasons: it
 * steals selection on BOTH legs (execute selects a sibling — for a vertex, a
 * neighbouring vertex; undo selects the removed entity), which would deselect
 * the shape mid-edit and tear its editing affordances down; and it re-inserts a
 * serialized CLONE rather than the original node. The clone treatment is right
 * for that command, which serves arbitrary subtrees, and wrong here: a
 * shape-vertex is a two-attribute leaf, and identity stability is what keeps
 * the vertex's id and any earlier position command valid across undo/redo.
 * Both this command and ShapeVertexInsertCommand re-insert the SAME element
 * instance; neither ever constructs a replacement. Do not "fix" this into a
 * clone.
 *
 * No confirm() either — a vertex is a small, immediately undoable edit, unlike
 * removing a whole entity from the scene.
 *
 * @param editor Editor
 * @param payload: vertexEl
 */
export class ShapeVertexRemoveCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'shapevertexremove';
    this.name = 'Remove Shape Vertex';
    this.updatable = false;

    this.el = payload.vertexEl;
    this.shapeEl = this.el.parentNode;
    this.index = Array.from(this.shapeEl.children).indexOf(this.el);
  }

  execute() {
    this.el.remove();
    Events.emit('shapevertexstructurechanged', this.shapeEl);
  }

  undo() {
    const reference = this.shapeEl.children[this.index] ?? null;
    this.shapeEl.insertBefore(this.el, reference);
    Events.emit('shapevertexstructurechanged', this.shapeEl);
  }
}
