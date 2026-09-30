import { afterEach, describe, expect, it } from 'vitest';
import {
  DETACHED_LAYER_PREFIX,
  buildDetachAllCommands,
  buildDetachCommands,
  buildDetachedDefinition,
  findCloneAtSlot,
  getCloneSlot,
  getDetachAllBlocker,
  hasGeneratorClones,
  isDetachableClone,
  listCloneSlots,
  listGeneratorClones,
  poseFromObject3D,
  rememberDetached,
  resolveDetachAllToolArgs,
  resolveDetachToolArgs,
  routeCloneEdit
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
    autocreated = true,
    key = '1.5 -12'
  } = {}
) {
  const clone = document.createElement('a-entity');
  if (autocreated) clone.classList.add('autocreated');
  clone.setAttribute('mixin', mixin);
  clone.setAttribute('data-parent-component', componentName);
  if (index !== null) clone.setAttribute('data-clone-index', index);
  if (key !== null) clone.setAttribute('data-clone-key', key);
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
        index: 4,
        key: '1.5 -12'
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

    it('rejects a clone without a placement key', () => {
      const segment = makeSegment();
      expect(isDetachableClone(makeClone(segment, { key: null }))).toBe(false);
      expect(isDetachableClone(makeClone(segment, { key: 'x' }))).toBe(false);
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
    it('appends the placement hole to skip, then creates the plain entity', () => {
      const segment = makeSegment({ skip: ['0 20'] });
      const clone = makeClone(segment, { index: 3, key: '1.5 -12' });
      const { slot, commands } = buildDetachCommands(clone);
      expect(slot).toEqual({
        segmentEl: segment,
        componentName: 'street-generated-clones__1',
        index: 3,
        key: '1.5 -12'
      });
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual([
        'entityupdate',
        {
          entity: segment,
          component: 'street-generated-clones__1',
          property: 'skip',
          value: ['0 20', '1.5 -12'],
          noSelectEntity: true
        }
      ]);
      expect(commands[1][0]).toBe('entitycreate');
      expect(commands[1][1].parentEl).toBe(segment);
      expect(commands[1][1].mixin).toBe('sedan-rig');
    });

    it('adds a second hole for a clone stacked on an existing hole', () => {
      // a live clone at a hole placement means a sibling spent the hole
      // (zero-padding stencil group): detaching it needs its own hole
      const segment = makeSegment({ skip: ['1.5 -12'] });
      const clone = makeClone(segment, { index: 3, key: '1.5 -12' });
      expect(buildDetachCommands(clone).commands[0][1].value).toEqual([
        '1.5 -12',
        '1.5 -12'
      ]);
    });

    it('throws for a non-detachable entity', () => {
      const segment = makeSegment();
      const plain = makeClone(segment, { autocreated: false });
      expect(() => buildDetachCommands(plain)).toThrow(/not a detachable/);
    });
  });

  describe('buildDetachCommands extras', () => {
    it('remove: leaves the hole and creates nothing', () => {
      const segment = makeSegment();
      const clone = makeClone(segment, { index: 1, key: '0 20' });
      const { commands } = buildDetachCommands(clone, {}, { remove: true });
      expect(commands).toHaveLength(1);
      expect(commands[0][1].value).toEqual(['0 20']);
    });

    it('carries a mixin swap and other component edits into the create', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const { commands } = buildDetachCommands(
        clone,
        {},
        { mixin: 'suv-rig', components: { visible: false } }
      );
      const def = commands[1][1];
      expect(def.mixin).toBe('suv-rig');
      expect(def['data-layer-name']).toBe(DETACHED_LAYER_PREFIX + 'suv-rig');
      expect(def.components.visible).toBe(false);
      expect(def.components.position).toBe('1.5 0 -12');
    });
  });

  // The command-layer rule: every door's edit on a clone becomes a detach.
  describe('routeCloneEdit', () => {
    it('leaves non-clone targets and unknown commands alone', () => {
      const segment = makeSegment();
      const plain = makeClone(segment, { autocreated: false });
      expect(
        routeCloneEdit('entityupdate', {
          entity: plain,
          component: 'position',
          value: '1 2 3'
        })
      ).toBeNull();
      expect(routeCloneEdit('entityupdate', {})).toBeNull();
      expect(routeCloneEdit('entityupdate', null)).toBeNull();
      const clone = makeClone(segment);
      expect(routeCloneEdit('entityreparent', { entity: clone })).toBeNull();
    });

    it('turns a transform field edit into a detach at the merged pose', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'position',
          property: 'x',
          value: 2
        })
      ).toEqual({
        cmdName: 'detachclone',
        payload: { entity: clone, pose: { position: { x: 2, y: 0, z: -12 } } }
      });
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'rotation',
          value: '0 45 0'
        }).payload.pose
      ).toEqual({ rotation: '0 45 0' });
    });

    it('turns a model change into a detach with the new mixin', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'mixin',
          value: 'suv-rig'
        })
      ).toEqual({
        cmdName: 'detachclone',
        payload: { entity: clone, pose: {}, mixin: 'suv-rig' }
      });
    });

    it('carries any other component edit onto the detached entity', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'visible',
          value: false
        }).payload.components
      ).toEqual({ visible: false });
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'shadow',
          property: 'cast',
          value: false
        }).payload.components
      ).toEqual({ shadow: { cast: false } });
    });

    it('turns delete into a hole and duplicate into a plain copy', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      // entityremove / entityclone take the entity itself as payload
      expect(routeCloneEdit('entityremove', clone)).toEqual({
        cmdName: 'detachclone',
        payload: { entity: clone, remove: true }
      });
      const copy = routeCloneEdit('entityclone', clone);
      expect(copy.cmdName).toBe('entitycreate');
      expect(copy.payload.mixin).toBe('sedan-rig');
      expect(copy.payload.parentEl).toBe(segment);
      expect(copy.payload.components.position).toBe('1.5 0 -12');
    });

    // The easy gizmo commits a whole drag as ONE multi command (a position
    // tuple and a rotation tuple), and MultiCommand builds its members
    // directly rather than through Inspector.execute — so the batch has to
    // be unwrapped here or the rule never sees the clone (the build that
    // shipped moved the clone in place, which the generator then discarded).
    it('folds a multi of pose edits on one clone into a single detach', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      expect(
        routeCloneEdit('multi', [
          [
            'entityupdate',
            {
              entity: clone,
              component: 'position',
              value: '4 0.15 -9',
              oldValue: '1.5 0 -12'
            }
          ],
          [
            'entityupdate',
            {
              entity: clone,
              component: 'rotation',
              value: '0 90 0',
              oldValue: '0 180 0'
            }
          ]
        ])
      ).toEqual({
        cmdName: 'detachclone',
        payload: {
          entity: clone,
          pose: { position: '4 0.15 -9', rotation: '0 90 0' }
        }
      });
    });

    it('folds mixed component edits on one clone, later edits winning', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const routed = routeCloneEdit('multi', [
        [
          'entityupdate',
          {
            entity: clone,
            component: 'material',
            property: 'color',
            value: '#f00'
          }
        ],
        [
          'entityupdate',
          {
            entity: clone,
            component: 'material',
            property: 'opacity',
            value: 0.5
          }
        ],
        ['entityupdate', { entity: clone, component: 'mixin', value: 'tree' }],
        ['entityupdate', { entity: clone, component: 'mixin', value: 'bench' }]
      ]);
      expect(routed).toEqual({
        cmdName: 'detachclone',
        payload: {
          entity: clone,
          pose: {},
          mixin: 'bench',
          components: { material: { color: '#f00', opacity: 0.5 } }
        }
      });
    });

    it('merges per-axis pose members instead of replacing the vector', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      expect(
        routeCloneEdit('multi', [
          [
            'entityupdate',
            { entity: clone, component: 'position', property: 'x', value: 5 }
          ],
          [
            'entityupdate',
            { entity: clone, component: 'position', property: 'z', value: 7 }
          ],
          [
            'entityupdate',
            { entity: clone, component: 'rotation', value: '0 90 0' }
          ]
        ])
      ).toEqual({
        cmdName: 'detachclone',
        payload: {
          entity: clone,
          pose: { position: { x: 5, y: 0, z: 7 }, rotation: '0 90 0' }
        }
      });
      // A whole-vector member followed by a per-axis one keeps the vector.
      expect(
        routeCloneEdit('multi', [
          [
            'entityupdate',
            { entity: clone, component: 'position', value: '3 4 5' }
          ],
          [
            'entityupdate',
            { entity: clone, component: 'position', property: 'y', value: 9 }
          ]
        ]).payload.pose
      ).toEqual({ position: { x: 3, y: 9, z: 5 } });
    });

    it("carries a folded member's callback", () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const cb = () => {};
      expect(
        routeCloneEdit('multi', [
          [
            'entityupdate',
            { entity: clone, component: 'mixin', value: 'tree' },
            cb
          ]
        ])
      ).toEqual({
        cmdName: 'detachclone',
        payload: { entity: clone, pose: {}, mixin: 'tree' },
        callback: cb
      });
      expect(
        routeCloneEdit('multi', [['entityclone', clone, cb]])
      ).toMatchObject({ cmdName: 'entitycreate', callback: cb });
    });

    it('routes each member of a mixed batch and keeps the others in place', () => {
      const segment = makeSegment();
      const clone = makeClone(segment);
      const other = makeClone(segment, { autocreated: false, key: null });
      const plainEdit = {
        entity: other,
        component: 'position',
        value: '0 0 0'
      };
      const cb = () => {};
      const routed = routeCloneEdit('multi', [
        ['entityupdate', plainEdit, cb],
        [
          'entityupdate',
          { entity: clone, component: 'position', value: '1 1 1' }
        ],
        [
          'entityupdate',
          { entity: clone, component: 'rotation', value: '0 5 0' }
        ],
        ['entityremove', clone]
      ]);
      expect(routed.cmdName).toBe('multi');
      expect(routed.payload).toEqual([
        ['entityupdate', plainEdit, cb],
        [
          'detachclone',
          {
            entity: clone,
            pose: { position: '1 1 1', rotation: '0 5 0' },
            remove: true
          }
        ]
      ]);
    });

    it('leaves a batch with no clone in it untouched', () => {
      const segment = makeSegment();
      const plain = makeClone(segment, { autocreated: false });
      const tuples = [
        [
          'entityupdate',
          { entity: plain, component: 'position', value: '1 1 1' }
        ],
        [
          'entityupdate',
          { entity: plain, component: 'rotation', value: '0 5 0' }
        ]
      ];
      expect(routeCloneEdit('multi', tuples)).toBeNull();
      expect(routeCloneEdit('multi', null)).toBeNull();
      expect(routeCloneEdit('multi', [])).toBeNull();
    });

    it('re-aims a batch at the plain entity a clone became', () => {
      const segment = makeSegment();
      document.body.appendChild(segment);
      const clone = makeClone(segment);
      const replacement = makeClone(segment, { autocreated: false, key: null });
      rememberDetached(clone, replacement);
      clone.remove();
      expect(
        routeCloneEdit('multi', [
          [
            'entityupdate',
            { entity: clone, component: 'position', value: '1 1 1' }
          ],
          [
            'entityupdate',
            { entity: clone, component: 'rotation', value: '0 5 0' }
          ]
        ])
      ).toEqual({
        cmdName: 'multi',
        payload: [
          [
            'entityupdate',
            { entity: replacement, component: 'position', value: '1 1 1' }
          ],
          [
            'entityupdate',
            { entity: replacement, component: 'rotation', value: '0 5 0' }
          ]
        ]
      });
      segment.remove();
    });

    it('re-aims an edit at a clone that was already detached', () => {
      const segment = makeSegment();
      document.body.appendChild(segment);
      const clone = makeClone(segment);
      const replacement = makeClone(segment, { autocreated: false, key: null });
      rememberDetached(clone, replacement);
      // still in the DOM: it is a live clone, so the edit detaches it
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'position',
          value: '0 0 0'
        }).cmdName
      ).toBe('detachclone');
      clone.remove();
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'position',
          value: '0 0 0'
        })
      ).toEqual({
        cmdName: 'entityupdate',
        payload: { entity: replacement, component: 'position', value: '0 0 0' }
      });
      expect(routeCloneEdit('entityremove', clone)).toEqual({
        cmdName: 'entityremove',
        payload: replacement
      });
      replacement.remove();
      expect(
        routeCloneEdit('entityupdate', {
          entity: clone,
          component: 'position',
          value: '0 0 0'
        })
      ).toBeNull();
      segment.remove();
    });
  });

  describe('listCloneSlots', () => {
    it('lists the live slots of one generator, sorted', () => {
      const segment = makeSegment();
      makeClone(segment, { index: 4 });
      makeClone(segment, { index: 0 });
      makeClone(segment, {
        index: 1,
        componentName: 'street-generated-stencil__1'
      });
      expect(listCloneSlots(segment, 'street-generated-clones__1')).toEqual([
        0, 4
      ]);
      expect(listCloneSlots(null, 'street-generated-clones__1')).toEqual([]);
    });
  });

  // The AI tool path: the model addresses a clone by segment + generator +
  // slot (clones have no id and are not in the scene state it sees), or
  // omits all three for the selection. Segments must sit inside the
  // editable scene roots (getEditableEntity).
  describe('resolveDetachToolArgs', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    function mountSegment(options) {
      const root = document.createElement('a-entity');
      root.id = 'street-container';
      root.isEntity = true;
      const segment = makeSegment(options);
      segment.id = 'seg-1';
      segment.isEntity = true;
      root.appendChild(segment);
      document.body.appendChild(root);
      return segment;
    }

    const addressed = (overrides) => ({
      segmentId: 'seg-1',
      component: 'street-generated-clones__1',
      slotIndex: 2,
      ...overrides
    });

    it('resolves segment + generator + slot to the clone, with the pose', () => {
      const segment = mountSegment();
      const clone = makeClone(segment, { index: 2 });
      expect(resolveDetachToolArgs(addressed({ position: '1 0 2' }))).toEqual({
        entity: clone,
        pose: { position: '1 0 2' }
      });
      expect(resolveDetachToolArgs(addressed()).pose).toEqual({});
    });

    it('falls back to the selected clone when nothing is addressed', () => {
      const segment = mountSegment();
      const clone = makeClone(segment, { index: 0 });
      expect(resolveDetachToolArgs({}, { selectedEntity: clone }).entity).toBe(
        clone
      );
      expect(() => resolveDetachToolArgs({}, {})).toThrow(
        /Nothing is selected/
      );
      const plain = makeClone(segment, { autocreated: false, index: 1 });
      expect(() =>
        resolveDetachToolArgs({}, { selectedEntity: plain })
      ).toThrow(/not a generated clone/);
    });

    it('names the live slots when the slot has no clone', () => {
      const segment = mountSegment({ skip: [2] });
      makeClone(segment, { index: 0 });
      makeClone(segment, { index: 1 });
      expect(() => resolveDetachToolArgs(addressed())).toThrow(
        /No clone at slot 2 .*Live slots: 0, 1/
      );
    });

    it('names the detachable generators when the component is wrong', () => {
      mountSegment();
      expect(() =>
        resolveDetachToolArgs(addressed({ component: 'street-generated-rail' }))
      ).toThrow(/Detachable generators on it: street-generated-clones__1/);
    });

    it('treats null fields as omitted and validates the pose', () => {
      const segment = mountSegment();
      const clone = makeClone(segment, { index: 0 });
      makeClone(segment, { index: 2, key: '0 0' });
      // slotIndex: null must not resolve to slot 0
      expect(() =>
        resolveDetachToolArgs(addressed({ slotIndex: null }))
      ).toThrow(/given together/);
      expect(
        resolveDetachToolArgs(
          { segmentId: null, component: null, slotIndex: null },
          { selectedEntity: clone }
        ).entity
      ).toBe(clone);
      expect(
        resolveDetachToolArgs(
          addressed({ position: ' 1 2  3 ', rotation: null })
        ).pose
      ).toEqual({ position: '1 2 3' });
      expect(() =>
        resolveDetachToolArgs(addressed({ position: 'abc' }))
      ).toThrow(/position must be "x y z" numbers/);
      expect(() =>
        resolveDetachToolArgs(addressed({ rotation: '0 90' }))
      ).toThrow(/rotation must be/);
    });

    it('rejects a partial address and an unknown segment', () => {
      mountSegment();
      expect(() => resolveDetachToolArgs({ segmentId: 'seg-1' })).toThrow(
        /given together/
      );
      expect(() =>
        resolveDetachToolArgs(addressed({ segmentId: 'nope' }))
      ).toThrow(/not found/);
    });
  });

  describe('detach all (#2036)', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    function mountSegment(options) {
      const root = document.createElement('a-entity');
      root.id = 'street-container';
      root.isEntity = true;
      const segment = makeSegment(options);
      segment.id = 'seg-1';
      segment.isEntity = true;
      root.appendChild(segment);
      document.body.appendChild(root);
      return segment;
    }

    describe('listGeneratorClones', () => {
      it('lists the live detachable clones of one generator in slot order', () => {
        const segment = makeSegment();
        segment.components['street-generated-stencil__1'] = { data: {} };
        const c3 = makeClone(segment, { index: 3, key: '0 9' });
        const c0 = makeClone(segment, { index: 0, key: '0 0' });
        // another generator's clone, a plain child and an unstamped clone
        makeClone(segment, {
          componentName: 'street-generated-stencil__1',
          index: 0,
          key: '0 1'
        });
        makeClone(segment, { autocreated: false, key: null, index: null });
        makeClone(segment, { index: 5, key: null });
        expect(
          listGeneratorClones(segment, 'street-generated-clones__1')
        ).toEqual([c0, c3]);
        expect(listGeneratorClones(null, 'street-generated-clones__1')).toEqual(
          []
        );
        expect(hasGeneratorClones(segment, 'street-generated-clones__1')).toBe(
          true
        );
        expect(hasGeneratorClones(segment, 'street-generated-clones__9')).toBe(
          false
        );
      });
    });

    describe('getDetachAllBlocker', () => {
      it('is null for a detachable generator with live clones, else a reason', () => {
        const segment = makeSegment();
        segment.components['street-generated-striping__1'] = { data: {} };
        expect(
          getDetachAllBlocker(segment, 'street-generated-clones__2')
        ).toMatchObject({ code: 'missing' });
        expect(
          getDetachAllBlocker(segment, 'street-generated-striping__1')
        ).toMatchObject({ code: 'surface' });
        expect(
          getDetachAllBlocker(segment, 'street-generated-clones__1')
        ).toMatchObject({ code: 'empty' });
        makeClone(segment);
        expect(
          getDetachAllBlocker(segment, 'street-generated-clones__1')
        ).toBeNull();
        expect(
          getDetachAllBlocker(null, 'street-generated-clones__1')
        ).toMatchObject({
          code: 'missing'
        });
      });
    });

    describe('buildDetachAllCommands', () => {
      it('creates one plain entity per clone, then removes the generator', () => {
        const segment = makeSegment({ skip: ['4 4'] });
        makeClone(segment, { index: 1, key: '0 -6', mixin: 'tree' });
        makeClone(segment, { index: 0, key: '0 -12', mixin: 'sedan-rig' });
        const { clones, commands } = buildDetachAllCommands(
          segment,
          'street-generated-clones__1'
        );
        expect(clones).toHaveLength(2);
        expect(commands).toHaveLength(3);
        expect(commands.map((c) => c[0])).toEqual([
          'entitycreate',
          'entitycreate',
          'componentremove'
        ]);
        // slot order, plain Detached Model entities under the segment
        expect(commands[0][1]).toMatchObject({
          parentEl: segment,
          mixin: 'sedan-rig',
          'data-layer-name': `${DETACHED_LAYER_PREFIX}sedan-rig`,
          noSelectEntity: true,
          components: { position: '1.5 0 -12', rotation: '0 180 0' }
        });
        expect(commands[1][1].mixin).toBe('tree');
        expect(commands[0][1].class).toBeUndefined();
        // the generator goes (skip and all); undo of componentremove restores it
        expect(commands[2][1]).toEqual({
          entity: segment,
          component: 'street-generated-clones__1'
        });
      });

      it('throws for a missing, non-detachable or empty generator', () => {
        const segment = makeSegment();
        segment.components['street-generated-striping__1'] = { data: {} };
        expect(() =>
          buildDetachAllCommands(segment, 'street-generated-clones__2')
        ).toThrow(/no 'street-generated-clones__2' generator/);
        expect(() =>
          buildDetachAllCommands(segment, 'street-generated-striping__1')
        ).toThrow(/surface generator/);
        expect(() =>
          buildDetachAllCommands(segment, 'street-generated-clones__1')
        ).toThrow(/no live clones/);
      });
    });

    describe('resolveDetachAllToolArgs', () => {
      it('resolves segment + generator to the command payload', () => {
        const segment = mountSegment();
        makeClone(segment);
        expect(
          resolveDetachAllToolArgs({
            segmentId: 'seg-1',
            component: 'street-generated-clones__1'
          })
        ).toEqual({ entity: segment, component: 'street-generated-clones__1' });
      });

      it('names the detachable generators when the component is wrong', () => {
        const segment = mountSegment();
        segment.components['street-generated-striping__1'] = { data: {} };
        expect(() =>
          resolveDetachAllToolArgs({
            segmentId: 'seg-1',
            component: 'street-generated-clones__3'
          })
        ).toThrow(
          /no 'street-generated-clones__3' generator.*street-generated-clones__1/
        );
        // omitted or null (function-calling models emit null): a plain
        // "required" message, never "no 'undefined' component"
        for (const component of [undefined, null, '']) {
          expect(() =>
            resolveDetachAllToolArgs({ segmentId: 'seg-1', component })
          ).toThrow(
            /^component is required\. Detachable generators on seg-1: street-generated-clones__1$/
          );
        }
        expect(() =>
          resolveDetachAllToolArgs({
            segmentId: 'seg-1',
            component: 'street-generated-striping__1'
          })
        ).toThrow(/surface generator/);
      });

      it('rejects a generator with nothing left to detach and an unknown segment', () => {
        mountSegment();
        expect(() =>
          resolveDetachAllToolArgs({
            segmentId: 'seg-1',
            component: 'street-generated-clones__1'
          })
        ).toThrow(/no live clones to detach.*componentRemove/);
        expect(() =>
          resolveDetachAllToolArgs({
            segmentId: 'nope',
            component: 'street-generated-clones__1'
          })
        ).toThrow(/not found/);
      });
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
