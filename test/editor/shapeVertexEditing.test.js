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
  GRAZING_MIN_DOT,
  MIN_EDIT_VERTEX_SEPARATION,
  MAX_CLUTTER_FREE_VERTICES,
  MIDPOINT_NEAR_CURSOR_PX,
  MIN_MIDPOINT_SEGMENT_PX,
  OFFSET_MARGIN_PX,
  BUTTON_PX,
  TRASH_MIN_HANDLE_PX,
  clampHandleRadius,
  decidePress,
  hitTestHandles,
  metresPerPixel,
  midpointHandleIsVisible,
  preExistingClosePairs,
  rayPlaneHitIsUsable,
  resolveDragRelease,
  anyVertexIsDeletable,
  trashButtonOffset,
  validateVertexDelete,
  validateVertexEdit
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
      pressViable: true,
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

  it('tracks but does not claim a press on a handle with no live target', () => {
    // The vertex the handle stood for is gone; there is nothing to act on.
    expect(press({ pressViable: false })).toBe('trackOnly');
  });

  it('claims a primary press on a live handle', () => {
    expect(press({})).toBe('claim');
  });
});

describe('rayPlaneHitIsUsable', () => {
  const up = new THREE.Vector3(0, 1, 0);
  // A ray `deg` degrees off a horizontal plane.
  const rayAt = (deg) => {
    const a = THREE.MathUtils.degToRad(deg);
    return new THREE.Vector3(Math.cos(a), -Math.sin(a), 0).normalize();
  };

  it('rejects a near-edge-on ray that intersectPlane would happily answer', () => {
    // 1° off the plane: intersectPlane returns a point, and that point is
    // hundreds of metres from the cursor.
    expect(rayPlaneHitIsUsable(rayAt(1), up)).toBe(false);
  });

  it('accepts an ordinary viewing angle', () => {
    expect(rayPlaneHitIsUsable(rayAt(30), up)).toBe(true);
    expect(rayPlaneHitIsUsable(rayAt(90), up)).toBe(true);
  });

  it('accepts a ray exactly at the threshold', () => {
    const grazing = new THREE.Vector3(
      Math.sqrt(1 - GRAZING_MIN_DOT * GRAZING_MIN_DOT),
      -GRAZING_MIN_DOT,
      0
    );
    expect(rayPlaneHitIsUsable(grazing, up)).toBe(true);
  });

  it('does not care which side of the plane the ray comes from', () => {
    expect(rayPlaneHitIsUsable(rayAt(-30), up)).toBe(true);
  });
});

