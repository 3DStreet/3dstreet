/**
 * `#invite=<invitationId>` deep link (#1267 Phase 1): the link in an
 * organization invitation email (public/functions/email/templates.js
 * orgInvitation). Opens the InvitationModal instead of loading a scene.
 * Matched on the exact route so it never shadows other hash routes.
 */

// Firestore auto ids: 20 alphanumerics; allow a little slack.
const INVITE_HASH_RE = /^#invite=([A-Za-z0-9_-]{1,64})(?:$|[?&/])/;

/**
 * @param {string} hash window.location.hash (with the leading `#`)
 * @returns {boolean}
 */
function isInviteHash(hash) {
  return INVITE_HASH_RE.test(hash || '');
}

/**
 * The invitation id from an `#invite=` hash, or '' when it isn't one.
 * @param {string} hash
 * @returns {string}
 */
function getInviteId(hash) {
  const match = (hash || '').match(INVITE_HASH_RE);
  return match ? match[1] : '';
}

export { isInviteHash, getInviteId };
