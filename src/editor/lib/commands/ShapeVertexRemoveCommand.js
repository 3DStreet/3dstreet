import Events from '../Events';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

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
 * clone. See ShapeVertexInsertCommand for the cost that treatment carries —
 * A-Frame never restores `object3D.el` after a disconnect — and why it is
 * harmless for a vertex specifically. As there, the shape and the vertex are
 * resolved by id at run time (falling back to the retained instance) so the
 * command still targets the live tree after a whole-shape delete + undo has
 * replaced the shape with a same-id clone.
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
    if (!this.el.id) this.el.id = createUniqueId();
    this.shapeEl = this.el.parentNode;
    if (!this.shapeEl.id) this.shapeEl.id = createUniqueId();
    this.shapeId = this.shapeEl.id;
    this.index = Array.from(this.shapeEl.children).indexOf(this.el);
  }

  _shape() {
    return document.getElementById(this.shapeId) ?? this.shapeEl;
  }

  _vertex() {
    return document.getElementById(this.el.id) ?? this.el;
  }

  execute() {
    this._vertex().remove();
    Events.emit('shapevertexstructurechanged', this._shape());
  }

  undo() {
    const shapeEl = this._shape();
    const el = this._vertex();
    if (!shapeEl.contains(el)) {
      const reference = shapeEl.children[this.index] ?? null;
      shapeEl.insertBefore(el, reference);
    }
    Events.emit('shapevertexstructurechanged', shapeEl);
  }
}
