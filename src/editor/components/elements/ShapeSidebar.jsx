/* global AFRAME, THREE */

import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useStore from '@/store';
import Events from '../../lib/Events';
import ShapeReadouts from '../../lib/ShapeReadouts';
import {
  segmentLength,
  includedAngleDeg,
  formatLength,
  formatAngle,
  formatArea
} from '../../lib/shapeMeasure';
import { polygonAreaXZ } from '../../../aframe-components/polygonMath.js';
import {
  adjacentSegments,
  canOfferInsert,
  segmentForVertexPair
} from '../../lib/shapeEditRules.js';
import {
  shapeStyleSeedFromUpdate,
  setShapeStyle
} from '../../lib/shapeStyle.js';
import { Button } from './Button';
import { Chevron24Down } from '@shared/icons';

const MAX_LABELLED_VERTICES = 12;

// Segment-length rows shown before the list collapses behind "Show all" — the
// styling controls below the list must stay reachable without scrolling past a
// long shape's every side.
const SEGMENT_ROWS_COLLAPSED = 5;

// ms — floor on how often the React row list re-renders off geometry changes.
// A shape emits one of those per re-derive, and a re-derive can happen every
// frame while a vertex is being dragged; a full reconciliation of the row tree
// at that cadence is the one genuinely new per-frame cost this subscription
// adds. Applied unconditionally rather than only during a drag: outside one the
// event fires once per edit, where a ~66 ms delay before a number settles is
// not perceptible, and a "during a drag" condition would need a signal from the
// canvas tooling that a React component has no business knowing about. The
// on-canvas readouts stay at full rate — those are live feedback the user
// watches, where the rows are numbers the user reads.
const ROW_REFRESH_MIN_INTERVAL_MS = 66;

// Whether this shape entity is a closed polygon (≥ 3 vertices + closed prop).
function isClosedShape(entity, vertexCount) {
  return !!entity?.components?.shape?.data?.closed && vertexCount >= 3;
}

// Reused scratch for the hover pick (hoisted off the per-pointermove path).
const hoverRaycaster = new THREE.Raycaster();
const hoverNdc = new THREE.Vector2();
const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hoverWorld = new THREE.Vector3();
const shapeWorldPos = new THREE.Vector3();

// Reverse the shape's direction: vertex k takes the position of vertex
// n-1-k, so segment 1↔N numbering flips and anything that follows the
// drawing order (street fill clones, measurement labels) runs the other
// way. Implemented as position swaps rather than DOM reordering — the
// existing shapevertexmove command handles each leg, and a 'multi' makes
// the whole reversal one undo step.
function reverseShapeDirection(entity) {
  const els = getShapeVertexEls(entity);
  if (els.length < 2) return false;
  const positions = els.map((el) => {
    const p = el.getAttribute('position');
    return { x: p.x, y: p.y, z: p.z };
  });
  const commands = els.map((el, i) => [
    'shapevertexmove',
    {
      entity: el,
      component: 'position',
      value: positions[els.length - 1 - i],
      oldValue: positions[i],
      noSelectEntity: true
    }
  ]);
  AFRAME.INSPECTOR.execute('multi', commands);
  return true;
}

// The shape's ordered vertex elements.
function getShapeVertexEls(entity) {
  const shape = entity?.components?.shape;
  if (shape && typeof shape.getVertexEls === 'function') {
    return shape.getVertexEls();
  }
  if (entity) {
    return Array.from(entity.children).filter(
      (c) => c.components && c.components['shape-vertex']
    );
  }
  return [];
}

// Ordered vertex positions (local to the shape entity) as THREE.Vector3.
function getShapeVertices(entity) {
  return getShapeVertexEls(entity).map((el) => el.object3D.position.clone());
}

// Which segment, if any, currently has an insert button open on it.
//
// DERIVED here, at render time, from the reveal's single owner — a value
// computed at render cannot go stale, so there is nothing to invalidate,
// nothing to publish and nothing to keep in sync.
//
// `els` is passed in rather than read again: the resolution has to happen in
// the SAME enumeration that produced the chips, and one read is what makes that
// provable rather than argued.
function revealedSegment(closed, els) {
  // Through the accessor, never the field behind it: a rename of private state
  // in the controls layer would otherwise make this read `undefined`, and the
  // reveal would just stop with no error anywhere.
  const side = AFRAME.INSPECTOR?.shapeVertexControls?.getRevealedSide();
  if (!side) return null;
  const seg = segmentForVertexPair(els, side.a, side.b, closed);
  return seg < 0 ? null : seg;
}

