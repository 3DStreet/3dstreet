import { describe, expect, it } from 'vitest';
import {
  DETACHED_LAYER_PREFIX,
  buildDetachCommands,
  buildDetachedDefinition,
  findCloneAtSlot,
  getCloneSlot,
  isDetachableClone,
  poseFromObject3D
} from '../../src/editor/lib/detachClone.js';

// A segment element with a live generator component (the shape
// getCloneSlot/buildDetachCommands read: `components[name]` present and
// getAttribute(name) returning the parsed data), holding one generated
// clone. jsdom elements stand in for A-Frame entities; getDOMAttribute is
// modelled where the code prefers it.
function makeSegment({
  componentName = 'street-generated-clones__1',
  skip
} = {}) {
  const segment = document.createElement('a-entity');
  const data = { mode: 'fixed', spacing: 20, skip: skip ?? [] };
  segment.components = { [componentName]: { data } };
  const nativeGetAttribute = segment.getAttribute.bind(segment);
  segment.getAttribute = (name) =>
    name === componentName ? data : nativeGetAttribute(name);
  return segment;
}

function makeClone(
  segment,
  {
    componentName = 'street-generated-clones__1',
    index = 2,
    mixin = 'sedan-rig',
    autocreated = true
  } = {}
) {
  const clone = document.createElement('a-entity');
  if (autocreated) clone.classList.add('autocreated');
  clone.setAttribute('data-no-transform', '');
  clone.setAttribute('mixin', mixin);
  clone.setAttribute('data-parent-component', componentName);
  if (index !== null) clone.setAttribute('data-clone-index', index);
  clone.setAttribute('position', '1.5 0 -12');
  clone.setAttribute('rotation', '0 180 0');
  segment.appendChild(clone);
  return clone;
}

