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

const MAX_LABELLED_VERTICES = 12;

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
    // The Area row reads shape.area, which the component fills on its
    // RAF-coalesced re-derive — so on a freshly committed/selected shape it can
    // be 0 at first render. Bump once next frame (after that re-derive) so the
    // row shows the real area without waiting for an entityupdate.
    const raf = requestAnimationFrame(() => setTick((n) => n + 1));
    return () => {
      Events.off('entityupdate', onEntityUpdate);
      cancelAnimationFrame(raf);
    };
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

    // Re-derive when this shape changes (a late child init, or vertex editing
    // once TASK-104 lands) — otherwise the on-canvas readouts go stale.
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity) render(lastHoverRef.current);
    };
    Events.on('entityupdate', onEntityUpdate);

    // Hover mode only matters above the label cap.
    const canvas = AFRAME.scenes[0]?.canvas;
    const useHover =
      getShapeVertices(entity).length > MAX_LABELLED_VERTICES && canvas;
    const onMove = (e) => {
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
    if (useHover) canvas.addEventListener('pointermove', onMove);

    return () => {
      cancelAnimationFrame(raf);
      Events.off('entityupdate', onEntityUpdate);
      if (useHover && canvas) canvas.removeEventListener('pointermove', onMove);
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
  // Enclosed area comes from the shape component (computed on every re-derive);
  // read the value rather than recomputing. Static per React render — refreshes
  // on entityupdate/reselect, like the length rows (the on-canvas label is the
  // live one under animation).
  const areaValue = closed
    ? formatArea(entity?.components?.shape?.area || 0, unitsPreference)
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
              <li>• Edit colour and width below</li>
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
  const polygon = mode !== 'open';
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
              checked={polygon}
              onChange={() => setMode('polygon')}
            />
            <span>
              Polygon — clicks form a closed shape; its area is shown.
            </span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="shapeDrawMode"
              checked={!polygon}
              onChange={() => setMode('open')}
            />
            <span>
              Open polyline — clicks form an open line; click the first point to
              close it.
            </span>
          </label>
        </div>
        <ul className="space-y-1">
          {polygon ? (
            <>
              <li>• Click to add corners</li>
              <li>• Enter or double-click to finish</li>
              <li>• Backspace removes the last corner</li>
              <li>• Esc cancels the shape</li>
            </>
          ) : (
            <>
              <li>• Click to add points</li>
              <li>• Click the first point to close the shape</li>
              <li>• Enter or double-click to finish (open)</li>
              <li>• Backspace removes the last point; Esc cancels</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
};

export default ShapeSidebar;
