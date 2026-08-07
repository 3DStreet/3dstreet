/* global THREE */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  polygonAreaXZ,
  ringEnclosesArea,
  ringSelfIntersects
} from '../../src/aframe-components/polygonMath.js';

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

import { ShapeVertexControls } from '../../src/editor/lib/ShapeVertexControls.js';
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
  GRAZING_MIN_DOT,
  MIN_EDIT_VERTEX_SEPARATION,
  OFFSET_MARGIN_PX,
  BUTTON_PX,
  TRASH_MIN_HANDLE_PX,
  TOUCH_CLICK_MOVE_THRESHOLD,
  CLICK_MOVE_THRESHOLD,
  adjacentSegments,
  canOfferInsert,
  clampHandleRadius,
  clickMoveThreshold,
  decidePress,
  segmentForVertexPair,
  hitTestHandles,
  insertButtonTransform,
  insertCandidate,
  metresPerPixel,
  preExistingClosePairs,
  rayPlaneHitIsUsable,
  resolveDragRelease,
  anyVertexIsDeletable,
  deleteKeyTargetsVertex,
  trashButtonOffset,
  validateVertexDelete,
  validateVertexEdit
} from '../../src/editor/lib/shapeEditRules.js';

// Helper: build x/z points. The plan-view math reads x and z only, but y is
// carried as 0 rather than omitted: insertCandidate averages its two endpoints
// into a THREE.Vector3, and an absent y would make that midpoint's y NaN — sound
// today, since nothing reads it, and a trap for the first rule that does.
const p = (x, z) => ({ x, y: 0, z });

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

