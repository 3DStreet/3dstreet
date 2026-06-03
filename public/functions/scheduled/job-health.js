/**
 * job-health.js — a tiny heartbeat layer for our scheduled (cron) functions.
 *
 * Why: the only signal that a background job ran used to be Cloud Logging. There
 * was no single place to answer "is everything green?" at a glance. This wraps a
 * scheduled job's work so every run records its outcome to a Firestore doc the
 * admin "System Health" page reads:
 *
 *   jobHealth/{jobName}  →  {
 *     status: 'green' | 'yellow' | 'red',
 *     message, summary, durationMs, error,
 *     schedule, timeZone, expectedIntervalMs,
 *     lastRunAt, lastSuccessAt,
 *     recentRuns: [{ runAt, status, durationMs, message, error }, ...]  // newest first, capped
 *   }
 *
 * Status model:
 *   - red    = the job threw (it broke), OR the page sees lastRunAt go stale
 *              relative to expectedIntervalMs (it isn't running at all).
 *   - yellow = it completed but a degraded count was non-zero (e.g. gaveUp,
 *              errored) — ran, but something needs a look.
 *   - green  = completed cleanly.
 *
 * Writes use the Admin SDK (rules bypassed). The history lives inline on the doc
 * (one read + one write per run, no subcollection, no extra index) so the page
 * loads everything from a single doc.
 */

const admin = require('firebase-admin');

// How many recent runs to keep inline on the doc. Summaries are small (counts),
// so even 20 is well under the 1 MB doc ceiling.
const HISTORY_LIMIT = 20;

/** Resolve a possibly-dotted key path against the summary (e.g. 'notify.errored'). */
function getByPath(obj, path) {
  return path
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Decide green vs yellow from the job's own summary. Red is reserved for a thrown
 * error (handled in the wrapper) and for client-side staleness (handled on the
 * page). `degradedKeys` are summary paths whose value > 0 means "ran with issues".
 */
function deriveStatus(summary, degradedKeys = []) {
  const hits = [];
  for (const key of degradedKeys) {
    const v = getByPath(summary, key);
    if (typeof v === 'number' && v > 0) hits.push(`${key}=${v}`);
  }
  return hits.length
    ? { status: 'yellow', message: `Completed with issues: ${hits.join(', ')}` }
    : { status: 'green', message: 'Completed cleanly' };
}

async function writeHealth(jobName, meta, record) {
  const db = admin.firestore();
  const ref = db.collection('jobHealth').doc(jobName);
  // serverTimestamp() can't live inside an array element, so the inline history
  // uses the function's clock. lastRunAt/lastSuccessAt use the same value for
  // consistency with the newest history entry.
  const now = admin.firestore.Timestamp.now();
  const entry = {
    runAt: now,
    status: record.status,
    durationMs: record.durationMs,
    message: record.message || null,
    error: record.error || null
  };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : {};
    const recentRuns = [entry, ...(prev.recentRuns || [])].slice(
      0,
      HISTORY_LIMIT
    );
    tx.set(
      ref,
      {
        jobName,
        status: record.status,
        message: record.message || null,
        error: record.error || null,
        summary: record.summary ?? null,
        durationMs: record.durationMs,
        schedule: meta.schedule || null,
        timeZone: meta.timeZone || null,
        expectedIntervalMs: meta.expectedIntervalMs || null,
        lastRunAt: now,
        ...(record.status !== 'red' ? { lastSuccessAt: now } : {}),
        recentRuns
      },
      { merge: true }
    );
  });
}

/**
 * Wrap a scheduled job's work fn so every run records a heartbeat + status.
 * Returns an onRun-compatible handler; the wrapped fn still receives `context`
 * and its return value (the job's summary) is passed straight through.
 *
 * @param {string} jobName  stable id == the exported function name
 * @param {object} meta     { schedule, timeZone, expectedIntervalMs, degradedKeys }
 * @param {(context:any)=>Promise<object>} workFn  the original job body
 */
function withJobHealth(jobName, meta, workFn) {
  return async (context) => {
    const startedAt = Date.now();
    try {
      const summary = await workFn(context);
      const { status, message } = deriveStatus(summary, meta.degradedKeys);
      await writeHealth(jobName, meta, {
        status,
        message,
        summary: summary ?? null,
        durationMs: Date.now() - startedAt,
        error: null
      });
      return summary;
    } catch (err) {
      // Record red, then re-throw so existing retry/alerting behavior is intact.
      try {
        await writeHealth(jobName, meta, {
          status: 'red',
          message: `Threw: ${err && err.message ? err.message : String(err)}`,
          summary: null,
          durationMs: Date.now() - startedAt,
          error: String(err && err.stack ? err.stack : err).slice(0, 2000)
        });
      } catch (writeErr) {
        // Never let a health-write failure mask the real error.
        console.error('[job-health] failed to record red status:', writeErr);
      }
      throw err;
    }
  };
}

module.exports = { withJobHealth, writeHealth, deriveStatus };
