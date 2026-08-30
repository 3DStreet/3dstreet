import Events from '../Events';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

/**
 * Add one vertex to a shape at a given index.
 *
 * Diverges from EntityRemoveCommand deliberately: that command serializes the
 * entity and re-inserts a CLONE on its reverse leg, because it has to serve
 * arbitrary subtrees. This one retains and re-attaches the SAME element
 * instance. A shape-vertex is a two-attribute leaf with no children, and
 * identity stability is what keeps the vertex's id, the handle cache and any
 * earlier position command still pointing at a live node across undo/redo —
 * EntityUpdateCommand resolves its target by id and silently no-ops when the
 * lookup misses, so a replacement node would make an earlier move-undo do
 * nothing at all. Do not "fix" this into a clone.
 *
 * The cost, named rather than left for the next reader to discover: A-Frame's
 * disconnectedCallback removes every component and nulls `object3D.el`, and
 * connectedCallback restores neither — only the constructor ever sets that
 * back-reference, so a re-attached instance carries `object3D.el === null` for
 * good. Harmless for a shape-vertex, whose object3D holds no mesh and is never
 * a pick target (the inspector's raycaster resolves an entity through
 * `hit.object.el`), and whose two attributes are re-read on reconnect. It would
 * not be harmless for an entity with geometry, which is one more reason this
 * treatment stays scoped to the vertex pair rather than being generalised.
 *
 * Both the shape and the vertex are nonetheless RESOLVED BY ID at run time,
 * falling back to the retained instance: a whole-shape delete + undo
 * (EntityRemoveCommand) replaces the shape subtree with a clone under the same
 * ids, and a command that only held the original references would then edit a
 * detached tree while the visible clone stayed put.
 *
 * Never touches selection: the shape stays selected throughout, which is what
 * keeps its editing affordances on screen.
 *
 * @param editor Editor
 * @param payload: shapeEl, index, position
 */
export class ShapeVertexInsertCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'shapevertexinsert';
    this.name = 'Insert Shape Vertex';
    this.updatable = false;

    this.shapeEl = payload.shapeEl;
    if (!this.shapeEl.id) this.shapeEl.id = createUniqueId();
    this.shapeId = this.shapeEl.id;
    this.index = payload.index;
    this.position = payload.position;
    this.el = null;
  }

  _shape() {
    return document.getElementById(this.shapeId) ?? this.shapeEl;
  }

  _vertex() {
    return (this.el && document.getElementById(this.el.id)) ?? this.el;
  }

  execute() {
    if (!this.el) {
      const el = document.createElement('a-entity');
      // Every vertex this tool touches carries an id. An id is assigned to an
      // id-less entity by the update-command family anyway, the moment one is
      // first dragged, so assigning at insert makes the behaviour uniform
      // rather than "whichever vertices happened to be moved".
      el.id = createUniqueId();
      el.setAttribute('class', 'hideFromSceneGraph');
      el.setAttribute('shape-vertex', '');
      el.setAttribute('position', this.position);
      this.el = el;
    }
    const shapeEl = this._shape();
    const el = this._vertex();
    if (!shapeEl.contains(el)) {
      // index === child count appends, which is the wrap-edge case.
      const reference = shapeEl.children[this.index] ?? null;
      shapeEl.insertBefore(el, reference);
    }
    Events.emit('shapevertexstructurechanged', shapeEl);
  }

  undo() {
    this._vertex().remove();
    Events.emit('shapevertexstructurechanged', this._shape());
  }
}
