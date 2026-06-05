/* global AFRAME */

// TASK-025 v2 — Context view control (two-slot: state + action).
//
// An always-visible toolbar control (in experimental-nav mode), sitting just
// RIGHT of the compass, bottom-aligned with it. Two small square slots side by
// side:
//   - STATE slot (left)  — highlighted border, NOT clickable, presentational.
//     Shows the framing you are IN: street/pegman (on the ground), drone (in
//     the air), or the enclosed-pegman glyph (inside a building).
//   - ACTION slot (right) — clickable, hover-highlights. Shows the one sensible
//     "change my framing" move for where the camera is: drone (rise when at
//     street level), street/pegman (swoop down when elevated), or sunshine
//     (pop out to open sky when enclosed). Greys/disabled when there is no
//     valid target or a tween is in flight.
//
// Per-frame poll of the controls: `resolveContextAction()` → { kind, enabled,
// busy } drives the ACTION slot; `resolveContextState()` → state drives the
// STATE slot. Both are pure reads of the controls' per-tick context snapshot
// (zero raycast per frame); the resolver is the single authority on
// busy/enabled. Click and the Space key both funnel through the controls'
// `triggerContextAction()`, which owns the busy/no-op gate. On click the action
// slot blurs itself so a mouse click does not leave it focused and hijack the
// next Space (R2-REV-F).
//
// Icons are 512×512 / small SVG documents imported as data-URIs (webpack
// `asset/inline` rule) and rendered as <img>, the AddLayerPanel pattern — NOT
// inline React SVG like the compass. Mount-gated by isExperimentalNav() in
// Main.jsx.

import { useEffect, useState } from 'react';
import daylightIcon from '../../../../../ui_assets/context-daylight.svg';
import streetIcon from '../../../../../ui_assets/context-street.svg';
import droneIcon from '../../../../../ui_assets/context-drone.svg';
import enclosedIcon from '../../../../../ui_assets/context-enclosed.svg';
import styles from './ContextViewButton.module.scss';

// ACTION-slot icons, keyed by the resolver's `kind` (the move available).
const ACTION_ICONS = {
  daylight: daylightIcon,
  street: streetIcon,
  drone: droneIcon
};

// STATE-slot icons, keyed by the framing you are IN. 'street' reuses the
// pegman; 'aerial' reuses the drone glyph; 'enclosed' is the new pegman-in-a-
// box glyph (the one state that needs its own glyph — the street/drone glyphs
// double as both state and action and never collide in one display).
const STATE_ICONS = {
  street: streetIcon,
  aerial: droneIcon,
  enclosed: enclosedIcon
};

// Action-slot tooltip + aria-label, mapped from `kind`. The enclosed state's
// label names the ACTION ("Out to open sky"), NOT the icon's "daylight"
// metaphor (spec D-C).
const TOOLTIP = {
  daylight: 'Out to open sky',
  street: 'Street view',
  drone: 'Drone view'
};

// State-slot title (decorative — names the current view for a hover/screen-
// reader-via-title cue; the slot is otherwise aria-hidden).
const STATE_TITLE = {
  street: 'Street level',
  aerial: 'Aerial view',
  enclosed: 'Enclosed'
};

const controls = () =>
  typeof AFRAME !== 'undefined' && AFRAME.INSPECTOR
    ? AFRAME.INSPECTOR.controls
    : null;

export const ContextViewButton = () => {
  // ACTION: resolved destination kind + whether the action has a valid target.
  // `busy` is folded into `enabled` for rendering (a busy frame greys the
  // action slot, holding the last icon — the disabled look; spec D-C allows the
  // two greys to read alike for the prototype).
  const [kind, setKind] = useState('drone');
  const [enabled, setEnabled] = useState(true);
  // STATE: the framing you are in ('street' | 'aerial' | 'enclosed').
  const [state, setState] = useState('street');
  const [tooltip, setTooltip] = useState(false);

  // Poll the resolver + state each frame, committing to React state only on
  // change (prev-equality guards avoid needless re-renders). Both reads are
  // pure reads of the controls' per-tick snapshot, so per-frame polling is
  // cheap. No component-side debounce: the elevation hysteresis (in the
  // snapshot) and the collision-floor cache already damp any chatter.
  useEffect(() => {
    let raf;
    const loop = () => {
      const c = controls();
      if (c && typeof c.resolveContextAction === 'function') {
        const { kind: k, enabled: e, busy } = c.resolveContextAction();
        setKind((prev) => (prev === k ? prev : k));
        const nextEnabled = e && !busy;
        setEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled));
        if (typeof c.resolveContextState === 'function') {
          const st = c.resolveContextState();
          setState((prev) => (prev === st ? prev : st));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const label = TOOLTIP[kind];

  const onClick = (event) => {
    const c = controls();
    if (c && typeof c.triggerContextAction === 'function') {
      c.triggerContextAction();
    }
    // R2-REV-F: blur AFTER dispatch (in onClick, not pointerdown) so a mouse
    // click does not leave the action slot focused and hijack the next Space.
    if (event && event.currentTarget && event.currentTarget.blur) {
      event.currentTarget.blur();
    }
  };

  return (
    <div className={styles.contextControl}>
      {tooltip && <div className={styles.tooltip}>{label}</div>}
      {/* STATE slot — presentational, highlighted, not clickable. */}
      <div
        className={`${styles.slot} ${styles.stateSlot}`}
        title={STATE_TITLE[state]}
        aria-hidden="true"
      >
        <img className={styles.icon} src={STATE_ICONS[state]} alt="" />
      </div>
      {/* ACTION slot — clickable, hover-highlights, greys when disabled/busy. */}
      <button
        type="button"
        className={
          enabled
            ? `${styles.slot} ${styles.actionSlot}`
            : `${styles.slot} ${styles.actionSlot} ${styles.disabled}`
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
          src={ACTION_ICONS[kind]}
          alt=""
          aria-hidden="true"
        />
      </button>
    </div>
  );
};