describe('ringEnclosesArea', () => {
  // The ratio a ring scores: enclosed area over perimeter squared. Recomputed
  // here rather than exported, so the scale assertions below compare two
  // independently-derived numbers.
  const ratio = (pts) => {
    let perimeter = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      perimeter += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return polygonAreaXZ(pts) / (perimeter * perimeter);
  };

  it('refuses a collinear triangle', () => {
    // ringSelfIntersects says FALSE here — correctly, since at n = 3 every edge
    // pair is adjacent — so a predicate that delegated to it, or that keyed on
    // vertex count, would pass this ring straight through to the triangulator.
    const collinear = [p(0, 0), p(10, 0), p(4, 0)];
    expect(ringSelfIntersects(collinear)).toBe(false);
    expect(ringEnclosesArea(collinear)).toBe(false);
  });

  it('refuses a collinear quad', () => {
    expect(ringEnclosesArea([p(0, 0), p(10, 0), p(8, 0), p(2, 0)])).toBe(false);
  });

  it('accepts ordinary rings', () => {
    expect(ringEnclosesArea([p(0, 0), p(10, 0), p(5, 10)])).toBe(true);
    expect(ringEnclosesArea([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(
      true
    );
  });

  it('returns false rather than throwing on degenerate input', () => {
    // Note what this does NOT cover: the n < 3 guard in the implementation is
    // belt-and-braces, and every case here is caught by the perimeter-zero or
    // area-ratio branch as well, so deleting the guard leaves all three green.
    // The assertion is totality — no throw, no NaN, no undefined — not
    // coverage of that line.
    expect(ringEnclosesArea([])).toBe(false);
    expect(ringEnclosesArea([p(0, 0)])).toBe(false);
    expect(ringEnclosesArea([p(0, 0), p(1, 0)])).toBe(false);
  });

  it('accepts a pinched ring, which the crossing test is what refuses', () => {
    // D sits on the non-adjacent edge A→B. The ring encloses a perfectly good
    // 25 m² region, so this predicate passes it; it is invalid all the same,
    // and ringSelfIntersects is what says so. The two carry different halves of
    // validity, and this is the ring where they disagree — so any
    // "simplification" that folds one into the other fails here.
    const pinched = [p(0, 0), p(10, 0), p(10, 10), p(5, 0)];
    expect(ringEnclosesArea(pinched)).toBe(true);
    expect(ringSelfIntersects(pinched)).toBe(true);
  });

  it('refuses a bow-tie — but not for the reason it looks like', () => {
    // Not "it has no region": it has two of them. They wind oppositely and
    // cancel in the shoelace sum, giving exactly zero. A coincidence, not
    // evidence that this predicate detects self-crossing — ringSelfIntersects
    // is what refuses this ring for the right reason, and it already does.
    const bowTie = [p(0, 0), p(10, 0), p(0, 10), p(10, 10)];
    expect(ringEnclosesArea(bowTie)).toBe(false);
    expect(ringSelfIntersects(bowTie)).toBe(true);
  });

  it('gives the same verdict for the same shape at two scales', () => {
    // The row a raw area threshold fails. The 10 m form encloses 5e-6 m² and
    // the 5 cm form 1.25e-10 m² — a factor of 40,000 for one shape — so
    // `area > 1e-9` would accept the first and refuse the second. Asserting the
    // two RATIOS are equal as well as the two verdicts is what closes the door
    // on a raw threshold at some other constant passing this test anyway.
    const big = [p(0, 0), p(10, 0), p(5, 1e-6)];
    const small = big.map((q) => p(q.x * 0.005, q.z * 0.005));
    expect(ringEnclosesArea(big)).toBe(true);
    expect(ringEnclosesArea(small)).toBe(true);
    expect(ratio(small)).toBeCloseTo(ratio(big), 12);
  });

  it('still refuses a degenerate ring far from the origin', () => {
    // The shoelace sum loses precision as coordinates grow, so a threshold set
    // near the float noise floor would start reading a flat ring as enclosing.
    const far = [p(0, 0), p(10, 0), p(4, 0)].map((q) =>
      p(q.x + 1234.5, q.z + 1234.5)
    );
    expect(ringEnclosesArea(far)).toBe(false);
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

  it('resolves an overlap by list order, with no tie-break', () => {
    const c = camera();
    const world = new THREE.Vector3(0, 0, -50);
    const s = screenOf(c, world);
    // Two coincident handles of different radii: the first in the list wins
    // whichever it is, so the ORDER is the whole of the rule.
    const handles = [handle(world.clone(), 7), handle(world.clone(), 4)];
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

  it('refuses an edit that leaves a closed ring enclosing nothing', () => {
    // Corner 2 dragged onto the line of the opposite edge: the ring never
    // crosses itself, and it has no interior either.
    const flatTriangle = [p(0, 0), p(10, 0), p(4, 0)];
    expect(ringSelfIntersects(flatTriangle)).toBe(false);
    expect(validateVertexEdit(flatTriangle, true, 2)).toBe(false);
    // Open polylines have no interior to require, so the clause must sit inside
    // the `closed` guard — outside it, every flat polyline in the product
    // becomes un-draggable.
    expect(validateVertexEdit(flatTriangle, false, 2)).toBe(true);
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

  it('exempts the pairs an insert created, once a snapshot is taken after it', () => {
    // A midpoint insert on a segment shorter than twice the minimum separation:
    // the new vertex at index 1 is inside the threshold of BOTH neighbours the
    // instant it exists. The insert path passes NO exemption set for exactly
    // this reason — an exemption covering the index being validated would let a
    // plain click commit the two-handles-at-one-point state the rule exists to
    // prevent, and a set built by filtering that index out would be inert.
    const pts = [p(0, 0), p(0.02, 0), p(0.04, 0), p(5, 5)];
    expect(validateVertexEdit(pts, false, 1, null)).toBe(false);
    // And the hazard that makes passing null a decision rather than an
    // omission: a snapshot taken after the insert exempts the very pairs the
    // insert created, and the refusal turns into an acceptance.
    expect(validateVertexEdit(pts, false, 1, preExistingClosePairs(pts))).toBe(
      true
    );
  });
});

describe('the separation clause of validateVertexEdit', () => {
  // Reached through validateVertexEdit on an OPEN shape, where the ring clauses
  // do not apply and the separation clause is therefore the whole verdict —
  // rather than through the private helper, which has no product caller of its
  // own and is not exported.
  //
  // The extraction the helper represents is sold as no behaviour change, so
  // these are fixed verdicts written from what validateVertexEdit did BEFORE
  // the split — not a re-expression of its body. A wrong extraction (a dropped
  // exemption skip, an off-by-one loop bound) changes these verdicts, which is
  // what makes them catch it.
  const square = () => [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

  it.each([
    ['a well-separated vertex', square(), 0, undefined, true],
    [
      'one moved onto a ring neighbour',
      [p(10, 0.02), p(10, 0), p(10, 10), p(0, 10)],
      0,
      undefined,
      false
    ],
    [
      'one moved onto a NON-adjacent vertex',
      [p(10, 9.98), p(10, 0), p(10, 10), p(0, 10)],
      0,
      undefined,
      false
    ],
    [
      'an untouched close pair elsewhere',
      [p(0, 0), p(10, 0), p(10.02, 0), p(0, 10)],
      0,
      undefined,
      true
    ]
  ])('%s', (_name, points, index, exempt, expected) => {
    expect(validateVertexEdit(points, false, index, exempt)).toBe(expected);
  });

  it('honours the exemption set, and only for the pairs in it', () => {
    const pts = [p(0, 0), p(0.02, 0), p(10, 10), p(0, 10)];
    const exempt = preExistingClosePairs(pts);
    expect(validateVertexEdit(pts, false, 0, exempt)).toBe(true);
    expect(validateVertexEdit(pts, false, 0, undefined)).toBe(false);
  });

  it('is separation ALONE — a crossing ring passes it and fails the full rule', () => {
    // The asymmetry the split exists for: one clause is a property of a single
    // vertex, the other of the whole ring. Same points, same index; only the
    // `closed` flag differs, so the ring clauses are the entire difference.
    const bowTie = [p(0, 0), p(10, 0), p(0, 10), p(10, 10)];
    expect(validateVertexEdit(bowTie, false, 2)).toBe(true);
    expect(validateVertexEdit(bowTie, true, 2)).toBe(false);
  });
});

describe('adjacentSegments', () => {
  it('gives a ring vertex both its segments, wrapping at index 0', () => {
    expect(adjacentSegments(2, 5, true)).toEqual([1, 2]);
    // The assertion that fails if the derivation is written for an array
    // rather than a ring: vertex 0's incoming segment is the closing edge.
    expect(adjacentSegments(0, 5, true)).toEqual([4, 0]);
  });

  it('gives an open polyline endpoint exactly one', () => {
    expect(adjacentSegments(0, 4, false)).toEqual([0]);
    expect(adjacentSegments(3, 4, false)).toEqual([2]);
    expect(adjacentSegments(1, 4, false)).toEqual([0, 1]);
  });

  it('gives one segment on a two-vertex shape', () => {
    expect(adjacentSegments(0, 2, false)).toEqual([0]);
    expect(adjacentSegments(1, 2, false)).toEqual([0]);
  });

  it('gives nothing for a degenerate count or an index outside the ring', () => {
    expect(adjacentSegments(0, 1, false)).toEqual([]);
    expect(adjacentSegments(-1, 4, true)).toEqual([]);
    expect(adjacentSegments(4, 4, true)).toEqual([]);
  });
});

describe('canOfferInsert', () => {
  const square = () => [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

  it('offers a long edge', () => {
    expect(canOfferInsert(square(), 0)).toBe(true);
  });

  it('withholds an edge too short to hold a legal midpoint', () => {
    // A 3 cm edge: the midpoint is 1.5 cm from each end, inside the 5 cm rule.
    const pts = [p(0, 0), p(0.03, 0), p(10, 10), p(0, 10)];
    expect(canOfferInsert(pts, 0)).toBe(false);
  });

  it('is exclusive at the boundary, and 0.10 m is deliberately not asserted', () => {
    // tooClose is a STRICT <, so on a 0.10 m edge the midpoint sits at exactly
    // 0.05 from each end and IS offered. Writing "0.10 m is withheld" here is
    // the natural mistake, and the natural repair on seeing it fail would be to
    // loosen a rule that governs vertex DRAG as well as insert. Exactly 0.100
    // is left out because the comparison at the constant itself is
    // float-representation-dependent.
    const edge = (len) => [p(0, 0), p(len, 0), p(10, 10), p(0, 10)];
    expect(canOfferInsert(edge(0.099), 0)).toBe(false);
    expect(canOfferInsert(edge(0.101), 0)).toBe(true);
  });

  it('withholds a long edge whose midpoint lands near a DISTANT vertex', () => {
    // The case an edge-length rule gets wrong: the edge is 4 m long and the
    // vertex that kills it is nowhere near either of its ends.
    const pts = [p(0, 0), p(4, 0), p(2, 0.04), p(0, 1)];
    expect(canOfferInsert(pts, 0)).toBe(false);
  });

  it('still offers a button on a shape with a pre-existing close pair', () => {
    // A shape the draw tool can legally produce — its spacing rule measures
    // against the previous vertex only. The offending pair is between two
    // EXISTING vertices, so the loop never tests it.
    //
    // Failure mode: a gate written as validateVertexEdit(candidate, …), which
    // tests the whole candidate array and makes every button on such a shape
    // disappear.
    const pts = [p(0, 0), p(10, 0), p(0.02, 0), p(0, 10)];
    expect(canOfferInsert(pts, 0)).toBe(true);
  });

  it('still offers every button on an already-crossing ring', () => {
    // The other direction the same rewrite fails in: the ring clause would hide
    // every affordance on the shape for a crossing nowhere near any of them.
    // The buttons stay; the press is what refuses.
    const bowTie = [p(0, 0), p(10, 0), p(0, 10), p(10, 10)];
    expect(ringSelfIntersects(bowTie)).toBe(true);
    for (let seg = 0; seg < bowTie.length; seg++) {
      expect(canOfferInsert(bowTie, seg)).toBe(true);
    }
    const { cand, vertexIndex } = insertCandidate(bowTie, 0);
    expect(validateVertexEdit(cand, true, vertexIndex, null)).toBe(false);
  });
});

describe('insertCandidate', () => {
  // Rings that ENCLOSE A REGION, which is the property the verdict-preservation
  // claim below is stated over. The crossing members have to enclose too, or
  // they fail that precondition: the bow-tie quad is the obvious choice here
  // and is the WRONG one, because its two lobes wind oppositely and cancel in
  // the shoelace sum, scoring exactly zero.
  const pentagram = () => {
    const circle = [];
    for (let k = 0; k < 5; k++) {
      const a = (2 * Math.PI * k) / 5;
      circle.push(p(Math.cos(a), Math.sin(a)));
    }
    return [circle[0], circle[2], circle[4], circle[1], circle[3]];
  };
  const battery = () => [
    [p(0, 0), p(10, 0), p(10, 10), p(0, 10)], // convex
    [p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 10), p(0, 10)], // concave
    pentagram(), // crossing, and encloses
    [p(0, 0), p(10, 0), p(10, 10), p(5, 0)] // pinched: crossing, and encloses
  ];

  it('puts the new vertex BETWEEN the two ends of the segment it splits', () => {
    // The two neighbour assertions are what make this catch anything. Without
    // them the block is invariant under the defect it names: with k = segment
    // instead of segment + 1, splice still places mid at index k, so both "the
    // rest of the array is unchanged in order" and "mid is the mean" hold, and
    // an interior-segment off-by-one goes uncaught.
    for (const ring of battery()) {
      const n = ring.length;
      for (let seg = 0; seg < n; seg++) {
        const { cand, vertexIndex, mid } = insertCandidate(ring, seg);
        expect(cand.length).toBe(n + 1);
        expect(cand.filter((_, i) => i !== vertexIndex)).toEqual(ring);
        const a = ring[seg];
        const b = ring[(seg + 1) % n];
        expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 12);
        expect(mid.z).toBeCloseTo((a.z + b.z) / 2, 12);
        expect(cand[vertexIndex - 1]).toBe(a);
        expect(cand[(vertexIndex + 1) % (n + 1)]).toBe(b);
      }
    }
  });

  it('appends on the wrap edge', () => {
    const ring = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const { cand, vertexIndex } = insertCandidate(ring, ring.length - 1);
    expect(vertexIndex).toBe(ring.length);
    expect(cand.slice(0, ring.length)).toEqual(ring);
  });

  it('preserves the crossing verdict for every insert that can actually happen', () => {
    // The sweep below skips segments the product would not offer, so a
    // canOfferInsert that regressed toward false would run ZERO assertions and
    // report green — pass, fail and did-not-run collapsing into the permissive
    // answer on the one assertion carrying this property. Counted, with a floor
    // asserted at the end.
    let swept = 0;
    for (const ring of battery()) {
      // Asserted rather than assumed: without this the battery could quietly
      // acquire a degenerate member and the property would start failing for a
      // reason nobody could read off the failure.
      expect(ringEnclosesArea(ring)).toBe(true);
      const before = ringSelfIntersects(ring);
      for (let seg = 0; seg < ring.length; seg++) {
        // Restricted to OFFERED segments, which is the set of inserts the
        // product can perform at all — see the test below for the one segment
        // in this battery that is withheld, and why the restriction is not the
        // property being weakened to fit.
        if (!canOfferInsert(ring, seg)) continue;
        const { cand } = insertCandidate(ring, seg);
        expect(ringSelfIntersects(cand)).toBe(before);
        swept++;
      }
    }
    // Every segment of every battery ring except the pinched quad's A→B, which
    // the test below owns. Written as the exact total rather than a loose floor
    // so that a ring joining or leaving the battery has to be accounted for
    // here too.
    expect(swept).toBe(4 + 6 + 5 + 4 - 1);
  });

  it('and the withheld segment, where a midpoint lands ON an existing vertex', () => {
    // The pinched quad's edge A→B is bisected exactly by the pinch vertex D,
    // so the candidate midpoint and D are the same point. The crossing test
    // excludes segments that share an endpoint, so a coincident pair masks the
    // very crossing D was causing and the candidate reads clean.
    //
    // It is not reachable: coincidence is precisely what the separation rule
    // forbids, so the gate withholds the button and the press would refuse it.
    // Asserting BOTH halves here is what keeps that true — if the gate ever
    // stopped withholding this segment, the sweep above would silently start
    // skipping nothing while this test went red.
    const pinched = [p(0, 0), p(10, 0), p(10, 10), p(5, 0)];
    expect(ringSelfIntersects(pinched)).toBe(true);
    expect(canOfferInsert(pinched, 0)).toBe(false);
    const { cand, vertexIndex } = insertCandidate(pinched, 0);
    expect(ringSelfIntersects(cand)).toBe(false);
    expect(validateVertexEdit(cand, true, vertexIndex, null)).toBe(false);
  });

  it('and the ring where it does NOT, which is why the property is qualified', () => {
    // A collinear triangle reads false at n = 3 — every edge pair is adjacent —
    // and its midpoint-insert candidate reads true at n = 4. The qualifier
    // costs nothing only because ringEnclosesArea refuses this ring outright,
    // so no legal shape has an insert that changes its crossing verdict. Drop
    // the enclosure clause and this becomes a real hole.
    const collinear = [p(0, 0), p(10, 0), p(4, 0)];
    expect(ringEnclosesArea(collinear)).toBe(false);
    expect(ringSelfIntersects(collinear)).toBe(false);
    expect(ringSelfIntersects(insertCandidate(collinear, 0).cand)).toBe(true);
  });
});

describe('segmentForVertexPair', () => {
  // Bare objects: the rule only ever calls indexOf on these, treating them as
  // identity tokens, which is the whole argument for it living in this module.
  const els = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

  it('names the segment between two adjacent vertices', () => {
    const v = els(5);
    expect(segmentForVertexPair(v, v[2], v[3], true)).toBe(2);
    expect(segmentForVertexPair(v, v[3], v[2], true)).toBe(2);
  });

  // The failure this rule exists to prevent, in one assertion. Deleting a
  // vertex BEFORE the side renumbers every side after it, so a control keyed on
  // the segment number would silently move to a neighbour; keyed on the two
  // endpoint elements it stays put, and the number it now answers with is the
  // new number of the SAME side.
  it('follows the side, not its place in the running order', () => {
    const v = els(6);
    expect(segmentForVertexPair(v, v[4], v[5], true)).toBe(4);
    const afterDelete = v.filter((_, i) => i !== 1);
    expect(segmentForVertexPair(afterDelete, v[4], v[5], true)).toBe(3);
  });

  it('refuses when a vertex has been inserted BETWEEN the pair', () => {
    const v = els(5);
    const withNew = [v[0], v[1], v[2], { id: 'new' }, v[3], v[4]];
    // Both endpoints survive, so identity passes and only adjacency fails.
    expect(withNew.indexOf(v[2])).toBeGreaterThanOrEqual(0);
    expect(withNew.indexOf(v[3])).toBeGreaterThanOrEqual(0);
    expect(segmentForVertexPair(withNew, v[2], v[3], true)).toBe(-1);
  });

  it('refuses when either endpoint has left the shape', () => {
    const v = els(5);
    const without = v.filter((_, i) => i !== 3);
    expect(segmentForVertexPair(without, v[2], v[3], true)).toBe(-1);
    expect(segmentForVertexPair(without, v[3], v[4], true)).toBe(-1);
  });

  // The wrap pair is a side only on a closed ring, so opening or closing the
  // shape adds or removes a side without touching any vertex — and there is no
  // event for it, which is why the rule has to carry the clause.
  it('treats the wrap pair as a side only when the shape is closed', () => {
    const v = els(5);
    expect(segmentForVertexPair(v, v[4], v[0], true)).toBe(4);
    expect(segmentForVertexPair(v, v[4], v[0], false)).toBe(-1);
    expect(segmentForVertexPair(v, v[0], v[4], true)).toBe(4);
  });

  // Three is the smallest ring, and the boundary of the `n >= 3` clause: one
  // vertex fewer and there is no wrap side to name.
  it('names the wrap side on the smallest closed ring', () => {
    const v = els(3);
    expect(segmentForVertexPair(v, v[2], v[0], true)).toBe(2);
    expect(segmentForVertexPair(v, v[2], v[0], false)).toBe(-1);
  });

  // Both orderings satisfy adjacency modulo 2 and there is exactly one side, so
  // the answer must not depend on which clause is tested first. `closed` cannot
  // change that: a 2-vertex shape has one side, never a wrap side as well.
  it('answers 0 for either ordering on a two-vertex shape', () => {
    const v = els(2);
    expect(segmentForVertexPair(v, v[0], v[1], false)).toBe(0);
    expect(segmentForVertexPair(v, v[1], v[0], false)).toBe(0);
    expect(segmentForVertexPair(v, v[0], v[1], true)).toBe(0);
    expect(segmentForVertexPair(v, v[1], v[0], true)).toBe(0);
  });

  it('refuses non-adjacent, identical and absent arguments', () => {
    const v = els(5);
    expect(segmentForVertexPair(v, v[0], v[2], true)).toBe(-1);
    expect(segmentForVertexPair(v, v[1], v[1], true)).toBe(-1);
    expect(segmentForVertexPair(v, v[0], null, true)).toBe(-1);
    expect(segmentForVertexPair([v[0]], v[0], v[0], true)).toBe(-1);
  });
});

describe('clickMoveThreshold', () => {
  // Small, but it is the guard on the whole touch argument, and the only part
  // of that change reachable from a unit test at all.
  it('gives a finger more room than a mouse', () => {
    expect(clickMoveThreshold('touch')).toBe(TOUCH_CLICK_MOVE_THRESHOLD);
    expect(TOUCH_CLICK_MOVE_THRESHOLD).toBeGreaterThan(CLICK_MOVE_THRESHOLD);
  });

  // The touch number is the handle's own hit radius, not a taste number: the
  // rule reads "a press that never left the handle it started on is a tap".
  it('sets the touch threshold to the handle hit radius', () => {
    expect(TOUCH_CLICK_MOVE_THRESHOLD).toBe(HANDLE_TARGET_PX + HIT_SLOP_PX);
  });

  // The mouse is the exception rather than touch the special case, and the
  // asymmetry is the whole rule: the tight threshold is only safe where the
  // input is known to be precise. A stylus wobbles about as much as a fingertip,
  // and an unknown pointer type is exactly the case where precision cannot be
  // assumed — so both land on the forgiving side.
  it('reserves the tight threshold for the mouse alone', () => {
    expect(clickMoveThreshold('mouse')).toBe(CLICK_MOVE_THRESHOLD);
    expect(clickMoveThreshold('pen')).toBe(TOUCH_CLICK_MOVE_THRESHOLD);
    expect(clickMoveThreshold(undefined)).toBe(TOUCH_CLICK_MOVE_THRESHOLD);
  });
});

describe('insertButtonTransform', () => {
  // The LITERAL strings, because the defect this catches is in the string. The
  // CSS2D renderer already centres the outer element on the anchor, so a
  // percentage on the inner — translate(-50%, …) or calc(-100% - 14px) —
  // double-counts and lands the button 12 px left of and above where it
  // belongs. It looks nearly right, and an assertion written against the
  // percentage form would pass on the defect rather than catch it.
  it('sits above the anchor by default', () => {
    expect(insertButtonTransform(400)).toBe('translate(0px, -26px)');
  });

  it('flips below when above would leave the top of the viewport', () => {
    expect(insertButtonTransform(40)).toBe('translate(0px, 26px)');
  });

  it('never emits a percentage or a calc', () => {
    for (const anchorY of [0, 25, 49, 50, 400, 2000]) {
      const t = insertButtonTransform(anchorY);
      expect(t).toMatch(/^translate\(0px, -?26px\)$/);
    }
  });

  // TOTAL, at every anchor height. The button is reached by clicking a
  // measurement, which is drawn at a fixed screen size at any zoom — so a
  // hidden answer would mean a click that worked and a button that never
  // appeared, with nothing on screen to explain it. The delete button's own
  // floor is unaffected and is asserted with trashButtonOffset.
  it('never hides, at any anchor height', () => {
    for (const anchorY of [-500, 0, 25, 400, 5000]) {
      expect(insertButtonTransform(anchorY)).toBeTruthy();
    }
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

describe('deleteKeyTargetsVertex', () => {
  it('takes the key when a deletable vertex is sub-selected', () => {
    expect(deleteKeyTargetsVertex({}, 3)).toBe(true);
    expect(deleteKeyTargetsVertex({}, 40)).toBe(true);
  });

  it('leaves the key alone when nothing is sub-selected', () => {
    expect(deleteKeyTargetsVertex(null, 40)).toBe(false);
    expect(deleteKeyTargetsVertex(undefined, 3)).toBe(false);
  });

  // The escalation: a vertex IS sub-selected, but on a shape at the floor there
  // is no vertex-level outcome, so the key falls through to the whole-shape
  // delete (behind its confirm) rather than refusing.
  it('leaves the key alone at the two-vertex floor even with a vertex active', () => {
    expect(deleteKeyTargetsVertex({}, 2)).toBe(false);
    expect(deleteKeyTargetsVertex({}, 1)).toBe(false);
  });

  // The store flag that keeps the global shortcut inert reads this same
  // predicate. If it could be true where no vertex delete can happen, the key
  // would be swallowed by a layer that then does nothing — the dead-key state
  // this whole rule exists to avoid.
  it('is never true where no vertex is deletable', () => {
    for (let count = 0; count <= 6; count++) {
      if (deleteKeyTargetsVertex({}, count)) {
        expect(anyVertexIsDeletable(count)).toBe(true);
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

// The branch that decides what a press on a side's length measurement DOES.
// It is the one place in this feature where the same gesture is destructive on
// one input type and merely reveals a button on another, so each pointer type
// gets its own case rather than being covered by a blacklist.
//
// These share ONE module instance deliberately — no vi.resetModules() — because
// the media query is read at CALL time. Re-importing per test would let a build
// that read it once at module scope pass this whole block.
describe('ShapeVertexControls.activateSide', () => {
  let execute;
  let savedAframe;
  let savedMatchMedia;

  // Four vertices of a large square, so every midpoint insert clears the
  // minimum separation and the ring stays simple. The stub carries only what
  // this path reads: positions, the closed flag, and a DOM child order.
  const square = () =>
    [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10]
    ].map(([x, z]) => ({ object3D: { position: new THREE.Vector3(x, 0, z) } }));

  // hoverIsReal + a recorded press, both overridable. Written as one factory so
  // that a case which produces "nothing happened" can be compared against a
  // sibling that differs in exactly one field.
  const controls = ({
    hover = true,
    press = { pointerType: 'mouse' }
  } = {}) => {
    window.matchMedia = vi.fn(() => ({ matches: hover }));
    const c = new ShapeVertexControls();
    const vertexEls = square();
    c.vertexEls = vertexEls;
    c.shapeEl = {
      components: { shape: { data: { closed: true } } },
      children: vertexEls
    };
    c._windowPress = press && { x: 0, y: 0, wasDrag: false, ...press };
    return c;
  };

  beforeEach(() => {
    execute = vi.fn();
    savedAframe = globalThis.AFRAME;
    savedMatchMedia = window.matchMedia;
    globalThis.AFRAME = { INSPECTOR: { execute } };
  });

  afterEach(() => {
    globalThis.AFRAME = savedAframe;
    window.matchMedia = savedMatchMedia;
  });

  // The positive control travels WITH the assertion it protects: "execute was
  // not called" is also what a fixture that was never wired up produces, so the
  // same fixture is made to insert by flipping the one field under test.
  it('refuses while a gesture is claimed — and the same fixture inserts when it is not', () => {
    const c = controls();
    const v = c.vertexEls;
    c.claimed = true;
    c.activateSide(v[0], v[1]);
    expect(execute).not.toHaveBeenCalled();
    c.claimed = false;
    c.activateSide(v[0], v[1]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('inserts on a mouse press that did not travel', () => {
    const c = controls();
    const v = c.vertexEls;
    c.activateSide(v[0], v[1]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe('shapevertexinsert');
    expect(c.getRevealedSide()).toBe(null);
  });

  // Touch keeps the two-step model: the tap opens a button, and the button is
  // what commits. Nothing about this path may become destructive.
  it('reveals rather than inserts on touch', () => {
    const c = controls({ press: { pointerType: 'touch' } });
    const v = c.vertexEls;
    c.activateSide(v[0], v[1]);
    expect(execute).not.toHaveBeenCalled();
    expect(c.getRevealedSide()).toEqual({ a: v[0], b: v[1] });
  });

  // The three cases the gate exists for. Without them a blacklist on 'touch'
  // passes everything else — including a hovering stylus, a mouse on a
  // touch-primary tablet where no morph is ever shown, and a click this layer
  // saw no press for at all.
  it('inserts for a hovering stylus, which the stylesheet morphs for', () => {
    const c = controls({ press: { pointerType: 'pen' } });
    const v = c.vertexEls;
    c.activateSide(v[0], v[1]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['mouse', 'pen'])(
    'reveals for a %s where the device reports no hover',
    (pointerType) => {
      const c = controls({ hover: false, press: { pointerType } });
      const v = c.vertexEls;
      c.activateSide(v[0], v[1]);
      expect(execute).not.toHaveBeenCalled();
      expect(c.getRevealedSide()).toEqual({ a: v[0], b: v[1] });
    }
  );

  it('reveals when there is no press record to judge', () => {
    const c = controls({ press: null });
    const v = c.vertexEls;
    c.activateSide(v[0], v[1]);
    expect(execute).not.toHaveBeenCalled();
    expect(c.getRevealedSide()).toEqual({ a: v[0], b: v[1] });
  });

  // A failed orbit that started on the chip. Ungated it commits a vertex, and
  // the natural response to a camera that did not move is to try again.
  it('does nothing at all when the press became a drag', () => {
    const c = controls({ press: { pointerType: 'mouse', wasDrag: true } });
    const v = c.vertexEls;
    c.activateSide(v[0], v[1]);
    expect(execute).not.toHaveBeenCalled();
    expect(c.getRevealedSide()).toBe(null);
  });

  // A finger opened the button; now a mouse comes back to the same chip. The
  // morph is suppressed while a button is open there, so inserting would act
  // with no affordance ever shown — close it instead and let hover take over.
  it('closes an open button rather than inserting under it', () => {
    const c = controls();
    const v = c.vertexEls;
    c.revealSide(v[0], v[1]);
    expect(c.getRevealedSide()).not.toBe(null);
    c.activateSide(v[0], v[1]);
    expect(execute).not.toHaveBeenCalled();
    expect(c.getRevealedSide()).toBe(null);
  });
});
