/* global THREE */

import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';
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

const MAX_LABELLED_VERTICES = 12;

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

// Ordered vertex world positions (local to the shape entity) as THREE.Vector3.
function getShapeVertices(entity) {
  const shape = entity?.components?.shape;
  let els;
  if (shape && typeof shape.getVertexEls === 'function') {
    els = shape.getVertexEls();
  } else if (entity) {
    els = Array.from(entity.children).filter(
      (c) => c.components && c.components['shape-vertex']
    );
  } else {
    els = [];
  }
  return els.map((el) => el.object3D.position.clone());
}

const ShapeSidebar = ({ entity }) => {
  const [, setTick] = useState(0);
  const { unitsPreference } = useStore();
  const readoutsRef = useRef(null);
  const lastHoverRef = useRef(null);

  // Re-render the panel list when this shape changes (appearance edits).
  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity) setTick((n) => n + 1);
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  // On-canvas readouts live exactly as long as this shape is selected (the
  // sidebar is mounted). Rebuild on units change; drive hover on large shapes.
  useEffect(() => {
    if (!entity || !entity.object3D) return undefined;
    const readouts = new ShapeReadouts(entity);
    readouts.setUnits(unitsPreference);
    readoutsRef.current = readouts;

    const render = (hoverPoint) => {
      const verts = getShapeVertices(entity);
      readouts.renderAll(
        verts,
        MAX_LABELLED_VERTICES,
        hoverPoint,
        isClosedShape(entity, verts.length)
      );
    };
    lastHoverRef.current = null;
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
      cancelAnimationFrame(raf);
      if (rowRaf !== null) cancelAnimationFrame(rowRaf);
      Events.off('entityupdate', onEntityUpdate);
      entity.removeEventListener('shape-geometry-changed', onGeometryChanged);
      if (canvas) canvas.removeEventListener('pointermove', onMove);
      readouts.dispose();
      readoutsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  // Keep the on-canvas labels' units in sync without remounting the renderer.
  useEffect(() => {
    const r = readoutsRef.current;
    if (!r) return;
    r.setUnits(unitsPreference);
    const verts = getShapeVertices(entity);
    r.renderAll(
      verts,
      MAX_LABELLED_VERTICES,
      lastHoverRef.current,
      isClosedShape(entity, verts.length)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsPreference]);

  const vertices = getShapeVertices(entity);
  const n = vertices.length;
  const closed = isClosedShape(entity, n);
  // A closed ring has a wrap segment (n→1) and a corner at every vertex; an open
  // polyline has n-1 segments and n-2 interior corners.
  const segCount = closed ? n : n - 1;
  const segments = [];
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    segments.push({
      label: `${i + 1}→${j + 1}`,
      value: formatLength(
        segmentLength(vertices[i], vertices[j]),
        unitsPreference
      )
    });
  }
  const angles = [];
  const cornerStart = closed ? 0 : 1;
  const cornerEnd = closed ? n : n - 1; // exclusive
  for (let i = cornerStart; i < cornerEnd; i++) {
    const deg = includedAngleDeg(
      vertices[(i + n - 1) % n],
      vertices[i],
      vertices[(i + 1) % n]
    );
    if (deg !== null) {
      angles.push({ label: `@${i + 1}`, value: formatAngle(deg) });
    }
  }
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
            <div className="fakePropertyRowLabel">Area</div>
            <div className="fakePropertyRowValue">
              <span className="text-lg font-bold text-green-600">
                {areaValue}
              </span>
            </div>
          </div>
        )}
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">Segments</div>
          <div className="fakePropertyRowValue">
            <span className="text-lg font-bold text-green-600">
              {segments.length}
            </span>
          </div>
        </div>
        {segments.map((s) => (
          <div className="propertyRow" key={`seg-${s.label}`}>
            <div className="fakePropertyRowLabel">Length {s.label}</div>
            <div className="fakePropertyRowValue">{s.value}</div>
          </div>
        ))}
        {angles.map((a) => (
          <div className="propertyRow" key={`ang-${a.label}`}>
            <div className="fakePropertyRowLabel">Angle {a.label}</div>
            <div className="fakePropertyRowValue">{a.value}</div>
          </div>
        ))}
        <div className="propertyRow">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            <div className="mb-1 font-semibold uppercase">💡 Shape Tips</div>
            <ul className="space-y-1">
              <li>• Lengths and angles measure the vertex centreline</li>
              <li>• Angles are measured in the ground (x-z) plane</li>
              {closed && <li>• Area is the enclosed ground (x-z) footprint</li>}
              {closed && (
                <li>• Fill opacity 0% hides the fill; the outline still shows</li>
              )}
              <li>• Edit line color, width and fill below</li>
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

// Instructions + draw-mode switch shown in the right panel while the shape draw
// tool is active (mirrors how the ruler surfaces guidance). Self-gates on the
// store so it can be rendered unconditionally by the Sidebar. Strings are
// hardcoded English, matching this block's existing copy (the draw feature does
// not use the i18n catalog — a single mode switch does not warrant introducing
// it here).
export const ShapeDrawInstructions = () => {
  const active = useStore((s) => s.shapeDrawActive);
  const mode = useStore((s) => s.shapeDrawMode);
  const setMode = useStore((s) => s.setShapeDrawMode);
  if (!active) return null;
  const autoClose = mode !== 'manual';
  return (
    <div className="sidepanelContent">
      <div className="rounded bg-blue-50 p-2 text-gray-600">
        <div className="mb-1 font-semibold uppercase">✏️ Draw a shape</div>
        <div className="mb-2">
          <div className="mb-1 font-semibold">Mode</div>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="shapeDrawMode"
              checked={autoClose}
              onChange={() => setMode('auto')}
            />
            <span className="text-gray-600">
              Auto-close — closes as you draw, so the closing edge and the
              enclosed area update live. Stays open if the shape can&rsquo;t
              close without crossing itself.
            </span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="shapeDrawMode"
              checked={!autoClose}
              onChange={() => setMode('manual')}
            />
            <span className="text-gray-600">
              Close manually — draws an open line. Click the first point when
              you want to close it.
            </span>
          </label>
        </div>
        <ul className="space-y-1">
          {autoClose ? (
            <>
              <li>• Click to add corners</li>
              <li>• Enter finishes, including the corner under the cursor</li>
              <li>• Esc or double-click finishes without it</li>
              <li>• Backspace removes the last corner</li>
              <li>• Ctrl+Z undoes the finished shape</li>
            </>
          ) : (
            <>
              <li>• Click to add points</li>
              <li>• Click the first point to close the shape</li>
              <li>• Enter finishes, including the point under the cursor</li>
              <li>• Esc or double-click finishes without it</li>
              <li>• Backspace removes the last point</li>
              <li>• Ctrl+Z undoes the finished shape</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
};

export default ShapeSidebar;
