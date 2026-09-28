import { MultiCommand } from './MultiCommand.js';
import {
  buildDetachCommands,
  findCloneAtSlot,
  forgetDetached,
  rememberDetached,
  resolveDetachToolArgs
} from '../detachClone.js';

/**
 * Detach one generated clone from its managed-street generator (#2011):
 * leave a hole at its placement (`skip`) and put a plain entity — same mixin, same
 * pose (or the pose a viewport drag ended at), under the same segment, no
 * `autocreated` marker — where the clone was. One undo entry: undo removes
 * the plain entity and restores the slot, so the generator regenerates the
 * clone exactly where it was; redo replays both.
 *
 * Payload: `{ entity, pose?, mixin?, components?, remove? }` where `entity`
 * is the autocreated clone, `pose` optionally overrides position/rotation/
 * scale ("x y z" strings or {x, y, z}), `mixin` / `components` carry the
 * edit that triggered the detach (see routeCloneEdit), and `remove: true`
 * leaves the hole without creating anything — delete on a clone.
 *
 * Composed from the existing entityupdate + entitycreate commands rather
 * than reimplementing either, so the detached entity is selected on create
 * (and on redo) and the generator update goes through the same path as a
 * sidebar edit.
 */
export class DetachCloneCommand extends MultiCommand {
  // AI tool (registry.js picks this up from commandsByType). Generated clones
  // have no id and are absent from the scene state the model sees, so the
  // tool names one by segment + generator + slot, or takes the selection.
  static llmTool = {
    name: 'detachClone',
    description:
      "Detach one generated clone (a vehicle, tree, prop, stencil or pedestrian placed by a street-generated-clones, street-generated-stencil or street-generated-pedestrians component on a managed street segment) from its generator so it becomes a plain entity that can be moved, rotated, duplicated or deleted on its own; the rest of the segment stays generated. Name the clone by the segment entity, the generator component on it and the clone slot index (0-based creation order from the start of the segment; a slot already detached has no clone, and the generator's skip array lists the detached placements as 'x z' keys), or omit all three to detach the currently selected clone. Optional position/rotation place the detached entity.",
    inputSchema: {
      type: 'object',
      properties: {
        segmentId: {
          type: 'string',
          description: 'ID of the street-segment entity carrying the generator'
        },
        component: {
          type: 'string',
          description:
            "Generator component name on that segment, e.g. 'street-generated-clones__1', 'street-generated-stencil__1' or 'street-generated-pedestrians__1'"
        },
        slotIndex: {
          type: 'number',
          description:
            '0-based slot of the clone in the generator creation order along the segment'
        },
        position: {
          type: 'string',
          description:
            'Optional "x y z" segment-local position for the detached entity (default: where the clone is)'
        },
        rotation: {
          type: 'string',
          description:
            'Optional "x y z" rotation in degrees for the detached entity (default: the clone rotation)'
        }
      },
      required: []
    }
  };

  static transformLLMArgs(args) {
    return resolveDetachToolArgs(args, {
      selectedEntity: AFRAME.INSPECTOR?.selectedEntity
    });
  }

  constructor(editor, payload) {
    const cloneEl = payload.entity;
    const { slot, commands } = buildDetachCommands(cloneEl, payload.pose, {
      mixin: payload.mixin,
      components: payload.components,
      remove: payload.remove
    });
    // The create step hands back the plain entity: remember it so an edit
    // still aimed at the removed clone element (a scrub in progress) is
    // re-aimed at its replacement by routeCloneEdit.
    super(editor, commands, (createdEl) =>
      rememberDetached(cloneEl, createdEl)
    );
    this.type = 'detachclone';
    this.remove = !!payload.remove;
    this.name = this.remove ? 'Remove Model' : 'Detach Model';
    this.slot = slot;
    this.cloneEl = cloneEl;
  }

  execute() {
    const result = super.execute();
    if (this.remove) {
      // The removed clone was the selection; land on its segment.
      this.editor.selectEntity(this.slot.segmentEl);
    }
    // Every door is silent otherwise (a drag, a number field, Delete): say
    // what just happened and that Undo reverses it. Plain text like the
    // other STREET.notify toasts (entity.js, clipboard.js); redo repeats
    // it, which is accurate. Reached through the global: notify is an
    // A-Frame component and unit tests have no scene.
    globalThis.STREET?.notify?.successMessage?.(
      this.remove
        ? 'Removed from the street generator: that spot stays empty. Undo puts it back.'
        : 'Detached from the street generator: this object is now a plain model you can move, rotate, duplicate or delete. Undo puts it back.'
    );
    return result;
  }

  undo() {
    super.undo();
    forgetDetached(this.cloneEl);
    // The create step's undo cleared the selection; hand it to the clone the
    // generator just put back (same layout, so the same slot index) so the
    // user lands where they started.
    const clone = findCloneAtSlot(
      this.slot.segmentEl,
      this.slot.componentName,
      this.slot.index
    );
    if (!clone) return;
    // Freshly regenerated: its components initialize on load, and the
    // properties panel reads them.
    if (clone.hasLoaded) {
      this.editor.selectEntity(clone);
    } else {
      clone.addEventListener(
        'loaded',
        () => {
          if (clone.isConnected) this.editor.selectEntity(clone);
        },
        { once: true }
      );
    }
  }
}
