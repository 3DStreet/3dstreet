import { describe, expect, it, vi } from 'vitest';
import { ringSelfIntersects } from '../../src/aframe-components/polygonMath.js';

// entity.js contains JSX inside a .js file, which this test setup cannot
// transform. A mock FACTORY means the module is never loaded or transformed at
// all, so the command modules below can be imported for what they are. The
// specifier resolves relative to THIS file, not to the module that imports it.
// Every binding the command modules take from entity.js has to appear here, or
// the import fails on a missing export instead of on the property under test.
vi.mock('../../src/editor/lib/entity.js', () => ({
  createUniqueId: () => 'x',
  updateEntity: () => {}
}));

import { EntityUpdateCommand } from '../../src/editor/lib/commands/EntityUpdateCommand.js';
import { ShapeVertexInsertCommand } from '../../src/editor/lib/commands/ShapeVertexInsertCommand.js';
import { ShapeVertexMoveCommand } from '../../src/editor/lib/commands/ShapeVertexMoveCommand.js';
import { ShapeVertexRemoveCommand } from '../../src/editor/lib/commands/ShapeVertexRemoveCommand.js';
import { refuseGuardedTransform } from '../../src/editor/lib/transformGuard.js';

// Helper: build x/z points (y is irrelevant to the plan-view math).
const p = (x, z) => ({ x, z });

// Helper: a stand-in entity carrying the given marker attributes, optionally
// under a parent with an id.
const entityWith = (markers, parentId) => {
  const el = document.createElement('div');
  markers.forEach((m) => el.setAttribute(m, ''));
  if (parentId !== undefined) {
    const parent = document.createElement('div');
    parent.id = parentId;
    parent.appendChild(el);
  }
  return el;
};

describe('refuseGuardedTransform', () => {
  const noScale = () => entityWith(['data-transform-no-scale']);
  const yawOnly = () => entityWith(['data-transform-yaw-only']);

  it('lets an unmarked entity through for every command type', () => {
    const plain = entityWith([], 'street');
    for (const type of [
      'entityupdate',
      'entityreparent',
      'entitycreate',
      'entityremove'
    ]) {
      expect(
        refuseGuardedTransform(type, {
          entity: plain,
          component: 'scale',
          value: '2 2 2',
          parentEl: 'elsewhere'
        })
      ).toBeNull();
    }
  });

  it('refuses a non-unit scale in all three value forms', () => {
    const forms = [
      { value: '2 1 1' },
      { value: { x: 1, y: 1, z: 0.5 } },
      { property: 'y', value: '3' }
    ];
    for (const form of forms) {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: noScale(),
          component: 'scale',
          ...form
        })
      ).toBeTruthy();
    }
  });

  it('allows a unit scale in all three value forms', () => {
    const forms = [
      { value: '1 1 1' },
      { value: { x: 1, y: 1, z: 1 } },
      { property: 'z', value: '1' }
    ];
    for (const form of forms) {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: noScale(),
          component: 'scale',
          ...form
        })
      ).toBeNull();
    }
  });

  it('refuses an off-vertical rotation but allows yaw, in all three forms', () => {
    const refused = [
      { value: '30 0 0' },
      { value: { x: 0, y: 0, z: -15 } },
      { property: 'x', value: '5' }
    ];
    for (const form of refused) {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: yawOnly(),
          component: 'rotation',
          ...form
        })
      ).toBeTruthy();
    }
    const allowed = [
      { value: '0 90 0' },
      { value: { x: 0, y: 45, z: 0 } },
      { property: 'y', value: '180' }
    ];
    for (const form of allowed) {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: yawOnly(),
          component: 'rotation',
          ...form
        })
      ).toBeNull();
    }
  });

  it('leaves other components on a marked entity alone', () => {
    const marked = entityWith([
      'data-transform-no-scale',
      'data-transform-yaw-only'
    ]);
    for (const component of ['position', 'shape', 'visible', 'class']) {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: marked,
          component,
          value: '5 5 5'
        })
      ).toBeNull();
    }
  });

  it('refuses a reparent to a different parent but allows a same-parent reorder', () => {
    const el = entityWith(['data-transform-no-reparent'], 'street');
    expect(
      refuseGuardedTransform('entityreparent', {
        entity: el,
        parentEl: 'somewhere-else'
      })
    ).toBeTruthy();
    expect(
      refuseGuardedTransform('entityreparent', {
        entity: el,
        parentEl: 'street',
        indexInParent: 3
      })
    ).toBeNull();
  });

  it('does not touch entitycreate, which carries no entity to read a marker from', () => {
    expect(
      refuseGuardedTransform('entitycreate', {
        element: 'a-entity',
        components: { scale: '4 4 4' }
      })
    ).toBeNull();
  });
});

