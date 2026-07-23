// Streetmix-import telemetry (#1874).
//
// `streetmix_import_completed` historically fired only from the manual in-app
// dialog, so it under-reported by ~13x: it missed the URL-fragment auto-import
// (`/#https://streetmix.net/...`) that most Streetmix users actually arrive on,
// and it wasn't wired into the modern managed-street import path at all.
//
// Both loaders — the legacy `streetmix-loader` component (index.js) and
// `managed-street`'s `loadAndParseStreetmixURL` — now report through this one
// helper, tagged with a `source` so we can tell the paths apart:
//   - 'url_fragment' : inbound `/#https://streetmix.net/...` auto-import
//   - 'dialog'       : user pasted a URL into an in-app import dialog
// A companion `streetmix_import_failed` makes the success rate measurable.
//
// Firing is gated on a non-empty `source`: in-app template/preset streets also
// spin up a loader, and they pass no source so they don't inflate the funnel.

import posthog from 'posthog-js';

/**
 * Capture a Streetmix import outcome.
 *
 * @param {string} event 'streetmix_import_completed' | 'streetmix_import_failed'
 * @param {string} source Import source ('url_fragment' | 'dialog'); when empty
 *   the event is suppressed (uninstrumented paths pass '').
 * @param {string} streetmixURL The user-facing Streetmix URL being imported.
 * @param {object} [extra] Optional extra properties (e.g. `{ status }` or
 *   `{ error }` on failure).
 */
export function captureStreetmixImport(event, source, streetmixURL, extra) {
  if (!source) return;
  posthog.capture(event, {
    source,
    streetmix_url: streetmixURL,
    scene_id: window.STREET?.utils?.getCurrentSceneId?.(),
    ...extra
  });
}
