/**
 * Dependency-free rules for the progressive GLB pipeline (#1990), split out of
 * progressive-dispatch.js so the mocha suite (test/core/progressive-rules.test.js)
 * can load them without firebase-functions / @google-cloud/tasks.
 */

/** Job kind on generationJobs; the reconciler and clients key off it. */
const PROGRESSIVE_JOB_KIND = 'glb-progressive';

/** Non-terminal job statuses (same vocabulary as the reconciler). */
const NON_TERMINAL = ['queued', 'running', 'saving'];

/** Firestore collection recording every Needle content item we created. */
const NEEDLE_LEDGER_COLLECTION = 'needleContent';

/**
 * Why an asset doc cannot be sent for progressive processing, or null when it
 * can. Pure, so the callable and any future automatic trigger agree.
 *
 * @param {object|null|undefined} asset
 * @returns {null|'not_found'|'not_mesh'|'deleted'|'no_source'|'private'}
 */
function progressiveRefusalReason(asset) {
  if (!asset) return 'not_found';
  if (asset.type !== 'mesh') return 'not_mesh';
  if (asset.deleted === true) return 'deleted';
  if (!asset.storagePath || typeof asset.storagePath !== 'string') {
    return 'no_source';
  }
  // Needle serves processed files from a public CDN with no auth; a private
  // asset must never be copied there. `visibility` absent means public.
  if (asset.visibility === 'private') return 'private';
  return null;
}

/**
 * The non-terminal progressive job for an asset among its job docs, or null.
 * `jobs` are `{ id, ...data }` rows; used by the callable to dedupe.
 */
function findActiveProgressiveJob(jobs) {
  if (!Array.isArray(jobs)) return null;
  return (
    jobs.find(
      (job) =>
        job &&
        job.kind === PROGRESSIVE_JOB_KIND &&
        NON_TERMINAL.includes(job.status)
    ) || null
  );
}

module.exports = {
  PROGRESSIVE_JOB_KIND,
  NON_TERMINAL,
  NEEDLE_LEDGER_COLLECTION,
  progressiveRefusalReason,
  findActiveProgressiveJob
};
