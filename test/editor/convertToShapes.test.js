import { describe, expect, it, afterEach } from 'vitest';
import {
  toShapesData,
  shapesLayerName
} from '../../src/editor/lib/convertToShapes.js';

// A serialized managed street in getElementData({ includeAutocreated: true })
// form, reduced to the shapes the transform must handle: the managed root
// (managed-street + street-align/ground/label), a segment with its baked
// surface and generated components, mixin-based clone children, a striping
// plane, the street-ground dirtbox, and runtime-only entities (street-label
// canvas plane, street-generated-grass holder).
function makeStreetData() {
  return {
    id: 'street-1',
    'data-layer-name': 'Market Street',
    components: {
      position: '0 0 10',
      rotation: '0 90 0',
      'managed-street': 'sourceType: streetmix-url; length: 60',
      'street-align': 'width: center; length: start',
      'street-ground': '',
      'street-label': 'enabled: true'
    },
    children: [
      {
        'data-layer-name': 'Drive Lane',
        components: {
          position: '1.5 0 0',
          'street-segment': 'type: drive-lane; width: 3; length: 60',
          'street-generated-clones__1':
            'mode: random; modelsArray: sedan-rig; spacing: 7.3',
          'street-generated-striping__1': 'striping: solid-stripe',
          geometry: 'primitive: below-box; height: 0.2; depth: 60; width: 3',
          material: 'src: #seamless-road; repeat: 0.3 10',
          shadow: ''
        },
        children: [
          {
            class: ['autocreated'],
            mixin: 'sedan-rig',
            'data-layer-name': 'Cloned Model • sedan-rig',
            components: { position: '0 0 -12', rotation: '0 180 0' }
          },
          {
            class: ['autocreated'],
            'data-layer-name': 'Cloned Striping • striping-solid-stripe',
            components: {
              position: '-1.5 0.05 0',
              rotation: '-90 0 0',
              geometry: 'primitive: plane; width: 0.2; height: 60',
              material: 'src: #striping-solid-stripe; transparent: true',
              'polygon-offset': 'factor: -2; units: -2'
            }
          },
          {
            // street-generated-grass holder: instanced mesh lives on
            // object3D, nothing serializable survives
            class: ['autocreated'],
            'data-layer-name': 'Animated Grass',
            components: { position: '0 0.1 0', visible: 'true' }
          }
        ]
      },
      {
        // street-ground dirtbox
        element: 'a-box',
        class: ['autocreated', '.dirtbox'],
        'data-layer-name': 'Underground',
        components: {
          position: '0 -1 -30',
          geometry: 'primitive: box; width: 12; height: 2; depth: 59.8',
          material: 'color: #664B00'
        }
      },
      {
        // street-label plane: its material is painted onto a runtime canvas
        class: ['autocreated'],
        'data-layer-name': 'Segment Labels',
        components: {
          position: '0 -2 31',
          geometry: 'primitive: plane; width: 12; height: 2.5',
          material: 'src: #street-label-canvas-test; transparent: true'
        }
      }
    ]
  };
}

describe('toShapesData', () => {
  afterEach(() => {
    document.getElementById('street-label-canvas-test')?.remove();
  });

  function convert() {
    // the street-label plane is only skippable because its material src
    // resolves to a live <canvas>
    const canvas = document.createElement('canvas');
    canvas.id = 'street-label-canvas-test';
    document.body.appendChild(canvas);
    return toShapesData(makeStreetData());
  }

  it('strips managed components from the root but keeps its transform', () => {
    const shapes = convert();
    expect(shapes.id).toBe('street-1');
    expect(shapes['data-layer-name']).toBe('Market Street');
    expect(shapes.components).toEqual({
      position: '0 0 10',
      rotation: '0 90 0'
    });
  });

  it('bakes the segment surface and drops street-segment/generated config', () => {
    const segment = convert().children[0];
    expect(segment.components['street-segment']).toBeUndefined();
    expect(segment.components['street-generated-clones__1']).toBeUndefined();
    expect(segment.components['street-generated-striping__1']).toBeUndefined();
    expect(segment.components.geometry).toContain('below-box');
    expect(segment.components.material).toContain('#seamless-road');
    expect(segment.components.shadow).toBe('');
  });

  it('keeps generated children as plain entities without the autocreated marker', () => {
    const segment = convert().children[0];
    const [clone, striping] = segment.children;
    expect(clone.mixin).toBe('sedan-rig');
    expect(clone.class).toBeUndefined();
    expect(clone.components.position).toBe('0 0 -12');
    expect(striping.components.geometry).toContain('plane');
    expect(striping.class).toBeUndefined();
  });

  it('drops entities with no serializable visual form', () => {
    const shapes = convert();
    const segmentChildren = shapes.children[0].children;
    expect(segmentChildren).toHaveLength(2); // grass holder dropped
    const names = shapes.children.map((c) => c['data-layer-name']);
    expect(names).not.toContain('Segment Labels'); // canvas material dropped
  });

  it('keeps the dirtbox as an ordinary box', () => {
    const dirtbox = convert().children.find(
      (c) => c['data-layer-name'] === 'Underground'
    );
    expect(dirtbox.element).toBe('a-box');
    expect(dirtbox.class).toEqual(['.dirtbox']);
    expect(dirtbox.components.material).toContain('#664B00');
  });

  it('does not treat a canvas-id material as runtime-only when no canvas exists', () => {
    // same data but without mounting the canvas: the selector no longer
    // resolves to a <canvas>, so the entity is kept
    const shapes = toShapesData(makeStreetData());
    const names = shapes.children.map((c) => c['data-layer-name']);
    expect(names).toContain('Segment Labels');
  });
});

describe('shapesLayerName', () => {
  it('replaces the managed kind before the bullet', () => {
    expect(shapesLayerName('Managed Street • 60ft Right of Way')).toBe(
      'Street Shapes • 60ft Right of Way'
    );
    expect(shapesLayerName('Street • 3dstreet-demo-street')).toBe(
      'Street Shapes • 3dstreet-demo-street'
    );
  });

  it('prefixes names that carry no kind', () => {
    expect(shapesLayerName('My Renamed Street')).toBe(
      'Street Shapes • My Renamed Street'
    );
  });

  it('falls back to a bare label for unnamed streets', () => {
    expect(shapesLayerName(undefined)).toBe('Street Shapes');
    expect(shapesLayerName('  ')).toBe('Street Shapes');
  });
});
