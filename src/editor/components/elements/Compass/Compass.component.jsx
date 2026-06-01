/* global AFRAME */

// TASK-011 — Plan-view compass widget (Google Maps style).
//
// DOM/SVG React component (NOT drawn into the WebGL canvas, so the tooltip
// text stays translatable). Renders a circular dial, a red-north /
// muted-south needle, and two ~30° rim rotation arrows. A requestAnimation-
// Frame loop reads the live inspector camera each frame and writes the
// needle angle straight to a ref'd SVG transform (no per-frame React
// re-render). Clicks are classified into body / left-arrow / right-arrow
// and dispatched to the ExperimentalControls instance, which owns all the
// camera-pose logic and the double-click queue.
//
// Mount-gated by isExperimentalNav() in Main.jsx.

import { useEffect, useRef, useState } from 'react';
import {
  needleScreenAngle,
  cameraTiltDegrees,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES
} from '../../../lib/nav-experimental/index.js';
import styles from './Compass.module.scss';

// SVG geometry. 64x64 viewBox, centre (32,32). Screen-angle convention
// matches the needle math: 0deg = up (12 o'clock), positive = clockwise.
const CX = 32;
const CY = 32;
const DIAL_R = 22; // dial / body radius
const ARROW_INNER_R = 23; // rim arc inner radius
const ARROW_OUTER_R = 31; // rim arc outer radius
const ARROW_HALF_SPAN = 18; // half of the ~36deg arc

// Point on a circle at screen angle `deg` (0 = up, CW+) and radius `r`.
function polar(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
}

// Annular-sector path (a filled "rim arc" wedge) from a1 to a2 (screen
// degrees), between inner and outer radii. Used as the arrow hit regions —
// fully filled so the whole sector is a pointer target even where it is
// visually transparent.
function annularSector(a1, a2, ri, ro) {
  const [ox1, oy1] = polar(a1, ro);
  const [ox2, oy2] = polar(a2, ro);
  const [ix2, iy2] = polar(a2, ri);
  const [ix1, iy1] = polar(a1, ri);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  // sweep=1 (clockwise) on the outer edge, sweep=0 back along the inner.
  return [
    `M ${ox1} ${oy1}`,
    `A ${ro} ${ro} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${ri} ${ri} 0 ${large} 0 ${ix1} ${iy1}`,
    'Z'
  ].join(' ');
}

// Chevron glyph centred on a rim arc at `centreDeg`, pointing outward.
function chevron(centreDeg) {
  const [tipX, tipY] = polar(centreDeg, ARROW_OUTER_R - 1);
  const [bx1, by1] = polar(centreDeg - 7, ARROW_INNER_R + 2);
  const [bx2, by2] = polar(centreDeg + 7, ARROW_INNER_R + 2);
  return `M ${bx1} ${by1} L ${tipX} ${tipY} L ${bx2} ${by2}`;
}

const RIGHT_CENTRE = 90; // 3 o'clock
const LEFT_CENTRE = 270; // 9 o'clock

const RIGHT_SECTOR = annularSector(
  RIGHT_CENTRE - ARROW_HALF_SPAN,
  RIGHT_CENTRE + ARROW_HALF_SPAN,
  ARROW_INNER_R,
  ARROW_OUTER_R
);
const LEFT_SECTOR = annularSector(
  LEFT_CENTRE - ARROW_HALF_SPAN,
  LEFT_CENTRE + ARROW_HALF_SPAN,
  ARROW_INNER_R,
  ARROW_OUTER_R
);

const controls = () =>
  typeof AFRAME !== 'undefined' && AFRAME.INSPECTOR
    ? AFRAME.INSPECTOR.controls
    : null;

// Pose-aware body tooltip, computed from the same tests as the dispatcher.
function bodyTooltip(camera) {
  if (!camera || camera.type !== 'PerspectiveCamera') return 'Plan view';
  const isTopDown =
    90 - cameraTiltDegrees(camera) <= COMPASS_TOPDOWN_TOLERANCE_DEGREES;
  if (!isTopDown) return 'Plan view';
  const isNorthUp =
    Math.abs(needleScreenAngle(camera)) <= COMPASS_NORTH_TOLERANCE_DEGREES;
  if (!isNorthUp) return 'Face north';
  return 'Reset view';
}