// The segments that must be labelled whether or not the shape is above the
// label cap: those adjacent to the sub-selected vertex, and the one with a
// button open on it.
//
// The reason for the first is that clicking a vertex is the deliberate way to
// bring a chosen side's measurement up on a shape too dense to label in full —
// on touch it is the only reliable way. The reason for the second is that the
// caption IS the click target: the sliver of bare canvas between a chip's hit
// box and the button above it — OFFSET_MARGIN_PX, less the overhang the
// MIN_TAP_TARGET_PX-tall hit box already covers — fires a pointermove that
// rebuilds every label, and without the pin the number the user just clicked
// vanishes while they are reaching for the button beside it.
//
// Same derived-at-render-time argument as above.
function pinnedSegments(n, closed, revealed, els) {
  const active = AFRAME.INSPECTOR?.shapeVertexControls?.getActiveVertex();
  // Deliberately the SAME enumeration the positions came from, not the one the
  // controls layer uses. The two differ: this one tests the initialised
  // `shape-vertex` component, the controls layer tests the attribute. So for one
  // microtask after an insert the new element is active but not yet in this
  // list, and the pin resolves to null for that render — invisible below the
  // cap, and above it the insert's own re-derive re-renders within the frame.
  // Filtering on the attribute instead would trade that for a visible wrong
  // answer: the element would be found, with its position still at the origin.
  const i = active ? els.indexOf(active) : -1;
  const adjacent = i < 0 ? [] : adjacentSegments(i, n, closed);
  if (revealed === null) return adjacent.length ? adjacent : null;
  return adjacent.includes(revealed) ? adjacent : [...adjacent, revealed];
}

// The ONLY place renderAll is called, so there is no second argument list to
// keep in step with this one.
//
// The vertex element list is read ONCE here and threaded through everything
// that needs it. Beyond saving two child-list walks per frame during a drag,
// that is what makes it provable rather than argued that all three resolutions
// — a chip's segment index, the revealed segment, and the pin set — address the
// same array. Three independent reads of a live child list can each return a
// different one; one read cannot. `lastRenderElsRef` then literally holds the
// array the chips were stamped against.
function renderReadouts(readouts, entity, hoverPoint, lastRenderElsRef) {
  const els = getShapeVertexEls(entity);
  const verts = els.map((el) => el.object3D.position.clone());
  const closed = isClosedShape(entity, verts.length);
  const revealed = revealedSegment(closed, els);
  if (lastRenderElsRef) lastRenderElsRef.current = els;
  readouts.renderAll(
    verts,
    MAX_LABELLED_VERTICES,
    hoverPoint,
    closed,
    pinnedSegments(verts.length, closed, revealed, els),
    {
      isInsertable: (i) => canOfferInsert(verts, i),
      revealedSegment: revealed
    }
  );
}

