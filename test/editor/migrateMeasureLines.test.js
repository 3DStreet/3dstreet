import { describe, it, expect } from 'vitest';
import { migrateMeasureLinesToShapes } from '../../src/tested/migrate-measure-lines.js';

// The saved-JSON shapes this migration must accept: elementToObject serializes
// component values as strings ('start: 1 2 3; end: 4 5 6'), but scenes written
// through other paths (MCP, hand-authored json-blob) can carry the object form.
const rulerNodeStringForm = () => ({
  id: 'ruler-1',
  components: {
    'data-layer-name': 'Measure Line • 1',
    'measure-line': 'start: 1 0 2; end: 4 0 6'
  }
});

describe('migrateMeasureLinesToShapes', () => {
  it('converts a string-form ruler into an open two-vertex shape', () => {
    const nodes = [rulerNodeStringForm()];
    migrateMeasureLinesToShapes(nodes);
    const node = nodes[0];
    expect(node.components['measure-line']).toBeUndefined();
    // Schema defaults everywhere: '' means open line, default style.
    expect(node.components.shape).toBe('');
    expect(node.children).toHaveLength(2);
    expect(node.children[0].components).toEqual({
      position: '1 0 2',
      'shape-vertex': ''
    });
    expect(node.children[1].components).toEqual({
      position: '4 0 6',
      'shape-vertex': ''
    });
  });

  it('keeps everything else on the entity, including its layer name', () => {
    const nodes = [rulerNodeStringForm()];
    migrateMeasureLinesToShapes(nodes);
    expect(nodes[0].id).toBe('ruler-1');
    expect(nodes[0].components['data-layer-name']).toBe('Measure Line • 1');
  });

  it('accepts the object form of start/end', () => {
    const nodes = [
      {
        components: {
          'measure-line': { start: { x: 1, y: 0, z: 2 }, end: '4 0 6' }
        }
      }
    ];
    migrateMeasureLinesToShapes(nodes);
    expect(nodes[0].children[0].components.position).toBe('1 0 2');
    expect(nodes[0].children[1].components.position).toBe('4 0 6');
  });

  it('coerces a degenerate or missing value to origin vertices', () => {
    const nodes = [{ components: { 'measure-line': '' } }];
    migrateMeasureLinesToShapes(nodes);
    expect(nodes[0].components.shape).toBe('');
    expect(nodes[0].children[0].components.position).toBe('0 0 0');
    expect(nodes[0].children[1].components.position).toBe('0 0 0');
  });

  it('walks nested children and leaves non-ruler nodes untouched', () => {
    const street = { components: { 'managed-street': '' }, children: [] };
    const group = {
      components: { 'data-layer-name': 'Group' },
      children: [rulerNodeStringForm(), street]
    };
    const nodes = [group];
    migrateMeasureLinesToShapes(nodes);
    expect(group.children[0].components.shape).toBe('');
    expect(group.children[0].children).toHaveLength(2);
    expect(street).toEqual({
      components: { 'managed-street': '' },
      children: []
    });
  });

  it('is idempotent: a second pass changes nothing', () => {
    const nodes = [rulerNodeStringForm()];
    migrateMeasureLinesToShapes(nodes);
    const snapshot = JSON.stringify(nodes);
    migrateMeasureLinesToShapes(nodes);
    expect(JSON.stringify(nodes)).toBe(snapshot);
  });

  it('tolerates malformed trees', () => {
    expect(() =>
      migrateMeasureLinesToShapes([null, 42, { children: 'nope' }, {}])
    ).not.toThrow();
    expect(() => migrateMeasureLinesToShapes(undefined)).not.toThrow();
  });
});
