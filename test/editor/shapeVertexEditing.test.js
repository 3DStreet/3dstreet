/* global THREE */

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
import {
  HANDLE_MAX_M,
  HANDLE_MIN_M,
  HANDLE_TARGET_PX,
  HIT_SLOP_PX,
  MIDPOINT_RADIUS_RATIO,
  clampHandleRadius,
  decidePress,
  hitTestHandles,
  metresPerPixel
} from '../../src/editor/lib/shapeEditRules.js';

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

describe('handle sizing', () => {
  // A 50° vertical fov over a 900 px viewport: one pixel spans roughly a
  // thousandth of the viewing distance.
  const perspective = () => {
    const c = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    return c;
  };

  it('scales metres-per-pixel linearly with distance on a perspective camera', () => {
    const c = perspective();
    const near = metresPerPixel(c, 10, 900);
    const far = metresPerPixel(c, 100, 900);
    expect(far / near).toBeCloseTo(10, 6);
  });

  it('is distance-independent on an orthographic camera', () => {
    const c = new THREE.OrthographicCamera(-50, 50, 45, -45, 0.1, 5000);
    expect(metresPerPixel(c, 10, 900)).toBeCloseTo(90 / 900, 9);
    expect(metresPerPixel(c, 1000, 900)).toBeCloseTo(90 / 900, 9);
  });

  it('divides by camera.zoom in both branches', () => {
    const p = perspective();
    const unzoomed = metresPerPixel(p, 50, 900);
    p.zoom = 2;
    expect(metresPerPixel(p, 50, 900)).toBeCloseTo(unzoomed / 2, 9);

    const o = new THREE.OrthographicCamera(-50, 50, 45, -45, 0.1, 5000);
    const oUnzoomed = metresPerPixel(o, 50, 900);
    o.zoom = 3;
    expect(metresPerPixel(o, 50, 900)).toBeCloseTo(oUnzoomed / 3, 9);
  });

  it('hits the target pixel radius between the clamps', () => {
    const c = perspective();
    const mpp = metresPerPixel(c, 50, 900);
    expect(clampHandleRadius(mpp)).toBeCloseTo(HANDLE_TARGET_PX * mpp, 9);
  });

  it('floors on a tiny shape and ceils on a distant one', () => {
    // Zoomed right in: the target radius falls below the floor, so the handle
    // stops shrinking and reads larger on screen.
    expect(clampHandleRadius(1e-6)).toBe(HANDLE_MIN_M);
    // Zoomed far out: the handle stops growing in world terms, so it shrinks
    // on screen toward sub-pixel — accepted, and recovered by zooming in.
    expect(clampHandleRadius(1)).toBe(HANDLE_MAX_M);
  });

  it('keeps the floor below the minimum vertex separation', () => {
    // Otherwise the separation rule would be self-defeating: two legally
    // separated vertices would still draw as one merged blob.
    expect(HANDLE_MIN_M).toBeLessThan(0.05);
  });
});

describe('hitTestHandles', () => {
  // A camera looking down -Z from the origin, so a point at (x, y, -d)
  // projects predictably.
  const camera = () => {
    const c = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    c.position.set(0, 0, 0);
    c.updateMatrixWorld(true);
    return c;
  };
  const rect = { left: 0, top: 0, width: 900, height: 900 };

  // Screen position of a handle, so the tests can aim at it exactly.
  const screenOf = (camera, world) => {
    const p = world.clone().project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-p.y * 0.5 + 0.5) * rect.height + rect.top
    };
  };

  const handle = (world, screenRadiusPx) => ({ world, screenRadiusPx });

  it('hits at the centre, at the slop edge, and misses just past it', () => {
    const c = camera();
    const world = new THREE.Vector3(0, 0, -50);
    const h = [handle(world, 7)];
    const s = screenOf(c, world);
    expect(hitTestHandles(h, c, rect, s.x, s.y)).toBe(0);
    expect(hitTestHandles(h, c, rect, s.x + 7 + HIT_SLOP_PX - 1, s.y)).toBe(0);
    expect(hitTestHandles(h, c, rect, s.x + 7 + HIT_SLOP_PX + 1, s.y)).toBe(-1);
  });

  it('resolves an overlap by list order, so a vertex beats a coincident midpoint', () => {
    const c = camera();
    const world = new THREE.Vector3(0, 0, -50);
    const s = screenOf(c, world);
    const handles = [
      handle(world.clone(), 7),
      handle(world.clone(), 7 * MIDPOINT_RADIUS_RATIO)
    ];
    expect(hitTestHandles(handles, c, rect, s.x, s.y)).toBe(0);
    // Reverse the order and the other one wins: order IS the rule.
    expect(hitTestHandles([handles[1], handles[0]], c, rect, s.x, s.y)).toBe(0);
  });

  it('never hits a handle behind the camera', () => {
    const c = camera();
    // Behind the camera, but projecting to the same screen point as a handle
    // in front would — which is exactly the case a naive projection test gets
    // wrong.
    const behind = new THREE.Vector3(0, 0, 50);
    const s = screenOf(c, new THREE.Vector3(0, 0, -50));
    expect(hitTestHandles([handle(behind, 7)], c, rect, s.x, s.y)).toBe(-1);
  });

  it('honours the canvas offset, so a hit is measured against client coords', () => {
    const c = camera();
    const world = new THREE.Vector3(0, 0, -50);
    const offset = { left: 300, top: 80, width: 900, height: 900 };
    const p = world.clone().project(c);
    const sx = (p.x * 0.5 + 0.5) * offset.width + offset.left;
    const sy = (-p.y * 0.5 + 0.5) * offset.height + offset.top;
    expect(hitTestHandles([handle(world, 7)], c, offset, sx, sy)).toBe(0);
    expect(
      hitTestHandles([handle(world, 7)], c, offset, sx - 300, sy - 80)
    ).toBe(-1);
  });
});

describe('decidePress', () => {
  const press = (over) =>
    decidePress({
      inspectorOpen: true,
      targetIsCanvas: true,
      isPrimaryButton: true,
      handleHit: true,
      pressPickOk: true,
      ...over
    });

  it('ignores a press the layer has no business in', () => {
    expect(press({ inspectorOpen: false })).toBe('ignore');
    expect(press({ targetIsCanvas: false })).toBe('ignore');
    expect(press({ isPrimaryButton: false })).toBe('ignore');
  });

  it('tracks but never claims a press with no handle under it', () => {
    // Claiming here would kill selection and orbit for every canvas press for
    // as long as a shape is selected.
    expect(press({ handleHit: false })).toBe('trackOnly');
  });

  it('tracks but does not claim a press whose plane pick is unusable', () => {
    // No usable grab anchor: the press behaves as an ordinary canvas press
    // rather than starting a drag with an undefined offset.
    expect(press({ pressPickOk: false })).toBe('trackOnly');
  });

  it('claims a primary press on a handle with a usable pick', () => {
    expect(press({})).toBe('claim');
  });
});
