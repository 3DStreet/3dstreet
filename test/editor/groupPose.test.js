import { describe, expect, it } from 'vitest';
import {
  POSE_EPS,
  describeConformedItems,
  conformToKindLimits,
  levelledRotation,
  parseVec3LikeAFrame
} from '../../src/tested/group-pose.js';

const group = (id, components, extra = {}) => ({
  id,
  class: ['user-group'],
  'data-layer-name': id,
  components,
  ...extra
});

// A copy of the scene a load-time levelling is checked against: a scaled
// group with a member, an outer scaled group holding a tilted inner group, and
// a tilted, scaled box that is not a group.
const groupsToLevel = () => [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      {
        id: 'scaled-group',
        class: ['user-group'],
        'data-layer-name': 'Scaled group',
        components: {
          position: '0 0 -6',
          rotation: '0 30 0',
          scale: '1.5 1.5 1.5'
        },
        children: [
          {
            id: 'scaled-member',
            primitive: 'box',
            'data-layer-name': 'Member of scaled group',
            components: {
              position: '2 0.5 0',
              rotation: '0 15 0',
              scale: '1 2 1'
            }
          }
        ]
      },
      {
        id: 'outer-group',
        class: ['user-group'],
        'data-layer-name': 'Outer group',
        components: { position: '8 0 -6', scale: '2 2 2' },
        children: [
          {
            id: 'inner-group',
            class: ['user-group'],
            'data-layer-name': 'Inner tilted group',
            components: { position: '1 0 0', rotation: '10 45 0' },
            children: [
              {
                id: 'inner-member',
                primitive: 'box',
                components: { position: '0 0.5 0' }
              }
            ]
          }
        ]
      },
      {
        id: 'tilted-box',
        primitive: 'box',
        'data-layer-name': 'Tilted box (not a group)',
        components: {
          position: '-6 1 -6',
          rotation: '20 30 10',
          scale: '2 1 1'
        }
      }
    ]
  }
];

const LEVELLED_WARNING =
  '[scene-load] Brought 3 items within their kinds\' limits; position and heading kept: group "Scaled group" (removed scale 1.5 1.5 1.5), group "Outer group" (removed scale 2 2 2), group "Inner tilted group" (removed rotation x 10, z 0).';

