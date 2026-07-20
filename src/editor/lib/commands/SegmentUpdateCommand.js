import Events from '../Events.js';
import { Command } from '../command.js';
import { createUniqueId } from '../entity.js';

const GENERATED_TYPES = [
  'clones',
  'stencil',
  'pedestrians',
  'striping',
  'rail'
];

function snapshotSegment(entity) {
  // Note: do NOT call entity.flushToDOM() here — it puts components into a
  // state where subsequent setAttribute calls on the same component are
  // silently ignored (A-Frame quirk around attrValue/data merging).
  const snapshot = {
    'street-segment': structuredClone(entity.getAttribute('street-segment')),
    'data-layer-name': entity.getAttribute('data-layer-name'),
    generated: {}
  };
  Object.keys(entity.components).forEach((name) => {
    if (name.startsWith('street-generated-')) {
      snapshot.generated[name] = structuredClone(entity.getAttribute(name));
    }
  });
  return snapshot;
}

function restoreSegment(entity, snapshot) {
  // Drop any street-generated-* components currently on the entity that
  // aren't in the snapshot, then re-apply snapshot components.
  Object.keys(entity.components).forEach((name) => {
    if (name.startsWith('street-generated-') && !snapshot.generated[name]) {
      entity.removeAttribute(name);
    }
  });
  entity.setAttribute('street-segment', snapshot['street-segment']);
  if (snapshot['data-layer-name'] !== null) {
    entity.setAttribute('data-layer-name', snapshot['data-layer-name']);
  }
  Object.entries(snapshot.generated).forEach(([name, value]) => {
    entity.setAttribute(name, value);
  });
}

/**
 * Patches a street-segment's properties and (optionally) regenerates its
 * generated components from a `generated` payload.
 *
 * payload: { entity, segment, name? }
 *   - entity: the street-segment DOM element
 *   - segment: partial patch — any of { name, type, surface, color, elevation,
 *     width, direction, generated }. `generated[type] = []` or `null` removes
 *     all street-generated-${type}* components on the segment.
 *   - name: optional history label (e.g. "Update bike lane width")
 */
export class SegmentUpdateCommand extends Command {
  constructor(editor, payload) {
    super(editor);

    this.type = 'segmentupdate';
    this.name = payload.name || 'Update Segment';
    this.updatable = false;

    const entity = payload.entity;
    if (!entity.id) {
      entity.id = createUniqueId();
    }
    this.entityId = entity.id;
    this.segment = payload.segment;
    this.before = snapshotSegment(entity);
  }

  apply(entity) {
    const segment = this.segment;
    const currentData = entity.getAttribute('street-segment');
    const updatedData = { ...currentData };
    Object.keys(segment).forEach((key) => {
      if (key !== 'generated') {
        updatedData[key] = segment[key];
      }
    });
    entity.setAttribute('street-segment', updatedData);

    if (segment.name) {
      entity.setAttribute('data-layer-name', segment.name);
    }

    if (segment.generated) {
      // Empty array or null means "clear all components of this type".
      GENERATED_TYPES.forEach((type) => {
        const value = segment.generated[type];
        const isClear =
          (Array.isArray(value) && value.length === 0) || value === null;
        if (!isClear) return;
        Object.keys(entity.components).forEach((componentName) => {
          if (componentName.startsWith(`street-generated-${type}`)) {
            entity.removeAttribute(componentName);
          }
        });
      });

      const hasNonEmptyArrays = GENERATED_TYPES.some(
        (type) =>
          Array.isArray(segment.generated[type]) &&
          segment.generated[type].length > 0
      );
      const hasOtherProperties = Object.keys(segment.generated).some(
        (key) => !GENERATED_TYPES.includes(key)
      );

      if (hasNonEmptyArrays || hasOtherProperties) {
        entity.components[
          'street-segment'
        ]?.generateComponentsFromSegmentObject({
          ...updatedData,
          generated: segment.generated
        });
      }
    }
  }

  execute(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;
    this.apply(entity);
    Events.emit('entityupdate', {
      entity,
      component: 'street-segment'
    });
    nextCommandCallback?.(entity);
  }

  undo(nextCommandCallback) {
    const entity = document.getElementById(this.entityId);
    if (!entity) return;
    restoreSegment(entity, this.before);
    Events.emit('entityupdate', {
      entity,
      component: 'street-segment'
    });
    nextCommandCallback?.(entity);
  }
}