describe('detachClone (#2011)', () => {
  describe('getCloneSlot / isDetachableClone', () => {
    it('resolves a stamped clone of a slot-aware generator', () => {
      const segment = makeSegment();
      const clone = makeClone(segment, { index: 4 });
      expect(getCloneSlot(clone)).toEqual({
        segmentEl: segment,
        componentName: 'street-generated-clones__1',
        index: 4
      });
      expect(isDetachableClone(clone)).toBe(true);
    });

    it('accepts stencil and pedestrian clones', () => {
      for (const componentName of [
        'street-generated-stencil__1',
        'street-generated-pedestrians__1'
      ]) {
        const segment = makeSegment({ componentName });
        const clone = makeClone(segment, { componentName });
        expect(isDetachableClone(clone)).toBe(true);
      }
    });

    it('rejects a clone without a slot stamp (pre-slot generators)', () => {
      const segment = makeSegment();
      const clone = makeClone(segment, { index: null });
      expect(getCloneSlot(clone)).toBeNull();
      expect(isDetachableClone(clone)).toBe(false);
    });

    it('rejects surface generators, plain entities and null', () => {
      const striping = makeSegment({
        componentName: 'street-generated-striping__1'
      });
      const stripe = makeClone(striping, {
        componentName: 'street-generated-striping__1'
      });
      expect(isDetachableClone(stripe)).toBe(false);

      const segment = makeSegment();
      const plain = makeClone(segment, { autocreated: false });
      expect(isDetachableClone(plain)).toBe(false);

      expect(isDetachableClone(null)).toBe(false);
      expect(isDetachableClone(undefined)).toBe(false);
    });

    it('rejects a clone whose parent no longer carries the generator', () => {
      const segment = makeSegment({
        componentName: 'street-generated-clones__2'
      });
      const clone = makeClone(segment); // stamped __1, parent only has __2
      expect(isDetachableClone(clone)).toBe(false);
    });
  });

  describe('findCloneAtSlot', () => {
    it('finds the live clone for a generator slot', () => {
      const segment = makeSegment();
      makeClone(segment, { index: 0 });
      const wanted = makeClone(segment, { index: 1 });
      makeClone(segment, {
        componentName: 'street-generated-stencil__1',
        index: 1
      });
      expect(findCloneAtSlot(segment, 'street-generated-clones__1', 1)).toBe(
        wanted
      );
      expect(
        findCloneAtSlot(segment, 'street-generated-clones__1', 7)
      ).toBeNull();
      expect(findCloneAtSlot(null, 'street-generated-clones__1', 1)).toBeNull();
    });
  });

  describe('buildDetachedDefinition', () => {
    it('is a plain entity with the clone mixin and pose under the segment', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const definition = buildDetachedDefinition(clone);
      expect(definition).toEqual({
        parentEl: segment,
        mixin: 'sedan-rig',
        'data-layer-name': DETACHED_LAYER_PREFIX + 'sedan-rig',
        components: { position: '1.5 0 -12', rotation: '0 180 0' }
      });
      // Not a generated clone any more: no marker class, no gate, no slot.
      expect(definition.class).toBeUndefined();
      expect(definition['data-no-transform']).toBeUndefined();
      expect(definition['data-parent-component']).toBeUndefined();
      expect(definition['data-clone-index']).toBeUndefined();
    });

    it('takes the dragged pose over the clone pose', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const definition = buildDetachedDefinition(clone, {
        position: '3 0 -20',
        rotation: { x: 0, y: 90, z: 0 },
        scale: '1 1 1'
      });
      expect(definition.components).toEqual({
        position: '3 0 -20',
        rotation: '0 90 0',
        scale: '1 1 1'
      });
    });

    it('reads A-Frame vec3 objects from the clone', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const native = clone.getAttribute.bind(clone);
      clone.getAttribute = (name) =>
        name === 'position' ? { x: 1.5, y: 0, z: -12 } : native(name);
      expect(buildDetachedDefinition(clone).components.position).toBe(
        '1.5 0 -12'
      );
    });

    it("carries a stencil's own geometry, polygon-offset and batch hook", () => {
      const segment = makeSegment({
        componentName: 'street-generated-stencil__1'
      });
      const clone = makeClone(segment, {
        componentName: 'street-generated-stencil__1',
        mixin: 'bike-arrow'
      });
      clone.setAttribute('geometry', 'height: 2');
      clone.setAttribute('polygon-offset', 'factor: -2; units: -2');
      clone.setAttribute('batch-member', '');
      clone.getDOMAttribute = (name) =>
        ({
          geometry: { height: 2 },
          'polygon-offset': { factor: -2, units: -2 },
          'batch-member': ''
        })[name];
      const definition = buildDetachedDefinition(clone);
      expect(definition.mixin).toBe('bike-arrow');
      expect(definition.components).toEqual({
        position: '1.5 0 -12',
        rotation: '0 180 0',
        geometry: { height: 2 },
        'polygon-offset': { factor: -2, units: -2 },
        'batch-member': ''
      });
    });
  });

  describe('buildDetachCommands', () => {
    it('appends the slot to skip, then creates the plain entity', () => {
      const segment = makeSegment({ skip: ['1'] });
      const clone = makeClone(segment, { index: 3 });
      const { slot, commands } = buildDetachCommands(clone);
      expect(slot).toEqual({
        segmentEl: segment,
        componentName: 'street-generated-clones__1',
        index: 3
      });
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual([
        'entityupdate',
        {
          entity: segment,
          component: 'street-generated-clones__1',
          property: 'skip',
          value: [1, 3],
          noSelectEntity: true
        }
      ]);
      expect(commands[1][0]).toBe('entitycreate');
      expect(commands[1][1].parentEl).toBe(segment);
      expect(commands[1][1].mixin).toBe('sedan-rig');
    });

    it('is idempotent on skip when the slot is already skipped', () => {
      const segment = makeSegment({ skip: [3] });
      const clone = makeClone(segment, { index: 3 });
      expect(buildDetachCommands(clone).commands[0][1].value).toEqual([3]);
    });

    it('throws for a non-detachable entity', () => {
      const segment = makeSegment();
      const plain = makeClone(segment, { autocreated: false });
      expect(() => buildDetachCommands(plain)).toThrow(/not a detachable/);
    });
  });

  describe('poseFromObject3D', () => {
    it('stringifies position, rotation (degrees) and scale to 3 decimals', () => {
      const object3D = {
        position: { x: 1.23456, y: 0, z: -12 },
        rotation: { x: 0, y: Math.PI, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
      expect(poseFromObject3D(object3D)).toEqual({
        position: '1.235 0 -12',
        rotation: '0 180 0',
        scale: '1 1 1'
      });
    });
  });
});
