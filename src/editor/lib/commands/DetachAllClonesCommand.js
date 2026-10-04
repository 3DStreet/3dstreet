import { MultiCommand } from './MultiCommand.js';
import {
  buildDetachAllCommands,
  findCloneAtSlot,
  getCloneSlot,
  resolveDetachAllToolArgs
} from '../detachClone.js';

/**
 * Detach every live clone of one managed-street generator (#2036): the
 * per-generator rung between per-object detach (#2011, one clone) and
 * Convert to Shapes (#1215, the whole street). "Make every car in this lane
 * mine" / "turn this row of stencils into plain markings I can copy".
 *
 * Every clone the generator currently places becomes the same plain
 * `Detached Model • <mixin>` entity a per-object detach makes (same mixin,
 * pose and segment, a stencil's geometry/polygon-offset/batch-member
 * carried along), and the generator component is removed from the segment
 * so nothing regenerates; its `skip` bookkeeping goes with it. One undo
 * entry: undo re-adds the generator with its previous data, which
 * regenerates the clones exactly where they were (holes from earlier
 * per-object detaches included), and removes the plain entities.
 *
 * Payload: `{ entity, component, focus? }` — the street-segment, the
 * generator component name on it (`street-generated-clones__1`, ...) and,
 * optionally, the clone the user had selected when they pressed "Detach
 * all" in its panel. Composed from the existing entitycreate +
 * componentremove commands; the creates run with `noSelectEntity` and the
 * batch lands the selection once it has run: on the focused clone's plain
 * replacement after execute (and the regenerated clone at the same slot
 * after undo), so the object the user was editing stays selected; on the
 * segment when there is no focus (the generator section's pill, the AI
 * tool).
 */
export class DetachAllClonesCommand extends MultiCommand {
  // AI tool (registry.js picks this up from commandsByType). The generator
  // is addressed the same way detachClone addresses a clone, minus the slot.
  static llmTool = {
    name: 'detachAllClones',
    description:
      "Detach every clone a generator (street-generated-clones, street-generated-stencil or street-generated-pedestrians component on a managed street segment) currently places, so each vehicle, tree, prop, stencil or pedestrian becomes a plain entity that can be moved, rotated, duplicated or deleted on its own, and remove that generator from the segment so nothing regenerates. The rest of the street stays managed. Use detachClone for a single object and convertStreetToShapes for the whole street. Name the generator by the segment entity and the component name on it; segments list their generators as 'street-generated-*' components in the scene state.",
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
        }
      },
      required: ['segmentId', 'component']
    }
  };

  static transformLLMArgs(args) {
    return resolveDetachAllToolArgs(args);
  }

  constructor(editor, payload) {
    const segmentEl = payload.entity;
    const componentName = payload.component;
    const { clones, commands } = buildDetachAllCommands(
      segmentEl,
      componentName
    );
    // Runs once the whole batch has: after execute (the creates wait for
    // their entities to load) and after undo (synchronous). Undo selects
    // for itself (see undo), so only execute is handled here.
    super(editor, commands, () => {
      if (!this.undoing) this.selectAfterExecute();
    });
    this.type = 'detachallclones';
    this.name = 'Detach All Models';
    this.segmentEl = segmentEl;
    this.componentName = componentName;
    this.count = clones.length;
    this.undoing = false;
    // The clone the user was on, as its position in the batch (its plain
    // replacement is made by commands[focusIndex]) and its generator slot
    // (where undo regenerates it). -1 / null: land on the segment.
    this.focusIndex = payload.focus ? clones.indexOf(payload.focus) : -1;
    this.focusSlot =
      this.focusIndex === -1 ? null : getCloneSlot(payload.focus).index;
  }

  selectAfterExecute() {
    const createCmd = this.commands[this.focusIndex];
    const detachedEl =
      createCmd?.entityId && document.getElementById(createCmd.entityId);
    if (detachedEl?.isConnected) {
      this.editor.selectEntity(detachedEl);
    } else if (this.segmentEl.isConnected) {
      this.editor.selectEntity(this.segmentEl);
    }
  }

  undo() {
    this.undoing = true;
    try {
      super.undo();
    } finally {
      this.undoing = false;
    }
    // The generator is back and has regenerated its clones; hand the
    // selection to the one at the focused slot, like a per-object detach's
    // undo (DetachCloneCommand), or to the segment.
    const clone =
      this.focusSlot === null
        ? null
        : findCloneAtSlot(this.segmentEl, this.componentName, this.focusSlot);
    if (!clone) {
      if (this.segmentEl.isConnected) this.editor.selectEntity(this.segmentEl);
      return;
    }
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

  execute() {
    const result = super.execute();
    // Same voice as the per-object toast (DetachCloneCommand): say what
    // just happened and that Undo reverses it. Reached through the global:
    // notify is an A-Frame component and unit tests have no scene.
    const n = this.count;
    globalThis.STREET?.notify?.successMessage?.(
      n === 1
        ? '1 object detached from the street generator: it is now a plain model you can move, rotate, duplicate or delete. Undo puts it back.'
        : `${n} objects detached from the street generator: they are now plain models you can move, rotate, duplicate or delete. Undo puts them back.`
    );
    return result;
  }
}
