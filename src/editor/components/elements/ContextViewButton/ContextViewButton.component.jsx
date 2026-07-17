/* global AFRAME */

// TASK-025 — Context view button (single, actions-only).
//
// An always-visible toolbar button (in experimental-nav mode), sitting just
// RIGHT of the compass and the same size as it (64×64, circular). The icon
// shows the one sensible "change my framing" MOVE for where the camera is — the
// destination it will take you to:
//   - drone     (rise to an aerial survey, when at street level)
//   - street    (swoop down to the surface, when elevated)
//   - daylight  (sunshine — pop out to open sky, when enclosed)
// Greys/disabled when there is no valid target or a tween is in flight.
//
// (v2 briefly tried a two-slot state+action control; reverted per live-test —
// the actions-only single button reads better. The icon-as-destination
// convention matches the compass tooltip / Google Maps style.)
//
// Per-frame poll of the controls' `resolveContextAction()` → { kind, enabled,
// busy } — a pure read of the per-tick context snapshot (zero raycast per
// frame); the resolver is the single authority on busy/enabled. Click and the
// Space key both funnel through the controls' `triggerContextAction()`, which
// owns the busy/no-op gate. On click the button blurs itself so a mouse click
// does not leave it focused and hijack the next Space (R2-REV-F).
//
// Icons are SVG documents imported as data-URIs (webpack `asset/inline` rule)
// and rendered as <img>, the AddLayerPanel pattern. Mount-gated by
// isExperimentalNav() in Main.jsx.

import { useEffect, useState } from 'react';
import daylightIcon from '../../../../../ui_assets/context-daylight.svg';
import streetIcon from '../../../../../ui_assets/context-street.svg';
import droneIcon from '../../../../../ui_assets/context-drone.svg';
import styles from './ContextViewButton.module.scss';

// Icon keyed by the resolver's `kind` (the move available = the destination).
const ICONS = {
  daylight: daylightIcon,
  street: streetIcon,
  drone: droneIcon
};

// Tooltip + aria-label, mapped from `kind`. The enclosed state's label names the
// ACTION ("Out to open sky"), NOT the icon's "daylight" metaphor (spec D-C).
const TOOLTIP = {
  daylight: 'Out to open sky',
  street: 'Street view',
  drone: 'Drone view'
};

const controls = () =>
  typeof AFRAME !== 'undefined' && AFRAME.INSPECTOR
    ? AFRAME.INSPECTOR.controls
    : null;

export const ContextViewButton = () => {
  // Resolved destination kind + whether the action has a valid target. `busy` is
  // folded into `enabled` for rendering (a busy frame greys the button, holding
  // the last icon — spec D-C allows the two greys to read alike for the
  // prototype). Seed 'none'/disabled: nothing renders until the resolver has
  // actually run (the RAF loop no-ops while AFRAME.INSPECTOR.controls is not
  // wired yet, e.g. during scene load).
  const [kind, setKind] = useState('none');
  const [enabled, setEnabled] = useState(false);
  const [tooltip, setTooltip] = useState(false);

  // Poll the resolver each frame, committing to React state only on change
  // (prev-equality guards avoid needless re-renders). A pure read of the
  // controls' per-tick snapshot, so per-frame polling is cheap. No component
  // debounce — the elevation hysteresis and the collision-floor cache already
  // damp any chatter.
  useEffect(() => {
    let raf;
    const loop = () => {
      const c = controls();
      if (c && typeof c.resolveContextAction === 'function') {
        const { kind: k, enabled: e, busy } = c.resolveContextAction();
        setKind((prev) => (prev === k ? prev : k));
        const nextEnabled = e && !busy;
        setEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Street-level mode off (the default tier): the resolver always returns
  // kind 'none' — hide the button entirely. (The dock also only mounts with
  // the flag on; this guard additionally covers the pre-resolver seed.)
  if (!ICONS[kind]) return null;

  const label = TOOLTIP[kind];

  const onClick = (event) => {
    const c = controls();
    if (c && typeof c.triggerContextAction === 'function') {
      c.triggerContextAction();
    }
    // R2-REV-F: blur AFTER dispatch (in onClick, not pointerdown) so a mouse
    // click does not leave the button focused and hijack the next Space.
    if (event && event.currentTarget && event.currentTarget.blur) {
      event.currentTarget.blur();
    }
  };

  return (
    <div className={styles.contextControl}>
      {tooltip && <div className={styles.tooltip}>{label}</div>}
      <button
        type="button"
        className={
          enabled ? styles.button : `${styles.button} ${styles.disabled}`
        }
        onClick={onClick}
        disabled={!enabled}
        aria-label={label}
        title={label}
        onPointerOver={() => setTooltip(true)}
        onPointerLeave={() => setTooltip(false)}
        onFocus={() => setTooltip(true)}
        onBlur={() => setTooltip(false)}
      >
        <img
          className={styles.icon}
          src={ICONS[kind]}
          alt=""
          aria-hidden="true"
        />
      </button>
    </div>
  );
};
