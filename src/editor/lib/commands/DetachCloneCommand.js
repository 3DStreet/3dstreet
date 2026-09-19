import { MultiCommand } from './MultiCommand.js';
import { buildDetachCommands, findCloneAtSlot } from '../detachClone.js';

/**
 * Detach one generated clone from its managed-street generator (#2011):
 * leave its slot empty (`skip`) and put a plain entity — same mixin, same
 * pose (or the pose a viewport drag ended at), under the same segment, no
 * `autocreated` marker — where the clone was. One undo entry: undo removes
 * the plain entity and restores the slot, so the generator regenerates the
 * clone exactly where it was; redo replays both.
 *
 * Payload: `{ entity, pose? }` where `entity` is the autocreated clone and
 * `pose` optionally overrides position/rotation/scale ("x y z" strings).
 *
 * Composed from the existing entityupdate + entitycreate commands rather
 * than reimplementing either, so the detached entity is selected on create
 * (and on redo) and the generator update goes through the same path as a
 * sidebar edit.
 */
export class DetachCloneCommand extends MultiCommand {
  constructor(editor, payload) {
    const { slot, commands } = buildDetachCommands(
      payload.entity,
      payload.pose
    );
    super(editor, commands);
    this.type = 'detachclone';
    this.name = 'Detach Model';
    this.slot = slot;
  }

  undo() {
    super.undo();
    // The create step's undo cleared the selection; hand it to the clone the
    // generator just put back so the user lands where they started.
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