export const Compass = () => {
  const needleRef = useRef(null);
  const [hovered, setHovered] = useState(null); // 'body' | 'left' | 'right' | null
  const [tooltip, setTooltip] = useState('Plan view');
  // Mirror `hovered` into a ref so the rAF loop (empty-deps effect) can read
  // the live hover region without re-subscribing each frame.
  const hoveredRef = useRef(null);
  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  // rAF needle loop. Reads the live inspector camera each frame and writes
  // the needle angle directly to the ref'd SVG transform. Holds the last
  // angle when the camera is unavailable or briefly orthographic (plan-view
  // toggle window). Cancelled on unmount. Also recomputes the pose-aware body
  // tooltip each frame while the body is hovered, committing to state only on
  // change to avoid needless re-renders.
  useEffect(() => {
    let raf;
    const loop = () => {
      const inspector = typeof AFRAME !== 'undefined' ? AFRAME.INSPECTOR : null;
      const camera = inspector ? inspector.camera : null;
      if (camera && camera.type === 'PerspectiveCamera' && needleRef.current) {
        const angle = needleScreenAngle(camera);
        needleRef.current.style.transform = `rotate(${angle}deg)`;
      }
      if (hoveredRef.current === 'body') {
        const next = bodyTooltip(camera);
        setTooltip((prev) => (prev === next ? prev : next));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dispatch = (region) => {
    const c = controls();
    if (!c) return;
    if (region === 'body') c.handleCompassBodyClick();
    else if (region === 'left') c.handleCompassRotate(-1);
    else if (region === 'right') c.handleCompassRotate(+1);
  };

  const onEnter = (region) => {
    setHovered(region);
    if (region === 'body') {
      const inspector = typeof AFRAME !== 'undefined' ? AFRAME.INSPECTOR : null;
      setTooltip(bodyTooltip(inspector ? inspector.camera : null));
    } else if (region === 'left') {
      setTooltip('Rotate left 90°');
    } else if (region === 'right') {
      setTooltip('Rotate right 90°');
    }
  };

  const onLeave = (region) => {
    setHovered((h) => (h === region ? null : h));
  };

  const keyActivate = (region) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dispatch(region);
    }
  };

  const regionProps = (region) => ({
    className: `${styles.hitRegion} ${hovered === region ? styles.hovered : ''}`,
    role: 'button',
    tabIndex: 0,
    onClick: () => dispatch(region),
    onKeyDown: keyActivate(region),
    onPointerEnter: () => onEnter(region),
    onPointerLeave: () => onLeave(region)
  });

  // Pose-aware label for the body hit region's aria-label, computed from the
  // live camera the same way as the visible tooltip so screen-reader users
  // hear the action the click will actually perform.
  const inspector = typeof AFRAME !== 'undefined' ? AFRAME.INSPECTOR : null;
  const bodyLabel = bodyTooltip(inspector ? inspector.camera : null);

  return (
    <div className={styles.compass}>
      {hovered && <div className={styles.tooltip}>{tooltip}</div>}
      <svg viewBox="0 0 64 64">
        {/* Body hit region — full dial circle, drawn FIRST so the arrow
            sectors (drawn later) win the hit-test where they overlap. */}
        <circle
          {...regionProps('body')}
          cx={CX}
          cy={CY}
          r={DIAL_R}
          fill="#2b2b2b"
          aria-label={bodyLabel}
        />
        {/* Dial face decoration (non-interactive). */}
        <circle
          cx={CX}
          cy={CY}
          r={DIAL_R}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
          pointerEvents="none"
        />
        {/* Needle group — rotated via the ref'd transform each frame.
            transform-box/origin keep rotation about the dial centre. The
            rotation is applied imperatively by the rAF loop; we deliberately
            omit `transform` from this style object so React does not reconcile
            it back to 0deg on a hover/tooltip re-render (which would flick the
            needle to north for one frame). */}
        <g
          ref={needleRef}
          pointerEvents="none"
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center'
          }}
        >
          {/* North half — red, points up at angle 0. */}
          <polygon
            points={`${CX},${CY - 16} ${CX - 5},${CY} ${CX + 5},${CY}`}
            fill="#e8413a"
          />
          {/* South half — muted grey. */}
          <polygon
            points={`${CX},${CY + 16} ${CX - 5},${CY} ${CX + 5},${CY}`}
            fill="#9aa0a6"
          />
        </g>
        {/* Left rotation arrow (CCW) — annular sector hit region + chevron. */}
        <path
          {...regionProps('left')}
          d={LEFT_SECTOR}
          fill="transparent"
          aria-label="Rotate left 90 degrees"
        />
        <path
          d={chevron(LEFT_CENTRE)}
          fill="none"
          stroke="#c8ccd0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
        {/* Right rotation arrow (CW). */}
        <path
          {...regionProps('right')}
          d={RIGHT_SECTOR}
          fill="transparent"
          aria-label="Rotate right 90 degrees"
        />
        <path
          d={chevron(RIGHT_CENTRE)}
          fill="none"
          stroke="#c8ccd0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
};
