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
// Interior rotation arrows (curved, Google-Maps style). The hit regions are
// annular sectors INSIDE the dial; the visible curved arc + arrowhead sit
// within them. Right arrow rotates clockwise, left counter-clockwise.
const ARROW_SECTOR_INNER_R = 7; // hit-region inner radius
const ARROW_SECTOR_OUTER_R = 21; // hit-region outer radius (just inside the dial)
const ARROW_HALF_SPAN = 30; // 60deg sector — ~2-4 o'clock / 8-10 o'clock
const ARC_R = 18; // radius of the visible curved arrow (near the rim, so the
// needle's tip (16px) doesn't reach the arrow stems)
const ARC_HALF_SPAN = 22; // visible arc a touch shorter than the sector
const ARROWHEAD_BASE = 8; // arrowhead base width (px); drawn as an equilateral triangle

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

// Open arc path between two screen angles at radius `r`.
// sweep: 1 = clockwise (increasing angle), 0 = counter-clockwise.
function arc(a1, a2, r, sweep) {
  const [x1, y1] = polar(a1, r);
  const [x2, y2] = polar(a2, r);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
}

// Equilateral triangle arrowhead at the leading end of an arc. `dir` = +1 for
// a clockwise arc (tip points to increasing angle), -1 for counter-clockwise.
// Computed in pixel space (not degrees) so the height stays proportional to
// the base regardless of ARC_R: base spans the radial direction, the tip
// extends along the tangent by the equilateral height (base * √3/2).
function arrowHead(endDeg, dir) {
  const rad = (endDeg * Math.PI) / 180;
  const [px, py] = polar(endDeg, ARC_R); // base midpoint, on the arc
  const tx = Math.cos(rad) * dir; // unit tangent in the motion direction
  const ty = Math.sin(rad) * dir;
  const nx = Math.sin(rad); // unit outward radial
  const ny = -Math.cos(rad);
  const half = ARROWHEAD_BASE / 2;
  const h = ARROWHEAD_BASE * 0.866; // equilateral height
  const tip = `${px + tx * h},${py + ty * h}`;
  const b1 = `${px + nx * half},${py + ny * half}`;
  const b2 = `${px - nx * half},${py - ny * half}`;
  return `${tip} ${b1} ${b2}`;
}

const RIGHT_CENTRE = 90; // 3 o'clock
const LEFT_CENTRE = 270; // 9 o'clock

// Hit regions — 60deg annular sectors inside the dial.
const RIGHT_SECTOR = annularSector(
  RIGHT_CENTRE - ARROW_HALF_SPAN,
  RIGHT_CENTRE + ARROW_HALF_SPAN,
  ARROW_SECTOR_INNER_R,
  ARROW_SECTOR_OUTER_R
);
const LEFT_SECTOR = annularSector(
  LEFT_CENTRE - ARROW_HALF_SPAN,
  LEFT_CENTRE + ARROW_HALF_SPAN,
  ARROW_SECTOR_INNER_R,
  ARROW_SECTOR_OUTER_R
);

// Visible curved arrows. The right arc sweeps clockwise (2 -> 4 o'clock) and
// the left arc counter-clockwise (10 -> 8 o'clock); each ends in an arrowhead
// at its leading edge, so the pair reads as CW (right) / CCW (left).
const RIGHT_ARC = arc(
  RIGHT_CENTRE - ARC_HALF_SPAN,
  RIGHT_CENTRE + ARC_HALF_SPAN,
  ARC_R,
  1
);
const RIGHT_HEAD = arrowHead(RIGHT_CENTRE + ARC_HALF_SPAN, +1);
const LEFT_ARC = arc(
  LEFT_CENTRE + ARC_HALF_SPAN,
  LEFT_CENTRE - ARC_HALF_SPAN,
  ARC_R,
  0
);
const LEFT_HEAD = arrowHead(LEFT_CENTRE - ARC_HALF_SPAN, -1);

const controls = () =>
  typeof AFRAME !== 'undefined' && AFRAME.INSPECTOR
    ? AFRAME.INSPECTOR.controls
    : null;

// Pose-aware body tooltip, computed from the same tests as the dispatcher.
// Returns null when a body click would be a no-op (already top-down AND
// north-up) — in that state there is nothing to do, so we show no caption.
function bodyTooltip(camera) {
  if (!camera || camera.type !== 'PerspectiveCamera') return 'Plan view';
  const isTopDown =
    90 - cameraTiltDegrees(camera) <= COMPASS_TOPDOWN_TOLERANCE_DEGREES;
  if (!isTopDown) return 'Plan view';
  const isNorthUp =
    Math.abs(needleScreenAngle(camera)) <= COMPASS_NORTH_TOLERANCE_DEGREES;
  if (!isNorthUp) return 'Face north';
  return null; // already reset — clicking does nothing, so no caption
}

