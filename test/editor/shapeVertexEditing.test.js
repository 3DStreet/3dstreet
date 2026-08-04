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

// Helper: build x/z points (y is irrelevant to the plan-view math).
const p = (x, z) => ({ x, z });

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
