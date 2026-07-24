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
  formatAngle
} from '../../lib/shapeMeasure';

const MAX_LABELLED_VERTICES = 12;

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
      readouts.renderAll(
        getShapeVertices(entity),
        MAX_LABELLED_VERTICES,
        hoverPoint
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
    r.renderAll(
      getShapeVertices(entity),
      MAX_LABELLED_VERTICES,
      lastHoverRef.current
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsPreference]);

  const vertices = getShapeVertices(entity);
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({
      label: `${i + 1}→${i + 2}`,
      value: formatLength(
        segmentLength(vertices[i], vertices[i + 1]),
        unitsPreference
      )
    });
  }
  const angles = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    const deg = includedAngleDeg(vertices[i - 1], vertices[i], vertices[i + 1]);
    if (deg !== null) {
      angles.push({ label: `@${i + 1}`, value: formatAngle(deg) });
    }
  }

  return (
    <div className="shape-sidebar">
      <div className="details">
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

// Instructions shown in the right panel while the shape draw tool is active
// (mirrors how the ruler surfaces guidance). Self-gates on the store so it can
// be rendered unconditionally by the Sidebar.
export const ShapeDrawInstructions = () => {
  const active = useStore((s) => s.shapeDrawActive);
  if (!active) return null;
  return (
    <div className="sidepanelContent">
      <div className="rounded bg-blue-50 p-2 text-gray-600">
        <div className="mb-1 font-semibold uppercase">✏️ Draw a shape</div>
        <ul className="space-y-1">
          <li>• Click on the ground to place points</li>
          <li>• Enter or double-click to finish</li>
          <li>• Backspace removes the last point</li>
          <li>• Esc cancels the shape</li>
        </ul>
      </div>
    </div>
  );
};

export default ShapeSidebar;
