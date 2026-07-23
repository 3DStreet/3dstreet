// Street-editing telemetry for segment-level edits (issue #1873).
//
// Milestone #5 (Street Editing) is the core Pro workflow, but until now the
// only street-ish PostHog events were `street_positioned` (high-volume
// auto-fire on layout) and `streetmix_import_completed`. There was a blind
// spot on the actual segment edits users make: changing a segment type,
// adding, removing, duplicating, or changing a boundary's variant.
//
// Following the one-event-many-properties pattern of `nav_control_used`
// (navAnalytics.js) and `transform_mode_changed`, all of these fire a single
// event name — `street_segment_changed` — carrying an `op` property. Unlike
// navAnalytics we do NOT session-dedupe: raw events give both volume (edit
// depth) and unique-user reach (PostHog can dedupe to unique users in the
// funnel query), which is strictly more signal for an activation waterfall.

import posthog from 'posthog-js';

// Stable list of the segment-edit operations we track. Kept here so the
// funnel-builder and the call sites share one source of truth.
export const SEGMENT_OPS = {
  TYPE_CHANGED: 'type_changed',
  ADDED: 'added',
  REMOVED: 'removed',
  DUPLICATED: 'duplicated',
  VARIANT_CHANGED: 'variant_changed'
};

/**
 * Capture a segment-level street edit.
 *
 * @param {string} op One of SEGMENT_OPS (type_changed | added | removed |
 *   duplicated | variant_changed).
 * @param {object} [extra] Optional context merged into the event, e.g.
 *   `{ segment_type }` or `{ variant }`.
 */
export function captureSegmentEdit(op, extra) {
  posthog.capture('street_segment_changed', {
    op,
    scene_id: window.STREET?.utils?.getCurrentSceneId?.(),
    ...extra
  });
}
