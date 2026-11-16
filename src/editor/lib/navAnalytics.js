// Feature-discovery telemetry for the editor navigation controls.
//
// Issue #1675 (ship v1 navigation): instrument the assumed happy path for
// navigation feature discovery — pan, zoom, rotate, select, focus, reset
// view, orient-to-north — so we can build a PostHog "waterfall" funnel of how
// many users reach each step, and later correlate those steps with retention
// and conversion.
//
// One event name, `nav_control_used`, carrying a `control` property, fired at
// most ONCE per control per browser-tab session (deduped via sessionStorage,
// with an in-memory fallback). This keeps volume low and makes each PostHog
// funnel step a clean per-user first-touch: step N = `nav_control_used` where
// `control = X`. See `src/editor/lib/nav-experimental/index.js` for the
// controls that emit these.
//
// A second, non-deduplicated event, `nav_rotate_gesture`, fires once per
// rotate drag (#1993 selection rotation pivot) with `pivot_source` (selection
// | fallback_none | fallback_hidden | fallback_offscreen | street_inplace),
// `selected_type`, `drag_ms`, `yaw_deg` and `pitch_deg`, so the selection
// pivot's effect can be measured. Emitted from dragGestureController.

import posthog from 'posthog-js';
import { getNavScheme } from './nav-experimental/flag.js';

// Stable list of the controls we track. Kept here so the funnel-builder
// script and the call sites share one source of truth.
export const NAV_CONTROLS = [
  'pan',
  'zoom',
  'rotate',
  'select',
  'focus',
  'reset_view',
  'orient_north',
  'compass_rotate'
];

const STORAGE_PREFIX = 'navDiscovery:';
// In-memory backstop for environments where sessionStorage throws (private
// mode, sandboxed iframes). Also short-circuits the storage round-trip after
// the first capture in this JS context.
const fired = new Set();

function alreadyFired(control) {
  if (fired.has(control)) return true;
  try {
    if (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(STORAGE_PREFIX + control)
    ) {
      fired.add(control);
      return true;
    }
  } catch (e) {
    // sessionStorage unavailable — rely on the in-memory Set only.
  }
  return false;
}

function markFired(control) {
  fired.add(control);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_PREFIX + control, '1');
    }
  } catch (e) {
    // ignore — in-memory Set still dedupes within this page load.
  }
}

/**
 * Capture the first use of a navigation control this session.
 *
 * @param {string} control One of NAV_CONTROLS.
 * @param {object} [extra] Optional extra properties merged into the event.
 */
export function captureNavDiscovery(control, extra) {
  if (alreadyFired(control)) return;
  markFired(control);
  posthog.capture('nav_control_used', {
    // The active control scheme: 'standard' or 'experimental'. Before #1956
    // this was 'classic' (retired legacy controls) or 'experimental' (which
    // then covered BOTH remaining schemes) — segment on it accordingly for
    // events older than the legacy-nav removal.
    nav_mode: getNavScheme(),
    control,
    ...extra
  });
}

/**
 * Report one finished rotate drag (#1993). NOT deduplicated: one event per
 * rotate sub-gesture that actually moved the camera, so the selection pivot's
 * effect can be measured after launch. Fired at drag end, never per move.
 *
 * @param {object} props pivot_source, selected_type, drag_ms, yaw_deg,
 *   pitch_deg (see dragGestureController `flushRotateGesture`).
 */
export function captureRotateGesture(props) {
  posthog.capture('nav_rotate_gesture', {
    nav_mode: getNavScheme(),
    ...props
  });
}
