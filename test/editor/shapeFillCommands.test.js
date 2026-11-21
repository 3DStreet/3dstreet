import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { History } from '@/editor/lib/history.js';
import { resolveCommand } from '@/editor/lib/resolveCommand.js';
import { reverseShapeDirection } from '@/editor/components/elements/ShapeSidebar.jsx';
import { defineEntityElement } from './lib/groups/_entityElement.js';

// A shape's fill Angle is set once, when it is drawn: no vertex edit and no
// Reverse may ever write it, or the pattern would swing round as the user
// reshapes. Driven through the real commands and the real Reverse, on a shape
// whose vertices are real entity elements.

defineEntityElement();

let inspector;
let shapeWrites;
let shape;

beforeEach(() => {
  inspector = { selectedEntity: null, config: {}, selectEntity: vi.fn() };
  inspector.history = new History(inspector);
  inspector.execute = (type, payload, name, callback) => {
    const r = resolveCommand(type, payload, name, callback);
    return inspector.history.execute(
      new r.Cmd(inspector, r.payload, r.callback),
      r.optionalName
    );
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector, components: {} });

  shape = document.createElement('a-entity');
  shape.id = 'fill-angle-shape';
  // Every write to the shape element itself is recorded.
  shapeWrites = [];
  const set = shape.setAttribute.bind(shape);
  shape.setAttribute = (...args) => {
    shapeWrites.push(args);
    return set(...args);
  };
  // As the component does: its vertices are its children, in order.
  shape.components.shape = {
    getVertexEls: () => Array.from(shape.children)
  };
  document.body.appendChild(shape);
  for (const [x, z] of [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6]
  ]) {
    const v = document.createElement('a-entity');
    v.setAttribute('position', `${x} 0 ${z}`);
    shape.appendChild(v);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const vertices = () => Array.from(shape.children);
const positions = () =>
  vertices().map((v) => {
    const p = v.object3D.position;
    return `${p.x} ${p.z}`;
  });

describe('vertex edits and Reverse never write the fill Angle', () => {
  it('runs every edit on the vertices and none on the shape', () => {
    const start = positions();

    inspector.execute('shapevertexmove', {
      entity: vertices()[1],
      component: 'position',
      value: { x: 9, y: 0, z: -1 },
      oldValue: { x: 8, y: 0, z: 0 }
    });
    inspector.execute('shapevertexinsert', {
      shapeEl: shape,
      index: 1,
      position: '4 0 -1'
    });
    inspector.execute('shapevertexremove', { vertexEl: vertices()[0] });
    expect(reverseShapeDirection(shape)).toBe(true);

    // Positive controls: the commands ran and changed the vertices.
    expect(positions()).not.toEqual(start);
    expect(vertices()).toHaveLength(4);
    expect(positions()[0]).toBe('0 6');
    // And the recorder sees a write when there is one.
    shape.setAttribute('data-probe', '');
    expect(shapeWrites.length).toBeGreaterThan(0);

    const shapeComponentWrites = shapeWrites.filter(
      ([name]) => name === 'shape'
    );
    expect(shapeComponentWrites).toEqual([]);
    expect(JSON.stringify(shapeWrites)).not.toContain('fillAngle');
  });
});
