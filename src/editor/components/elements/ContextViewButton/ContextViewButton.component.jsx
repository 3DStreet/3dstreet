/* global AFRAME */

// TASK-025 — Context view button (street / daylight / drone).
//
// An always-visible toolbar button (in experimental-nav mode) whose icon and
// action track the camera state. A single control, three faces: it always
// offers the one sensible "change my framing" move for where the camera is —
// daylight (pop out when enclosed), street view (swoop down when elevated), or
// drone view (rise when at street level). The icon shows the DESTINATION
// state, not where you are now (same convention as the compass tooltip).
//
// Simpler than the Compass (no hand-drawn SVG, no rAF needle): a per-frame
// poll of the controls' `resolveContextAction()` for { kind, enabled, busy },
// committing to React state only on change. The resolver is a pure read of the
// controls' per-tick context snapshot (zero raycast per frame), and is the
// single authority on busy/enabled — the button never reaches into the tween
// state itself. Both click and the Space key funnel through the controls'
// `triggerContextAction()`, which owns the busy/no-op gate.
//
// Icons are 512×512 SVG documents imported as data-URIs (webpack `asset/inline`
// rule) and rendered as <img>, the AddLayerPanel pattern — NOT inline React
// SVG like the compass. Mount-gated by isExperimentalNav() in Main.jsx.

import { useEffect, useState } from 'react';
import daylightIcon from '../../../../../ui_assets/context-daylight.svg';
import streetIcon from '../../../../../ui_assets/context-street.svg';
import droneIcon from '../../../../../ui_assets/context-drone.svg';
import styles from './ContextViewButton.module.scss';

const ICONS = {
  daylight: daylightIcon,
  street: streetIcon,
  drone: droneIcon
};

// Pose-aware tooltip + aria-label, mapped from `kind`. The enclosed state's
// label names the ACTION ("Out to open sky"), NOT the icon's "daylight"
// metaphor (spec D-C).
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
  // Resolved destination kind + whether the action has a valid target. Init to
  // the resolver's resting default ('drone' at street level). `busy` is folded
  // into `enabled` for rendering — a busy frame greys the button (holding the
  // last icon), which is exactly the disabled look (spec D-C allows the two
  // greys to read alike for the prototype).
  const [kind, setKind] = useState('drone');
  const [enabled, setEnabled] = useState(true);
  const [tooltip, setTooltip] = useState(false);

  // Poll the resolver each frame, committing to state only on change (prev-
  // equality guards avoid needless re-renders). The resolver is a pure read of
  // the controls' per-tick snapshot, so per-frame polling is cheap. No extra
  // component-side debounce: the elevation hysteresis (in the snapshot) and the
  // collision-floor cache already damp any chatter (round-1 — debounce cut).
  useEffect(() => {
    let raf;
    const loop = () => {
      const c = controls();
      if (c && typeof c.resolveContextAction === 'function') {
        const { kind: k, enabled: e, busy } = c.resolveContextAction();
        // During a tween / inactive window the resolver returns busy:true and
        // holds its last kind, so render greyed with the held icon.
        setKind((prev) => (prev === k ? prev : k));
        const nextEnabled = e && !busy;
        setEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const label = TOOLTIP[kind];

  const onClick = () => {
    const c = controls();
    if (c && typeof c.triggerContextAction === 'function') {
      c.triggerContextAction();
    }
  };

  return (
    <div className={styles.contextButton}>
      {tooltip && <div className={styles.tooltip}>{label}</div>}
      <button
        type="button"
        className={enabled ? styles.btn : `${styles.btn} ${styles.disabled}`}
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
