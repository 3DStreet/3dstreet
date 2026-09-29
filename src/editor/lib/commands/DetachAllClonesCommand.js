import { MultiCommand } from './MultiCommand.js';
import {
  buildDetachAllCommands,
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
 * Payload: `{ entity, component }` — the street-segment and the generator
 * component name on it (`street-generated-clones__1`, ...). Composed from
 * the existing entitycreate + componentremove commands; the creates run
 * with `noSelectEntity` and the batch lands the selection on the segment,
 * whose panel the user pressed "Detach all" in.
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
    // The segment is where the user is (its generator section, or a clone's
    // "Placed by" header): land there after execute and after undo, once
    // the whole batch has run.
    super(editor, commands, () => {
      if (segmentEl.isConnected) editor.selectEntity(segmentEl);
    });
    this.type = 'detachallclones';
    this.name = 'Detach All Models';
    this.segmentEl = segmentEl;
    this.componentName = componentName;
    this.count = clones.length;
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
