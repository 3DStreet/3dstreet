/**
 * `#project-pass` deep link (#1922): opens the one-time Project Pass checkout
 * (ProjectPassModal) instead of loading a scene. An optional channel tag
 * rides along for attribution — `#project-pass?src=winback` or
 * `#project-pass&src=winback` — and is passed into the Stripe checkout
 * metadata and the checkout analytics events.
 *
 * Matched exactly on the `project-pass` route segment, never by substring
 * against other hash routes (e.g. `#payment`), so neither can shadow the
 * other.
 */

const PROJECT_PASS_HASH_RE = /^#project-pass(?:$|[?&/])/i;

// Attribution tags are short slugs; anything else is dropped rather than
// forwarded into Stripe metadata / analytics.
const SOURCE_RE = /^[a-z0-9_-]{1,40}$/i;

/**
 * @param {string} hash window.location.hash (with the leading `#`)
 * @returns {boolean}
 */
function isProjectPassHash(hash) {
  return PROJECT_PASS_HASH_RE.test(hash || '');
}

/**
 * Channel tag from a `#project-pass` hash, or null when absent/invalid or the
 * hash is not a project-pass link.
 * @param {string} hash
 * @returns {string|null}
 */
function getProjectPassSource(hash) {
  if (!isProjectPassHash(hash)) return null;
  const match = hash.match(/[?&]src=([^&#]*)/i);
  if (!match) return null;
  let value;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return SOURCE_RE.test(value) ? value.toLowerCase() : null;
}

export { isProjectPassHash, getProjectPassSource };
