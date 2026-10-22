import { describe, expect, it } from 'vitest';
import {
  describeConformedItems,
  conformToKindLimits
} from '../../src/tested/group-pose.js';
import { kindsOfEntity } from '../../src/tested/transform-kinds.js';
import { migrateMeasureLinesToShapes } from '../../src/tested/migrate-measure-lines.js';

const street = (id, components) => ({
  id,
  'data-layer-name': id,
  components: { 'managed-street': '', ...components }
});

const clone = (value) => JSON.parse(JSON.stringify(value));

describe('conformToKindLimits on streets, intersections and shapes', () => {
  it('leaves a tilted managed street at unit scale exactly as saved (fails if managed streets are treated as heading-only)', () => {
    const data = [street('s', { rotation: '5 30 0' })];
    const pristine = clone(data);
    expect(conformToKindLimits(data)).toEqual([]);
    expect(data).toEqual(pristine);
  });

  it('gives a scaled managed street unit scale and keeps its position, rotation and settings (fails if managed streets may keep a scale)', () => {
    const data = [
      street('s', {
        position: '3 0 4',
        rotation: '0 30 0',
        scale: '2 1 2',
        'managed-street': 'sourceType: json-blob; length: 60',
        'street-align': 'width: center; length: start'
      })
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components).toEqual({
      'managed-street': 'sourceType: json-blob; length: 60',
      'street-align': 'width: center; length: start',
      position: '3 0 4',
      rotation: '0 30 0',
      scale: '1 1 1'
    });
    expect(changes).toEqual([
      { id: 's', name: 's', kind: 'managed-street', scale: '2 1 2' }
    ]);
  });

  it('gives a mirrored and a zero-scale street unit scale (fails if the unit test reads each axis by its magnitude)', () => {
    const data = [
      street('mirrored', { scale: '-1 1 1' }),
      street('flat', { scale: '0 0 0' })
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components.scale).toBe('1 1 1');
    expect(data[1].components.scale).toBe('1 1 1');
    expect(changes).toEqual([
      {
        id: 'mirrored',
        name: 'mirrored',
        kind: 'managed-street',
        scale: '-1 1 1'
      },
      { id: 'flat', name: 'flat', kind: 'managed-street', scale: '0 0 0' }
    ]);
  });

  it('gives a scaled managed intersection unit scale and keeps its tilt (fails if managed intersections may keep a scale, or are treated as heading-only)', () => {
    const data = [
      {
        id: 'x',
        components: {
          'managed-intersection': '',
          rotation: '3 0 0',
          scale: '1.2 1.2 1.2'
        }
      }
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components).toEqual({
      'managed-intersection': '',
      rotation: '3 0 0',
      scale: '1 1 1'
    });
    expect(changes).toEqual([
      {
        id: 'x',
        name: undefined,
        kind: 'managed-intersection',
        scale: '1.2 1.2 1.2'
      }
    ]);
  });

  it('gives a scaled shape unit scale, keeping its heading and its shape settings (fails if shapes may keep a scale)', () => {
    const data = [
      {
        id: 'area',
        components: {
          shape: 'closed: true; lineWidth: 0.5',
          rotation: '0 45 0',
          scale: '2 1 2'
        }
      }
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components).toEqual({
      shape: 'closed: true; lineWidth: 0.5',
      rotation: '0 45 0',
      scale: '1 1 1'
    });
    expect(changes).toEqual([
      { id: 'area', name: undefined, kind: 'shape', scale: '2 1 2' }
    ]);
  });

  it('lays a tilted shape flat with the same heading, and keeps the facing of one turned past 90 degrees (fails if shapes may tilt, or X and Z are zeroed without keeping the facing)', () => {
    const tilted = { id: 'a', components: { shape: '', rotation: '0 30 20' } };
    const over = { id: 'b', components: { shape: '', rotation: '170 30 0' } };
    const changes = conformToKindLimits([tilted, over]);
    expect(tilted.components.rotation).toBe('0 30 0');
    expect(over.components.rotation).toBe('0 -150 0');
    expect(changes).toEqual([
      { id: 'a', name: undefined, kind: 'shape', rotation: '0 30 20' },
      {
        id: 'b',
        name: undefined,
        kind: 'shape',
        rotation: '170 30 0',
        newY: -150
      }
    ]);
  });

  it('gives a scaled group and the scaled street inside it unit scale, the group listed first (fails if the walk stops at a changed item or lists children first)', () => {
    const data = [
      {
        id: 'outer',
        class: ['user-group'],
        'data-layer-name': 'Outer group',
        components: { scale: '2 2 2' },
        children: [
          {
            id: 'main',
            'data-layer-name': 'Main Street',
            components: { 'managed-street': '', scale: '2 1 2' }
          }
        ]
      }
    ];
    const changes = conformToKindLimits(data);
    expect(data[0].components.scale).toBe('1 1 1');
    expect(data[0].children[0].components.scale).toBe('1 1 1');
    expect(changes).toEqual([
      { id: 'outer', name: 'Outer group', kind: 'group', scale: '2 2 2' },
      {
        id: 'main',
        name: 'Main Street',
        kind: 'managed-street',
        scale: '2 1 2'
      }
    ]);
  });

  it.each([
    [
      'a classic street',
      {
        id: 'classic',
        components: {
          street: 'length: 60',
          'streetmix-loader': 'streetmixStreetURL: https://streetmix.net/x/1',
          scale: '2 2 2'
        }
      }
    ],
    [
      'the older intersection',
      { id: 'old', components: { intersection: '', scale: '2 2 2' } }
    ],
    [
      'a plain box',
      {
        id: 'box',
        primitive: 'box',
        components: { rotation: '20 30 10', scale: '2 1 1' }
      }
    ],
    [
      'a second instance of the shape component',
      { id: 'multi', components: { shape__x: '', scale: '2 2 2' } }
    ]
  ])(
    'leaves %s exactly as saved (fails if a component outside the kinds, or a prefix of a kind component, is matched)',
    (_, node) => {
      const data = [node];
      const pristine = clone(data);
      expect(conformToKindLimits(data)).toEqual([]);
      expect(data).toEqual(pristine);
    }
  );

  it.each([
    ['readable', () => ({ scale: { x: 3, y: 3, z: 3 } })],
    ['unreadable', () => null]
  ])(
    'leaves a visitor-build object, which carries markers but is no kind, exactly as defined, with its mixins %s (fails if bare markers are read as a kind)',
    (_, mixinPose) => {
      const definition = {
        parentEl: { id: 'build-area' },
        mixin: 'palm-tree',
        'data-layer-name': 'Palm Tree',
        'data-viewer-added': '',
        'data-transform-no-scale': '',
        'data-transform-no-reparent': '',
        components: {
          position: { x: 1, y: 0, z: 2 },
          rotation: { x: 0, y: 0, z: 0 }
        }
      };
      const pristine = clone(definition);
      expect(conformToKindLimits(definition, { mixinPose })).toEqual([]);
      expect(definition).toEqual(pristine);
    }
  );

  it('writes only what each kind limits when its mixins cannot be read: scale for a street, scale and rotation for a shape (fails if both components are written for every kind)', () => {
    const mixinStreet = {
      id: 's',
      mixin: 'odd',
      components: { 'managed-street': '' }
    };
    const mixinShape = { id: 'a', mixin: 'odd', components: { shape: '' } };
    const changes = conformToKindLimits([mixinStreet, mixinShape], {
      mixinPose: () => null
    });
    expect(changes).toEqual([]);
    expect(mixinStreet.components).toEqual({
      'managed-street': '',
      scale: '1 1 1'
    });
    expect(mixinShape.components).toEqual({
      shape: '',
      rotation: '0 0 0',
      scale: '1 1 1'
    });
  });

  it('turns an old ruler saved scaled into a shape at unit scale when the ruler migration runs first (fails if a component whose value is empty is not counted)', () => {
    const data = [
      {
        id: 'ruler',
        components: {
          'measure-line': 'start: 0 0 0; end: 8 0 0',
          scale: '2 2 2'
        }
      }
    ];
    migrateMeasureLinesToShapes(data);
    const changes = conformToKindLimits(data);
    expect(data[0].components.shape).toBe('');
    expect(data[0].components.scale).toBe('1 1 1');
    expect(changes).toEqual([
      { id: 'ruler', name: undefined, kind: 'shape', scale: '2 2 2' }
    ]);
  });
});