export const Compass = () => {
  const needleRef = useRef(null);
  // The region currently hovered or keyboard-focused: 'body' | 'left' |
  // 'right' | null. Drives the tooltip + the hover visuals.
  const [active, setActive] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  // Mirror `active` into a ref so the rAF loop (empty-deps effect) can read
  // the live region without re-subscribing each frame. Updated SYNCHRONOUSLY
  // in enter/leave (not via a post-render effect): otherwise the ref lags the
  // state by a render, and the rAF loop — seeing a stale 'body' — overwrites
  // the just-set arrow tooltip with bodyTooltip() ("Plan view"), so the arrow
  // highlights but the caption stays wrong.
  const activeRef = useRef(null);

  const staticTooltip = (region) => {
    if (region === 'left') return 'Rotate left 90°';
    if (region === 'right') return 'Rotate right 90°';
    const inspector = typeof AFRAME !== 'undefined' ? AFRAME.INSPECTOR : null;
    return bodyTooltip(inspector ? inspector.camera : null);
  };

  // rAF needle loop. Reads the live inspector camera each frame and writes
  // the needle angle directly to the ref'd SVG transform. Holds the last
  // angle when the camera is unavailable or briefly orthographic (plan-view
  // toggle window). Cancelled on unmount. Also recomputes the pose-aware body
  // tooltip each frame while the body is active, committing to state only on
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
      if (activeRef.current === 'body') {
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

  // Mark a region active (hover or focus). `pointerover` / `focus` fire on
  // every change of the topmost target, so moving between the body and the
  // arrow sectors (which overlap the body) updates `active` reliably — unlike
  // pointerenter/leave on overlapping siblings, which left the body's stale
  // state showing through (the "Plan view over the arrows" bug).
  const enter = (region) => {
    activeRef.current = region; // sync, before any rAF tick can read it
    setActive(region);
    setTooltip(staticTooltip(region));
  };
  const leave = () => {
    activeRef.current = null;
    setActive(null);
    setTooltip(null);
  };

  const keyActivate = (region) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dispatch(region);
    }
  };

  // Event/role props shared by all three hit regions.
  const handlers = (region) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => dispatch(region),
    onKeyDown: keyActivate(region),
    onPointerOver: () => enter(region),
    onFocus: () => enter(region),
    onBlur: leave
  });

  // Curved-arrow glyph colour — brightens to white when its region is active.
  const arrowStroke = (region) => (active === region ? '#fff' : '#c8ccd0');
  // ...and gains a soft white halo when active.
  const arrowGlow = (region) => ({
    filter:
      active === region
        ? 'drop-shadow(0 0 2px rgba(255,255,255,0.85))'
        : 'none'
  });

  // Pose-aware label for the body hit region's aria-label, computed from the
  // live camera the same way as the visible tooltip so screen-reader users
  // hear the action the click will actually perform.
  const inspector = typeof AFRAME !== 'undefined' ? AFRAME.INSPECTOR : null;
  const bodyLabel = bodyTooltip(inspector ? inspector.camera : null) || 'Compass';

  return (
    <div className={styles.compass} onPointerLeave={leave}>
      {active && tooltip && <div className={styles.tooltip}>{tooltip}</div>}
      <svg viewBox="0 0 64 64">
        <defs>
          {/* Diffuse white glow shown behind the needle on body hover
              (Google-Maps style) — replaces the old full-dial outline ring. */}
          <radialGradient id="compassBodyGlow">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0.16)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        {/* Body hit region — full dial circle, drawn FIRST so the interior
            arrow sectors (drawn later) win the hit-test where they overlap.
            Covers the whole dial, so there are no dead zones inside the
            widget. */}
        <circle
          {...handlers('body')}
          className={styles.hitRegion}
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
        {/* Interior rotation-arrow hit regions — 60deg sectors inside the
            dial, drawn above the body so clicks there route to rotate, not
            reset. Transparent; the visible glyph is the curved arrow below. */}
        <path
          {...handlers('left')}
          className={styles.hitRegion}
          d={LEFT_SECTOR}
          fill="transparent"
          aria-label="Rotate left 90 degrees"
        />
        <path
          {...handlers('right')}
          className={styles.hitRegion}
          d={RIGHT_SECTOR}
          fill="transparent"
          aria-label="Rotate right 90 degrees"
        />
        {/* Visible curved arrows (non-interactive) — left = CCW, right = CW.
            Each side is grouped so the active region gets a soft white halo. */}
        <g pointerEvents="none" style={arrowGlow('left')}>
          <path
            d={LEFT_ARC}
            fill="none"
            stroke={arrowStroke('left')}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polygon points={LEFT_HEAD} fill={arrowStroke('left')} />
        </g>
        <g pointerEvents="none" style={arrowGlow('right')}>
          <path
            d={RIGHT_ARC}
            fill="none"
            stroke={arrowStroke('right')}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polygon points={RIGHT_HEAD} fill={arrowStroke('right')} />
        </g>
        {/* Needle group — rotated via the ref'd transform each frame, drawn
            LAST so it sits visually on top of the arrows. transform-box/origin
            keep rotation about the dial centre. The rotation is applied
            imperatively by the rAF loop; we deliberately omit `transform` from
            this style object so React does not reconcile it back to 0deg on a
            hover/tooltip re-render (which would flick the needle to north for
            one frame). */}
        <g
          ref={needleRef}
          pointerEvents="none"
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center'
          }}
        >
          {/* Body-hover glow — a soft white bloom behind the needle, shown
              only while the body is active. It lives INSIDE the needle group
              so it rotates with the needle: an ellipse with a 2:1 major:minor
              ratio, major axis along the needle (rx across, ry along). Sized
              larger than the needle (half-width 5, half-height 16) so it
              blooms out around the silhouette rather than hiding behind it,
              but more contained than the old full-dial (r=22) circle. */}
          {active === 'body' && (
            <ellipse
              cx={CX}
              cy={CY}
              rx={10}
              ry={20}
              fill="url(#compassBodyGlow)"
            />
          )}
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
      </svg>
    </div>
  );
};