const ShapeSidebar = ({ entity }) => {
  const intl = useIntl();
  const [, setTick] = useState(0);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const { unitsPreference } = useStore();

  // A freshly selected shape starts with the segment list collapsed.
  useEffect(() => {
    setShowAllSegments(false);
  }, [entity]);
  const readoutsRef = useRef(null);
  const lastHoverRef = useRef(null);
  // The vertex element array the last render's chips were stamped against.
  const lastRenderElsRef = useRef(null);

  // Re-render the panel list when this shape changes (appearance edits) — and
  // make this shape's appearance the default for the next shape drawn.
  //
  // Scope: the requirement is "restyled in the properties panel", and this
  // effect's lifetime is exactly "this shape is selected" (Sidebar mounts
  // ShapeSidebar iff the entity carries a `shape` component), so selection is
  // the gate and no extra condition is needed. What is stored is a SNAPSHOT
  // taken while the shape is selected, not a live link to it: once the shape is
  // deselected the default keeps the value it last took.
  //
  // The default is a preference, deliberately outside the undo history (same
  // class as unitsPreference) — an undo can move it, but only by changing a
  // selected shape's appearance. The draw tool is a reader only; drawing never
  // reseats it. See docs/shapes.md#sticky-style.
  useEffect(() => {
    const onEntityUpdate = (detail) => {
      // Guard the payload here rather than assuming it: `shapeStyleSeedFromUpdate`
      // is total by contract, and this handler should not be the one place that
      // throws on a malformed emit.
      if (!detail || detail.entity !== entity) return;
      setTick((n) => n + 1);
      const seed = shapeStyleSeedFromUpdate(detail, entity);
      if (seed) setShapeStyle(seed);
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  // On-canvas readouts live exactly as long as this shape is selected (the
  // sidebar is mounted). Rebuild on units change; drive hover on large shapes.
  useEffect(() => {
    if (!entity || !entity.object3D) return undefined;
    // The insert-hint tooltip is passed in because the readout layer (CSS2D,
    // outside React) has no intl context of its own. intl.locale is in the
    // dep list for exactly that reason: View > Language switches the locale
    // live, and the renderer must be remounted to re-capture the string.
    const readouts = new ShapeReadouts(
      entity,
      intl.formatMessage({
        id: 'shapeReadouts.insertHint',
        defaultMessage: 'Add a vertex to this side'
      })
    );
    readouts.setUnits(unitsPreference);
    readoutsRef.current = readouts;

    const render = (hoverPoint) =>
      renderReadouts(readouts, entity, hoverPoint, lastRenderElsRef);
    lastHoverRef.current = null;

    // Coalesce the sub-selection renders. Pressing the insert button changes
    // both the active vertex and the revealed side in one turn, and each would
    // otherwise drive its own full clear() + rebuild of every label and every
    // arc. Only these two go through here: the geometry and hover paths are
    // streams where the latest state matters and a per-frame rebuild is the
    // intended behaviour, so deferring them would change their timing for no
    // gain.
    let renderQueued = false;
    let disposed = false;
    const scheduleRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        // Required rather than defensive: the cleanup below disposes the
        // renderer, and a microtask queued before a deselect would otherwise
        // render against a disposed one.
        if (disposed) return;
        render(lastHoverRef.current);
      });
    };

    render(null);
    // Belt for a post-commit child-init race: re-read positions next frame in
    // case a shape-vertex hadn't positioned yet at mount.
    const raf = requestAnimationFrame(() => render(lastHoverRef.current));

    // Re-derive when this shape changes (a late child init, or future on-canvas
    // vertex editing) — otherwise the on-canvas readouts go stale.
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity) render(lastHoverRef.current);
    };
    Events.on('entityupdate', onEntityUpdate);

    // Sub-selecting a different vertex changes no geometry — it emits no
    // entityupdate, no shape-geometry-changed, and moves nothing — so without
    // this nothing would tell the panel to re-derive which captions are pinned.
    // The notification carries no payload: the pin is read from its owner at
    // render time.
    const onActiveVertexChanged = () => scheduleRender();
    Events.on('shapevertexactivechanged', onActiveVertexChanged);

    // Same shape, for which side has an insert button open on it: it changes no
    // geometry and moves nothing, so nothing else would tell the panel to
    // re-derive which caption is pinned and which is marked as revealed.
    const onRevealChanged = () => scheduleRender();
    Events.on('shapevertexrevealchanged', onRevealChanged);

    // ONE delegated listener rather than one per chip. A label is rebuilt on
    // every geometry change — every frame of a vertex drag — so per-chip
    // binding would mean binding and discarding a couple of dozen listeners a
    // frame. (It is NOT a defence against a rebuild landing mid-click: if the
    // chip is gone between press and release the retargeted click lands on an
    // ancestor and is simply dropped, delegated or not. Accepted — a static
    // press generates no pointermove, so the rebuild that would do it does not
    // fire.)
    //
    // Resolved against the array THIS render stamped, not a fresh read. A chip
    // carries a segment index; pairing that index with a list read at click
    // time can name a different-but-still-adjacent side after a structural edit
    // in between — which is exactly the "adds a point to a side the user never
    // chose" failure the element-pair naming exists to prevent, reintroduced at
    // the resolution step. If the edit removed one of the two elements,
    // activateSide's own validation refuses. Fail-safe either way.
    //
    // No drag gate HERE, and that is not the same as no drag gate: there is one
    // a call deep, on the branch of activateSide that inserts. Why it belongs
    // there and not here: docs/shape-vertex-editing.md, "Click versus drag".
    // Bound on `document`, so it sees every chip in the page and not only this
    // panel's — the listener cannot be scoped to a container, because every
    // CSS2D element in the scene shares one renderer container. The chip
    // therefore carries WHOSE enumeration stamped it, and a chip from any other
    // renderer instance is dropped here. Nothing else stamps one today; this is
    // what stops that staying true only by accident, since resolving a foreign
    // chip's index against this panel's array is exactly the mismatch
    // lastRenderElsRef exists to prevent.
    const onLabelClick = (e) => {
      const outer = e.target?.closest?.('[data-shape-segment]');
      if (!outer) return;
      if (outer.dataset.shapeReadouts !== readouts.instanceId) return;
      const els = lastRenderElsRef.current;
      if (!els || els.length < 2) return;
      const n = els.length;
      const seg = Number(outer.dataset.shapeSegment);
      const a = els[seg];
      const b = els[(seg + 1) % n];
      if (!a || !b || a.parentNode !== entity || b.parentNode !== entity) {
        return;
      }
      AFRAME.INSPECTOR?.shapeVertexControls?.activateSide(a, b);
    };
    document.addEventListener('click', onLabelClick);

    // The shape announces every re-derive, including the ones driven by a
    // vertex moving directly rather than through a command — which
    // `entityupdate` never sees. Without this, dragging a vertex would leave
    // both the canvas readouts and the sidebar rows frozen until release.
    let rowRaf = null;
    let lastRowsAt = 0;
    const refreshRows = () => {
      // Trailing-edge throttle: too soon means wait another frame, never means
      // drop, so the last change of a drag always reaches the rows.
      if (performance.now() - lastRowsAt < ROW_REFRESH_MIN_INTERVAL_MS) {
        rowRaf = requestAnimationFrame(refreshRows);
        return;
      }
      rowRaf = null;
      lastRowsAt = performance.now();
      setTick((n) => n + 1);
    };
    const onGeometryChanged = () => {
      render(lastHoverRef.current);
      // The rAF also keeps the React update off the synchronous event path.
      if (rowRaf === null) rowRaf = requestAnimationFrame(refreshRows);
    };
    entity.addEventListener('shape-geometry-changed', onGeometryChanged);

    // Hover mode only matters above the label cap — but WHICH side of the cap
    // a shape is on changes while it is selected, now that vertices can be
    // inserted and deleted on canvas. So the listener is bound for the life of
    // the selection and asks the question per event, rather than being bound
    // once on the answer at selection time.
    //
    // Binding it once was a trap with no recovery: a shape selected at or below
    // the cap got no listener, so `lastHoverRef` stayed null forever; growing
    // past the cap then put `renderAll` on its hover branch, which clears the
    // labels and returns early when there is no hover point. Every caption on
    // the shape vanished and did not come back until it was deselected and
    // reselected.
    const canvas = AFRAME.scenes[0]?.canvas;
    const onMove = (e) => {
      // Below the cap every segment is labelled regardless of the cursor, so
      // there is nothing to track and no reason to pay for a raycast per
      // pointermove — the early return, not the missing listener, is what keeps
      // the common case cheap.
      if (getShapeVertices(entity).length <= MAX_LABELLED_VERTICES) return;
      const camera = AFRAME.INSPECTOR?.camera;
      if (!camera) return;
      const rect = canvas.getBoundingClientRect();
      hoverNdc.set(
        (2 * (e.clientX - rect.left)) / rect.width - 1,
        -((2 * (e.clientY - rect.top)) / rect.height - 1)
      );
      hoverRaycaster.setFromCamera(hoverNdc, camera);
      // Intersect the plane at the SHAPE's height (its world y), not y=0: a
      // shape sits at height k, so a y=0 pick would x/z-parallax off it under a
      // tilted camera and pick the wrong nearest segment.
      entity.object3D.getWorldPosition(shapeWorldPos);
      hoverPlane.constant = -shapeWorldPos.y;
      if (!hoverRaycaster.ray.intersectPlane(hoverPlane, hoverWorld)) return;
      const local = hoverWorld.clone();
      entity.object3D.worldToLocal(local);
      lastHoverRef.current = local;
      render(local);
    };
    if (canvas) canvas.addEventListener('pointermove', onMove);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (rowRaf !== null) cancelAnimationFrame(rowRaf);
      Events.off('entityupdate', onEntityUpdate);
      Events.off('shapevertexactivechanged', onActiveVertexChanged);
      Events.off('shapevertexrevealchanged', onRevealChanged);
      entity.removeEventListener('shape-geometry-changed', onGeometryChanged);
      document.removeEventListener('click', onLabelClick);
      if (canvas) canvas.removeEventListener('pointermove', onMove);
      readouts.dispose();
      readoutsRef.current = null;
      lastRenderElsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, intl.locale]);

  // Keep the on-canvas labels' units in sync without remounting the renderer.
  useEffect(() => {
    const r = readoutsRef.current;
    if (!r) return;
    r.setUnits(unitsPreference);
    renderReadouts(r, entity, lastHoverRef.current, lastRenderElsRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsPreference]);

  const vertices = getShapeVertices(entity);
  // Measure in the WORLD frame: a shape nested inside a scaled (or rotated)
  // group must report the size it renders at, matching the on-canvas readouts
  // and the component's area label. getShapeVertices clones, so transforming
  // in place is safe — placement code elsewhere stays local.
  entity.object3D.updateWorldMatrix(true, false);
  for (const v of vertices) v.applyMatrix4(entity.object3D.matrixWorld);
  const n = vertices.length;
  const closed = isClosedShape(entity, n);
  // A closed ring has a wrap segment (n→1) and a corner at every vertex; an open
  // polyline has n-1 segments and n-2 interior corners.
  const segCount = closed ? n : n - 1;
  const segments = [];
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    // The corner reached at this segment's far end, folded into the row as a
    // small subscript rather than a row of its own: a ring has a corner at
    // every vertex, an open line only at interior ones (so its last segment,
    // which ends at the line's endpoint, carries none).
    const hasCorner = closed || j < n - 1;
    const deg = hasCorner
      ? includedAngleDeg(vertices[i], vertices[j], vertices[(j + 1) % n])
      : null;
    segments.push({
      label: `${i + 1}→${j + 1}`,
      value: formatLength(
        segmentLength(vertices[i], vertices[j]),
        unitsPreference
      ),
      angle: deg === null ? null : formatAngle(deg)
    });
  }
  const segmentsCollapsed =
    segments.length > SEGMENT_ROWS_COLLAPSED && !showAllSegments;
  const visibleSegments = segmentsCollapsed
    ? segments.slice(0, SEGMENT_ROWS_COLLAPSED)
    : segments;
  // Compute the enclosed area from the vertices directly (same shoelace the
  // component uses for its on-canvas label — identical value, no dependency on
  // the component's async re-derive having run yet). Static per React render —
  // refreshes on entityupdate/reselect, like the length rows (the on-canvas
  // label is the live one under animation).
  const areaValue = closed
    ? formatArea(polygonAreaXZ(vertices), unitsPreference)
    : null;

  return (
    <div className="shape-sidebar">
      <div className="details">
        {closed && (
          <div className="propertyRow">
            <div className="fakePropertyRowLabel">
              {intl.formatMessage({
                id: 'shapeSidebar.area',
                defaultMessage: 'Area'
              })}
            </div>
            <div className="fakePropertyRowValue">
              <span className="text-lg font-bold text-green-600">
                {areaValue}
              </span>
            </div>
          </div>
        )}
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">
            {intl.formatMessage({
              id: 'shapeSidebar.segments',
              defaultMessage: 'Segments'
            })}
          </div>
          <div className="fakePropertyRowValue">
            <span className="text-lg font-bold text-green-600">
              {segments.length}
            </span>
          </div>
        </div>
        <div className={`segmentRows${segmentsCollapsed ? ' collapsed' : ''}`}>
          {visibleSegments.map((s) => (
            <div className="propertyRow segmentRow" key={`seg-${s.label}`}>
              <div className="fakePropertyRowLabel">
                {intl.formatMessage(
                  {
                    id: 'shapeSidebar.length',
                    defaultMessage: 'Length {label}'
                  },
                  { label: s.label }
                )}
              </div>
              <div className="fakePropertyRowValue">
                <div>
                  <div>{s.value}</div>
                  {s.angle && (
                    <div className="segmentAngle">
                      {intl.formatMessage(
                        {
                          id: 'shapeSidebar.cornerAngle',
                          defaultMessage: '∠ {value}'
                        },
                        { value: s.angle }
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {segments.length > SEGMENT_ROWS_COLLAPSED && (
            // Inside segmentRows so the collapsed state can overlay it on the
            // fade (position: absolute anchors to the row container).
            <div
              className={`segmentRowsToggle${segmentsCollapsed ? '' : ' expanded'}`}
            >
              <Button
                variant="toolbtn"
                onClick={() => setShowAllSegments((v) => !v)}
              >
                {segmentsCollapsed
                  ? intl.formatMessage(
                      {
                        id: 'shapeSidebar.showAllSegments',
                        defaultMessage: 'Show all {count} segments'
                      },
                      { count: segments.length }
                    )
                  : intl.formatMessage({
                      id: 'shapeSidebar.showFewerSegments',
                      defaultMessage: 'Show fewer segments'
                    })}
                <Chevron24Down />
              </Button>
            </div>
          )}
        </div>
        <div className="propertyRow">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            <div className="mb-1 font-semibold uppercase">
              💡{' '}
              {intl.formatMessage({
                id: 'shapeSidebar.tipsTitle',
                defaultMessage: 'Shape Drawing Tips'
              })}
            </div>
            <ul className="space-y-1">
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeSidebar.tipVertex',
                  defaultMessage:
                    'Click a blue vertex dot to move it or delete it'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeSidebar.tipShift',
                  defaultMessage:
                    'Hold Shift while dragging a vertex to raise or lower it'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeSidebar.tipInsert',
                  defaultMessage:
                    "Click a side's length to add a vertex to that side"
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeSidebar.tipStyle',
                  defaultMessage: 'Edit line color, width and fill below'
                })}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

ShapeSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

// Curated rows shown at the top of the featured "shape" component section
// (FeaturedComponents passes this as the section's lead-in, above the
// schema-driven closed/fill/line rows): Reverse direction, plus curve style
// and — for arcs — corner radius. curveType/filletRadius are shape props (a
// curve is a property of the drawing, street or no street — any street
// following this shape as its path reads them from here); their raw fields are
// hidden from the schema rows in favour of these controls. Values are read
// straight off the component; the tick only forces a re-render.
export const ShapeSectionControls = ({ entity }) => {
  const intl = useIntl();
  const [, setCurveTick] = useState(0);
  const shapeData = entity.components?.shape?.data;
  const setShapeCurveProperty = (property, value) => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'shape',
      property,
      value
    });
    setCurveTick((t) => t + 1);
  };

  // Reverse the drawing order. Any street following this shape as its path
  // re-lays itself automatically (the vertex rewrite re-derives the shape,
  // which emits street-path-changed).
  const onReverseDirection = () => {
    reverseShapeDirection(entity);
  };

  const n = getShapeVertexEls(entity).length;
  return (
    <>
      {n >= 2 && (
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">
            {intl.formatMessage({
              id: 'shapeSidebar.direction',
              defaultMessage: 'Direction'
            })}
          </div>
          <div className="fakePropertyRowValue">
            <Button variant="toolbtn" onClick={onReverseDirection}>
              {intl.formatMessage({
                id: 'shapeSidebar.reverse',
                defaultMessage: 'Reverse'
              })}
            </Button>
          </div>
        </div>
      )}
      {n >= 3 && (
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">
            {intl.formatMessage({
              id: 'shapeSidebar.curveStyle',
              defaultMessage: 'Curve Style'
            })}
          </div>
          <div className="fakePropertyRowValue">
            <select
              value={shapeData?.curveType ?? 'linear'}
              onChange={(e) => {
                setShapeCurveProperty('curveType', e.target.value);
              }}
            >
              <option value="linear">
                {intl.formatMessage({
                  id: 'shapeSidebar.curveLinear',
                  defaultMessage: 'Straight / hard corners'
                })}
              </option>
              <option value="smooth">
                {intl.formatMessage({
                  id: 'shapeSidebar.curveSmooth',
                  defaultMessage: 'Smooth (spline)'
                })}
              </option>
              <option value="arc">
                {intl.formatMessage({
                  id: 'shapeSidebar.curveArc',
                  defaultMessage: 'Arcs (corner radius)'
                })}
              </option>
            </select>
          </div>
        </div>
      )}
      {shapeData?.curveType === 'arc' && (
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">
            {intl.formatMessage({
              id: 'shapeSidebar.cornerRadius',
              defaultMessage: 'Corner Radius'
            })}
          </div>
          <div className="fakePropertyRowValue">
            <input
              type="number"
              min="0"
              step="1"
              value={shapeData.filletRadius}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) {
                  setShapeCurveProperty('filletRadius', Math.max(0, v));
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

ShapeSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};

// Instructions + draw-mode switch shown in the right panel while the shape draw
// tool is active (mirrors how the ruler surfaced guidance). Self-gates on the
// store so it can be rendered unconditionally by the Sidebar. Strings live in
// the i18n catalog (shapeDraw.*), like the rest of the editor chrome.
export const ShapeDrawInstructions = () => {
  const intl = useIntl();
  const active = useStore((s) => s.shapeDrawActive);
  const mode = useStore((s) => s.shapeDrawMode);
  const setMode = useStore((s) => s.setShapeDrawMode);
  if (!active) return null;
  const autoClose = mode !== 'manual';
  return (
    <div className="sidepanelContent">
      <div className="rounded bg-blue-50 p-2 text-gray-600">
        <div className="mb-1 font-semibold uppercase">
          ✏️{' '}
          {intl.formatMessage({
            id: 'shapeDraw.title',
            defaultMessage: 'Draw a shape'
          })}
        </div>
        <div className="mb-2">
          <div className="mb-1 font-semibold">
            {intl.formatMessage({
              id: 'shapeDraw.mode',
              defaultMessage: 'Mode'
            })}
          </div>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="shapeDrawMode"
              checked={!autoClose}
              onChange={() => setMode('manual')}
            />
            <span className="text-gray-600">
              {intl.formatMessage({
                id: 'shapeDraw.closeManually',
                defaultMessage:
                  'Close manually — draws an open line. Click the first point when you want to close it.'
              })}
            </span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="shapeDrawMode"
              checked={autoClose}
              onChange={() => setMode('auto')}
            />
            <span className="text-gray-600">
              {intl.formatMessage({
                id: 'shapeDraw.autoClose',
                defaultMessage:
                  "Auto-close — closes as you draw, so the closing edge and the enclosed area update live. Stays open if the shape can't close without crossing itself."
              })}
            </span>
          </label>
        </div>
        <ul className="space-y-1">
          {autoClose ? (
            <>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.addCorners',
                  defaultMessage: 'Click to add corners'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.finishEnterCorner',
                  defaultMessage:
                    'Enter finishes, including the corner under the cursor'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.finishWithout',
                  defaultMessage: 'Esc or double-click finishes without it'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.backspaceCorner',
                  defaultMessage: 'Backspace removes the last corner'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.undo',
                  defaultMessage: 'Ctrl+Z undoes the finished shape'
                })}
              </li>
            </>
          ) : (
            <>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.addPoints',
                  defaultMessage: 'Click to add points'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.closeFirstPoint',
                  defaultMessage: 'Click the first point to close the shape'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.finishEnterPoint',
                  defaultMessage:
                    'Enter finishes, including the point under the cursor'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.finishWithout',
                  defaultMessage: 'Esc or double-click finishes without it'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.backspacePoint',
                  defaultMessage: 'Backspace removes the last point'
                })}
              </li>
              <li>
                •{' '}
                {intl.formatMessage({
                  id: 'shapeDraw.undo',
                  defaultMessage: 'Ctrl+Z undoes the finished shape'
                })}
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
};

export default ShapeSidebar;