describe('validateVertexEdit', () => {
  const square = () => [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
  const near = MIN_EDIT_VERTEX_SEPARATION / 2;

  it('accepts a well-separated move on a closed shape', () => {
    const pts = square();
    pts[0] = p(-5, -5);
    expect(validateVertexEdit(pts, true, 0)).toBe(true);
  });

  it('refuses a move onto a ring NEIGHBOUR', () => {
    const pts = square();
    pts[0] = p(10 - near, 0);
    expect(validateVertexEdit(pts, true, 0)).toBe(false);
  });

  it('refuses a move onto a NON-adjacent vertex too', () => {
    // The trap this rule exists for — one handle hidden under another, never
    // grabbable again — does not care about ring adjacency.
    const pts = square();
    pts[0] = p(10, 10 - near);
    expect(validateVertexEdit(pts, true, 0)).toBe(false);
  });

  it('applies separation to open polylines, where crossing is legal', () => {
    const pts = square();
    pts[0] = p(10, 10 - near);
    expect(validateVertexEdit(pts, false, 0)).toBe(false);
  });

  it('is exact about the threshold', () => {
    const just = (d) => {
      const pts = [p(0, 0), p(d, 0), p(10, 10), p(0, 10)];
      return validateVertexEdit(pts, true, 0);
    };
    expect(just(MIN_EDIT_VERTEX_SEPARATION * 1.01)).toBe(true);
    expect(just(MIN_EDIT_VERTEX_SEPARATION * 0.99)).toBe(false);
  });

  it('refuses an edit that makes a closed ring cross itself', () => {
    // Drag corner 2 through the ring to produce a bow-tie.
    const pts = [p(0, 0), p(10, 0), p(0, 10), p(10, 10)];
    expect(validateVertexEdit(pts, true, 2)).toBe(false);
    // The same points as an OPEN polyline are unconstrained.
    expect(validateVertexEdit(pts, false, 2)).toBe(true);
  });
});

describe('the pre-existing-violation exemption', () => {
  // A shape the DRAW tool can legally produce: its spacing rule measures a
  // candidate against the previous vertex only, so vertices 0 and 2 here are
  // inside the edit rule's threshold from the moment the shape exists.
  const drawn = () => [p(0, 0), p(10, 0), p(0.02, 0), p(0, 10)];

  it('leaves an unrelated vertex free to move', () => {
    // The separation rule is scoped to the vertex being moved, so an untouched
    // violating pair elsewhere is not this drag's problem either way.
    const pts = drawn();
    const exempt = preExistingClosePairs(pts);
    pts[3] = p(-5, 12);
    expect(validateVertexEdit(pts, false, 3, exempt)).toBe(true);
  });

  it('lets the offending pair be dragged apart, starting from the violation', () => {
    const pts = drawn();
    const exempt = preExistingClosePairs(pts);
    // The first frame of the drag, still well inside the threshold. Without
    // the exemption the shape would go red the instant the handle was grabbed
    // and could never be dragged OUT of the state — the app would read as
    // broken on a shape the draw tool legally produced.
    pts[2] = p(0.021, 0);
    expect(validateVertexEdit(pts, false, 2, exempt)).toBe(true);
    expect(validateVertexEdit(pts, false, 2)).toBe(false);
    // And once genuinely clear it is valid on either reading.
    pts[2] = p(5, 5);
    expect(validateVertexEdit(pts, false, 2, exempt)).toBe(true);
    expect(validateVertexEdit(pts, false, 2)).toBe(true);
  });

  it('still refuses a NEW violation created during the gesture', () => {
    const pts = drawn();
    const exempt = preExistingClosePairs(pts);
    pts[3] = p(10.01, 0); // brought onto vertex 1, which was never exempt
    expect(validateVertexEdit(pts, false, 3, exempt)).toBe(false);
  });

  it('never exempts the gesture’s own freshly inserted vertex', () => {
    // A midpoint insert on a segment shorter than twice the minimum separation:
    // the new vertex at index 1 is inside the threshold of BOTH neighbours the
    // instant it exists. Exempting those pairs would let a plain click commit
    // the two-handles-at-one-point state the rule exists to prevent.
    const pts = [p(0, 0), p(0.02, 0), p(0.04, 0), p(5, 5)];
    const exempt = preExistingClosePairs(pts, 1);
    expect(exempt.has('0:1')).toBe(false);
    expect(exempt.has('1:2')).toBe(false);
    // The pre-existing 0–2 violation the insert did not create is still exempt.
    expect(exempt.has('0:2')).toBe(true);
    expect(validateVertexEdit(pts, false, 1, exempt)).toBe(false);
  });
});

describe('resolveDragRelease', () => {
  const v = (x, z) => new THREE.Vector3(x, 0, z);

  it('commits the final pose when the release is valid', () => {
    const r = resolveDragRelease({
      preDrag: v(0, 0),
      lastValid: v(3, 0),
      finalValid: true,
      final: v(5, 0)
    });
    expect(r.action).toBe('commit');
    expect(r.value.x).toBe(5);
  });

  it('commits the LAST VALID pose when the release is invalid', () => {
    // valid → valid → invalid → release: the drag lands on the second position,
    // not back where it started, so ten metres of the user's work survives.
    const r = resolveDragRelease({
      preDrag: v(0, 0),
      lastValid: v(3, 0),
      finalValid: false,
      final: v(5, 0)
    });
    expect(r.action).toBe('commit');
    expect(r.value.x).toBe(3);
  });

  it('reverts without a command when no frame was ever valid', () => {
    const r = resolveDragRelease({
      preDrag: v(0, 0),
      lastValid: null,
      finalValid: false,
      final: v(5, 0)
    });
    expect(r.action).toBe('rawRevert');
    expect(r.value.x).toBe(0);
  });

  it('writes nothing when the release nets out to no movement', () => {
    const r = resolveDragRelease({
      preDrag: v(0, 0),
      lastValid: v(0, 0),
      finalValid: false,
      final: v(5, 0)
    });
    expect(r.action).toBe('rawRevert');
  });
});

describe('validateVertexDelete', () => {
  it('refuses to take a shape below two vertices', () => {
    expect(validateVertexDelete([p(0, 0), p(1, 0)], false, 0)).toBe(false);
    // Including on an OPEN polyline, which is otherwise unconstrained.
    expect(validateVertexDelete([p(0, 0), p(1, 0)], false, 1)).toBe(false);
  });

  it('allows an ordinary corner to go', () => {
    expect(
      validateVertexDelete([p(0, 0), p(10, 0), p(10, 10), p(0, 10)], true, 1)
    ).toBe(true);
  });

  it('refuses a delete whose merged edge would cross the ring', () => {
    // A spiral: removing a vertex on the outer turn merges two edges into one
    // that cuts back across the inner turn, where neither original edge did.
    const spiral = [
      p(0, 0),
      p(10, 0),
      p(10, 10),
      p(2, 10),
      p(2, 2),
      p(6, 2),
      p(6, 6)
    ];
    // Losing (2,10) merges its two edges into (10,10)->(2,2), which cuts
    // straight across the inner arm of the spiral.
    expect(validateVertexDelete(spiral, true, 3)).toBe(false);
    expect(validateVertexDelete(spiral, true, 0)).toBe(true);
  });

  it('leaves an open polyline free to cross after a delete', () => {
    const spiral = [
      p(0, 0),
      p(10, 0),
      p(10, 10),
      p(2, 10),
      p(2, 2),
      p(6, 2),
      p(6, 6)
    ];
    expect(validateVertexDelete(spiral, false, 3)).toBe(true);
  });
});

describe('anyVertexIsDeletable', () => {
  it('is false at or below the two-vertex floor', () => {
    expect(anyVertexIsDeletable(0)).toBe(false);
    expect(anyVertexIsDeletable(1)).toBe(false);
    expect(anyVertexIsDeletable(2)).toBe(false);
  });

  it('is true once there is a vertex to spare', () => {
    expect(anyVertexIsDeletable(3)).toBe(true);
    expect(anyVertexIsDeletable(50)).toBe(true);
  });

  // The delete button is hidden on this predicate while the click it would
  // have fired is validated by validateVertexDelete. If the two could ever
  // disagree in this direction, hiding the button would be hiding a delete the
  // user was entitled to.
  it('never hides a delete that validateVertexDelete would have allowed', () => {
    const twoVertex = [p(0, 0), p(1, 0)];
    expect(anyVertexIsDeletable(twoVertex.length)).toBe(false);
    for (let i = 0; i < twoVertex.length; i++) {
      for (const closed of [false, true]) {
        expect(validateVertexDelete(twoVertex, closed, i)).toBe(false);
      }
    }
  });
});

describe('trashButtonOffset', () => {
  const W = 1200;
  const H = 800;
  const middle = (r) => trashButtonOffset(r, W / 2, H / 2, W, H);

  it('is hidden below the minimum handle radius', () => {
    expect(middle(TRASH_MIN_HANDLE_PX - 0.01)).toBeNull();
    expect(middle(TRASH_MIN_HANDLE_PX)).not.toBeNull();
  });

  it('clears the handle by the margin on both axes at every radius', () => {
    // The property the pixel FLOOR exists for. A purely proportional offset
    // fails this at small radii, where the fixed-size button ends up covering
    // the handle it belongs to and its neighbours.
    for (let r = TRASH_MIN_HANDLE_PX; r <= 200; r += 0.5) {
      const o = middle(r);
      const gapX = Math.abs(o.dx) - BUTTON_PX / 2 - r;
      const gapY = Math.abs(o.dy) - BUTTON_PX / 2 - r;
      expect(gapX).toBeGreaterThanOrEqual(OFFSET_MARGIN_PX - 1e-9);
      expect(gapY).toBeGreaterThanOrEqual(OFFSET_MARGIN_PX - 1e-9);
    }
  });

  it('goes up and to the right when there is room', () => {
    const o = middle(7);
    expect(o.dx).toBeGreaterThan(0);
    expect(o.dy).toBeLessThan(0);
  });

  it('flips per axis rather than leaving the viewport', () => {
    const topRight = trashButtonOffset(7, W - 2, 2, W, H);
    expect(topRight.dx).toBeLessThan(0);
    expect(topRight.dy).toBeGreaterThan(0);
    // One axis at a time: a handle at the right edge but vertically central
    // flips only in x.
    const rightEdge = trashButtonOffset(7, W - 2, H / 2, W, H);
    expect(rightEdge.dx).toBeLessThan(0);
    expect(rightEdge.dy).toBeLessThan(0);
  });
});

describe('midpointHandleIsVisible', () => {
  const ghost = (over) =>
    midpointHandleIsVisible({
      segmentLengthPx: 200,
      vertexCount: 4,
      distanceToCursorPx: 0,
      hoverCapable: true,
      ...over
    });

  it('hides a ghost on a segment with no room for it', () => {
    expect(ghost({ segmentLengthPx: MIN_MIDPOINT_SEGMENT_PX - 1 })).toBe(false);
    expect(ghost({ segmentLengthPx: MIN_MIDPOINT_SEGMENT_PX })).toBe(true);
  });

  it('shows every ghost on a shape with few enough vertices', () => {
    expect(
      ghost({
        vertexCount: MAX_CLUTTER_FREE_VERTICES,
        distanceToCursorPx: 10000
      })
    ).toBe(true);
  });

  it('shows only the ones near the cursor once a shape gets busy', () => {
    const busy = { vertexCount: MAX_CLUTTER_FREE_VERTICES + 1 };
    expect(
      ghost({ ...busy, distanceToCursorPx: MIDPOINT_NEAR_CURSOR_PX - 1 })
    ).toBe(true);
    expect(
      ghost({ ...busy, distanceToCursorPx: MIDPOINT_NEAR_CURSOR_PX + 1 })
    ).toBe(false);
  });

  it('shows all of them with no hover-capable pointer, however busy', () => {
    // Touch has no cursor to be near, so the near-cursor filter would make
    // insert unreachable on a big shape rather than merely tidier.
    expect(
      ghost({
        vertexCount: 40,
        distanceToCursorPx: 10000,
        hoverCapable: false
      })
    ).toBe(true);
  });

  it('still hides a ghost with no room, even without hover', () => {
    expect(
      ghost({
        vertexCount: 40,
        hoverCapable: false,
        segmentLengthPx: MIN_MIDPOINT_SEGMENT_PX - 1
      })
    ).toBe(false);
  });
});
