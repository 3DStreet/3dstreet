import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

/**
 * Inserts a new street-segment into a managed-street at a given index.
 * Captures the resulting entity id so undo can locate and remove it.
 *
 * payload: { streetId, segment, segmentIndex?, name? }
 *   - streetId: id of the managed-street parent
 *   - segment: object describing the segment (type, width, elevation,
 *     direction, color, surface, name, generated). All fields optional except
 *     type. `elevation` is meters (0 = road level, 0.15 = curb height).
 *   - segmentIndex: 0..N to insert at; if omitted or >= N, appends.
 *   - name: optional history label (e.g. "Add bike lane")
 */
export class SegmentAddCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'segmentadd';
    this.name = payload.name || 'Add Segment';
    this.updatable = false;

    this.streetId = payload.streetId;
    this.segment = payload.segment;
    this.segmentIndex = payload.segmentIndex;
    // Pre-allocate the id so undo/redo can find the same logical entity.
    this.entityId = createUniqueId();
  }

  execute(nextCommandCallback) {
    const streetEl = document.getElementById(this.streetId);
    if (!streetEl) {
      console.error(`[segmentadd] street ${this.streetId} not found`);
      return;
    }
    const segment = this.segment;

    const segmentEntities = Array.from(streetEl.children).filter((child) =>
      child.hasAttribute('street-segment')
    );

    const segmentEl = document.createElement('a-entity');
    segmentEl.id = this.entityId;

    const segmentData = {
      type: segment.type,
      width: typeof segment.width === 'number' ? segment.width : 3,
      length: streetEl.components['managed-street']?.data?.length || 60,
      elevation: typeof segment.elevation === 'number' ? segment.elevation : 0,
      direction: segment.direction || 'none',
      color: segment.color || '#888888',
      surface: segment.surface || 'asphalt'
    };
    segmentEl.setAttribute('street-segment', segmentData);
    segmentEl.setAttribute(
      'data-layer-name',
      segment.name || `${segment.type} • default`
    );

    const referenceNode =
      this.segmentIndex !== undefined &&
      this.segmentIndex < segmentEntities.length
        ? segmentEntities[this.segmentIndex]
        : null;

    if (referenceNode) {
      streetEl.insertBefore(segmentEl, referenceNode);
    } else {
      streetEl.appendChild(segmentEl);
    }

    segmentEl.addEventListener(
      'loaded',
      () => {
        segmentEl.pause();
        if (segment.generated) {
          segmentEl.components[
            'street-segment'
          ]?.generateComponentsFromSegmentObject(segment);
        }
        Events.emit('entitycreated', segmentEl);
        this.editor.selectEntity(segmentEl);
        nextCommandCallback?.(segmentEl);
      },
      { once: true }
    );

    return segmentEl;
  }

  undo(nextCommandCallback) {
    const segmentEl = document.getElementById(this.entityId);
    if (!segmentEl) return;

    segmentEl.parentNode.removeChild(segmentEl);
    Events.emit('entityremoved', segmentEl);
    this.editor.selectEntity(null);
    nextCommandCallback?.(null);
  }
}