describe('shape vertex commands stay off the LLM tool surface', () => {
  // The command registry reads CommandClass.llmTool — an INHERITED read — and
  // throws on a duplicate tool name at module evaluation, which stops the
  // editor loading entirely. So extending a command that declares one (say
  // EntityUpdateCommand, whose body ShapeVertexMoveCommand deliberately
  // duplicates) is fatal, and `llmTool` being undefined on each of these is
  // exactly the invariant that keeps it from happening.
  it.each([
    ['ShapeVertexInsertCommand', ShapeVertexInsertCommand],
    ['ShapeVertexMoveCommand', ShapeVertexMoveCommand],
    ['ShapeVertexRemoveCommand', ShapeVertexRemoveCommand]
  ])('%s has no llmTool, inherited or own', (_name, CommandClass) => {
    expect(CommandClass.llmTool).toBeUndefined();
  });

  it('would catch a subclass — the static really is inherited', () => {
    // Without this the assertions above could pass vacuously, on classes that
    // failed to import or on a base that no longer declares a tool.
    expect(EntityUpdateCommand.llmTool?.name).toBe('entityUpdate');
    class Subclass extends EntityUpdateCommand {}
    expect(Subclass.llmTool).toBe(EntityUpdateCommand.llmTool);
  });
});

describe('ringSelfIntersects', () => {
  it('is false for a simple square', () => {
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(
      false
    );
  });

  it('is true for a bow-tie (the crossing pair includes the wrap edge)', () => {
    // Edges (10,0)->(0,10) and the wrap (10,10)->(0,0) cross at (5,5).
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(0, 10), p(10, 10)])).toBe(
      true
    );
  });

  it('is false for a concave L', () => {
    const L = [p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 10), p(0, 10)];
    expect(ringSelfIntersects(L)).toBe(false);
  });

  it('is true for a star traced in ring order', () => {
    // Five points evenly spaced on a circle, visited 0,2,4,1,3 — a pentagram.
    const circle = [];
    for (let k = 0; k < 5; k++) {
      const a = (2 * Math.PI * k) / 5;
      circle.push(p(Math.cos(a), Math.sin(a)));
    }
    const star = [circle[0], circle[2], circle[4], circle[1], circle[3]];
    expect(ringSelfIntersects(star)).toBe(true);
    // The same five points in their natural order are a convex pentagon.
    expect(ringSelfIntersects(circle)).toBe(false);
  });

  it('is true for a collinear self-overlap', () => {
    // Edge 0 (0,0)->(10,0) and edge 2 (8,0)->(2,0) lie on the same line and
    // overlap: degenerate, but the ring still has no well-defined interior.
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(8, 0), p(2, 0)])).toBe(
      true
    );
  });

  it('is false for a triangle — every edge pair is adjacent', () => {
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(5, 10)])).toBe(false);
  });

  it('is false below 4 vertices', () => {
    expect(ringSelfIntersects([])).toBe(false);
    expect(ringSelfIntersects([p(0, 0)])).toBe(false);
    expect(ringSelfIntersects([p(0, 0), p(1, 0)])).toBe(false);
  });
});