describe('conformToKindLimits', () => {
  it('sets a group to unit scale and leaves its rotation, position and members alone (fails if the pass writes through to members or touches position)', () => {
    const data = [
      group(
        'g',
        { rotation: '0 30 0', scale: '1.5 1.5 1.5', position: '3 0 4' },
        {
          children: [
            { id: 'm', components: { rotation: '0 15 0', scale: '1 2 1' } }
          ]
        }
      )
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components).toEqual({
      rotation: '0 30 0',
      scale: '1 1 1',
      position: '3 0 4'
    });
    expect(data[0].children[0].components).toEqual({
      rotation: '0 15 0',
      scale: '1 2 1'
    });
    expect(changes).toEqual([
      { id: 'g', name: 'g', kind: 'group', scale: '1.5 1.5 1.5' }
    ]);
  });

  it('levels nested groups each in their own frame, parent listed first (fails if the walk stops at the first group or lists children first)', () => {
    const inner = group('inner', { rotation: '10 45 0' });
    const data = [group('outer', { scale: '2 2 2' }, { children: [inner] })];
    const changes = conformToKindLimits(data);
    expect(data[0].components.scale).toBe('1 1 1');
    expect(inner.components.rotation).toBe('0 45 0');
    expect(changes.map((c) => c.id)).toEqual(['outer', 'inner']);
  });

  it.each(['10 30 0', '0 30 5', '10 30 5'])(
    'removes a tilt on X, on Z or on both: %s (fails if only one axis is read)',
    (rotation) => {
      const data = [group('g', { rotation })];
      conformToKindLimits(data);
      expect(data[0].components.rotation).toBe('0 30 0');
    }
  );

  it.each([
    ['1 2 1', '1 1 1'],
    ['1 1 2', '1 1 1'],
    ['0.5 1 1', '1 1 1'],
    [
      { x: 1, y: 1, z: 2 },
      { x: 1, y: 1, z: 1 }
    ]
  ])(
    'removes a scale on any axis, keeping its form: %o (fails if only one axis or only strings are read)',
    (scale, expected) => {
      const data = [group('g', { scale })];
      conformToKindLimits(data);
      expect(data[0].components.scale).toEqual(expected);
    }
  );

  it('treats values within the tolerance as conforming and values just outside it as not (fails with an exact comparison or a looser tolerance)', () => {
    expect(POSE_EPS).toBe(1e-3);
    const inside = [
      group('g', { rotation: '0.0009 30 -0.0009', scale: '1.0009 1 0.9991' })
    ];
    expect(conformToKindLimits(inside)).toEqual([]);
    expect(inside[0].components).toEqual({
      rotation: '0.0009 30 -0.0009',
      scale: '1.0009 1 0.9991'
    });

    const outside = [
      group('g', { rotation: '0.002 30 0', scale: '1.002 1 1' })
    ];
    expect(conformToKindLimits(outside)).toHaveLength(1);
    expect(outside[0].components).toEqual({
      rotation: '0 30 0',
      scale: '1 1 1'
    });
  });

  it('leaves entities that are not groups alone (fails if any class, or a class containing the word, matches)', () => {
    const components = () => ({ rotation: '20 30 10', scale: '2 1 1' });
    const data = [
      { id: 'a', components: components() },
      { id: 'b', class: 'foo', components: components() },
      { id: 'c', class: ['user-groups'], components: components() }
    ];
    expect(conformToKindLimits(data)).toEqual([]);
    for (const node of data) expect(node.components).toEqual(components());
  });

  it('finds the group class as a string, an array or a component, and reads a partial rotation (fails if only the top-level class or only full strings are read)', () => {
    const asString = {
      id: 's',
      class: 'user-group',
      components: { rotation: '10 20 0' }
    };
    const asArray = {
      id: 'a',
      class: ['user-group'],
      components: { rotation: '10' }
    };
    const asComponent = {
      id: 'c',
      components: { class: 'user-group', scale: '2 2 2' }
    };
    const bare = { id: 'b', class: ['user-group'] };
    conformToKindLimits([asString, asArray, asComponent, bare]);
    expect(asString.components.rotation).toBe('0 20 0');
    expect(asArray.components.rotation).toBe('0 0 0');
    expect(asComponent.components.scale).toBe('1 1 1');
    expect(bare.components).toBeUndefined();
  });

  it('gives a group whose mixins cannot be read explicit unit scale and level rotation, without reporting it (fails if such groups are skipped or listed)', () => {
    const bare = { id: 'p', class: ['user-group'], mixin: 'palm-tree' };
    const turned = {
      id: 'q',
      class: ['user-group'],
      mixin: 'palm-tree',
      components: { rotation: '0 40 0' }
    };
    const mixinPose = () => null;
    expect(conformToKindLimits([bare, turned], { mixinPose })).toEqual([]);
    expect(bare.components).toEqual({ scale: '1 1 1', rotation: '0 0 0' });
    expect(turned.components).toEqual({ rotation: '0 40 0', scale: '1 1 1' });
    // With no way to read mixins at all, the same.
    const again = { id: 'r', class: ['user-group'], mixin: 'palm-tree' };
    conformToKindLimits([again]);
    expect(again.components).toEqual({ scale: '1 1 1', rotation: '0 0 0' });
  });

  it('leaves a group alone when what its mixins supply already conforms, keeping a mixin heading (fails if every mixin group gets explicit values)', () => {
    const turned = { id: 't', class: ['user-group'], mixin: 'turned' };
    const mixinPose = (mixin) =>
      mixin === 'turned' ? { rotation: { x: 0, y: 90, z: 0 } } : null;
    expect(conformToKindLimits([turned], { mixinPose })).toEqual([]);
    expect(turned.components).toBeUndefined();
  });

  it('levels what a mixin supplies when it does not conform, keeping its heading, and reports it (fails if the mixin value is ignored or its heading dropped)', () => {
    const node = { id: 'm', class: ['user-group'], mixin: 'odd' };
    const mixinPose = () => ({
      rotation: { x: 10, y: 90, z: 0 },
      scale: { x: 1, y: 1.5, z: 1 }
    });
    expect(conformToKindLimits([node], { mixinPose })).toEqual([
      {
        id: 'm',
        name: undefined,
        kind: 'group',
        rotation: { x: 10, y: 90, z: 0 },
        scale: { x: 1, y: 1.5, z: 1 }
      }
    ]);
    expect(node.components).toEqual({
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    });
  });

  it.each(['360 30 0', '0 30 -360', '720 30 360'])(
    'counts whole turns on X and Z as level: %s (fails if angles are compared without whole turns)',
    (rotation) => {
      const data = [group('g', { rotation })];
      expect(conformToKindLimits(data)).toEqual([]);
      expect(data[0].components.rotation).toBe(rotation);
    }
  );

  it.each([
    ['abc 30 0', '0 30 0'],
    ['0 30 xyz', '0 30 0']
  ])(
    'levels an X or Z that is not a number, as A-Frame would apply it as NaN: %s (fails if NaN counts as level)',
    (rotation, expected) => {
      const data = [group('g', { rotation })];
      expect(conformToKindLimits(data)).toHaveLength(1);
      expect(data[0].components.rotation).toBe(expected);
    }
  );

  it('keeps the facing when X is past 90 degrees and reports the new Y (fails if X and Z are zeroed and Y kept, if a half-turn pair counts as level, or if values are read with Number)', () => {
    const past90 = [group('a', { rotation: '170 30 0' })];
    expect(conformToKindLimits(past90)).toEqual([
      { id: 'a', name: 'a', kind: 'group', rotation: '170 30 0', newY: -150 }
    ]);
    expect(past90[0].components.rotation).toBe('0 -150 0');

    const vertical = [group('b', { rotation: '90 30 0' })];
    expect(conformToKindLimits(vertical)).toEqual([
      { id: 'b', name: 'b', kind: 'group', rotation: '90 30 0' }
    ]);
    expect(vertical[0].components.rotation).toBe('0 30 0');

    const halfTurn = [group('Turned group', { rotation: '180 30 180' })];
    const halfTurnChanges = conformToKindLimits(halfTurn);
    expect(halfTurnChanges).toEqual([
      {
        id: 'Turned group',
        name: 'Turned group',
        kind: 'group',
        rotation: '180 30 180',
        newY: -150
      }
    ]);
    expect(halfTurn[0].components.rotation).toBe('0 -150 0');
    expect(describeConformedItems(halfTurnChanges)).toBe(
      '[scene-load] Brought 1 item within its kind\'s limits; position and heading kept: group "Turned group" (removed rotation x 180, z 180, now facing y -150).'
    );

    const degrees = [group('d', { rotation: '10° 30 0' })];
    conformToKindLimits(degrees);
    expect(degrees[0].components.rotation).toBe('0 30 0');
  });

  it('writes a clean heading from a rotation read back from radians (fails if the heading is not rounded)', () => {
    expect(levelledRotation('10 29.999999999999996 5')).toBe('0 30 0');
    expect(levelledRotation('170 29.999999999999996 0')).toBe('0 -150 0');
    // A heading that is not a whole degree, on both sides of the wrap.
    expect(levelledRotation('10 30.1 0')).toBe('0 30.1 0');
    expect(levelledRotation('10 -0.1 0')).toBe('0 -0.1 0');
    expect(levelledRotation('170 30.1 0')).toBe('0 -149.9 0');
    expect(levelledRotation({ x: 10, y: -150.00000000000003, z: 0 })).toEqual({
      x: 0,
      y: -150,
      z: 0
    });
  });

  it('does not report a facing written as another turn of the same angle as a change of Y', () => {
    const data = [group('g', { rotation: '10 -330 0' })];
    expect(conformToKindLimits(data)).toEqual([
      { id: 'g', name: 'g', kind: 'group', rotation: '10 -330 0' }
    ]);
    expect(data[0].components.rotation).toBe('0 30 0');
  });
});