describe('describeConformedItems', () => {
  it('names each changed item with its kind, in walk order (fails on any wording, prefix or count drift, or if the kind is dropped)', () => {
    const data = [
      {
        id: 'outer',
        class: ['user-group'],
        'data-layer-name': 'Outer group',
        components: { scale: '2 2 2' },
        children: [
          {
            id: 'main',
            'data-layer-name': 'Main Street',
            components: { 'managed-street': '', scale: '2 1 2' }
          }
        ]
      }
    ];
    expect(describeConformedItems(conformToKindLimits(data))).toBe(
      '[scene-load] Brought 2 items within their kinds\' limits; position and heading kept: group "Outer group" (removed scale 2 2 2), managed street "Main Street" (removed scale 2 1 2).'
    );
  });

  it('names an unnamed item by its kind alone, in the singular', () => {
    const data = [{ components: { shape: '', rotation: '0 30 20' } }];
    expect(describeConformedItems(conformToKindLimits(data))).toBe(
      "[scene-load] Brought 1 item within its kind's limits; position and heading kept: shape (unnamed) (removed rotation x 0, z 20)."
    );
  });

  it('returns null when nothing was changed', () => {
    expect(describeConformedItems([])).toBeNull();
  });
});

describe('kindsOfEntity', () => {
  const element = (setup) => {
    const el = document.createElement('div');
    setup(el);
    return el;
  };

  it.each([
    ['the group class', (el) => el.classList.add('user-group'), ['group']],
    ['a shape attribute', (el) => el.setAttribute('shape', ''), ['shape']],
    [
      'a managed-street attribute',
      (el) => el.setAttribute('managed-street', ''),
      ['managed-street']
    ],
    [
      'a managed-intersection attribute',
      (el) => el.setAttribute('managed-intersection', ''),
      ['managed-intersection']
    ],
    [
      'only a marker attribute',
      (el) => el.setAttribute('data-transform-no-scale', ''),
      []
    ]
  ])(
    'recognises %s (fails if bare markers are read as a kind)',
    (_, setup, ids) => {
      expect(kindsOfEntity(element(setup)).map((kind) => kind.id)).toEqual(ids);
    }
  );
});