describe('describeConformedItems', () => {
  it('names every levelled group of a loaded scene, outer group included (fails on any wording or count drift)', () => {
    expect(describeConformedItems(conformToKindLimits(groupsToLevel()))).toBe(
      LEVELLED_WARNING
    );
  });

  it('joins a tilt and a scale on one group, and falls back to the id or "(unnamed)"', () => {
    const named = [group('Both', { rotation: '10 30 5', scale: '2 2 2' })];
    expect(describeConformedItems(conformToKindLimits(named))).toBe(
      '[scene-load] Brought 1 item within its kind\'s limits; position and heading kept: group "Both" (removed rotation x 10, z 5, scale 2 2 2).'
    );
    const unnamed = [
      { id: 'g1', class: ['user-group'], components: { scale: '2 2 2' } },
      { class: ['user-group'], components: { scale: '3 3 3' } }
    ];
    expect(describeConformedItems(conformToKindLimits(unnamed))).toBe(
      '[scene-load] Brought 2 items within their kinds\' limits; position and heading kept: group "g1" (removed scale 2 2 2), group (unnamed) (removed scale 3 3 3).'
    );
  });

  it('returns null when nothing was levelled', () => {
    expect(describeConformedItems([])).toBeNull();
  });
});

describe('parseVec3LikeAFrame', () => {
  const D = { x: 0, y: 0, z: 0 };
  it.each([
    ['10° 30 0', { x: 10, y: 30, z: 0 }],
    ['2,2,2', { x: 2, y: 0, z: 0 }],
    ['2m 2m 2m', { x: 2, y: 2, z: 2 }],
    ['0 40', { x: 0, y: 40, z: 0 }],
    ['', D],
    ['   ', D],
    [{ y: '30' }, { x: 0, y: 30, z: 0 }],
    [
      { x: null, y: 40, z: 0 },
      { x: undefined, y: 40, z: 0 }
    ],
    [[], D],
    [null, D],
    [2, { x: undefined, y: undefined, z: undefined }],
    [true, { x: undefined, y: undefined, z: undefined }]
  ])('reads %o as A-Frame applies it', (value, expected) => {
    expect(parseVec3LikeAFrame(value, D)).toEqual(expected);
  });

  it('reads a token that is not a number as NaN', () => {
    expect(parseVec3LikeAFrame('abc 30 0', D).x).toBeNaN();
  });
});
