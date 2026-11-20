/**
 * Organizations (teams, #1267 Phase 1) — the pure rules, no Firebase.
 * The Firestore side and the callables are in orgs.js; see docs/orgs.md.
 *
 * Roles, from most to least powerful:
 *   owner  — everything, including billing-level changes; an org always keeps
 *            at least one owner
 *   admin  — manages members and invitations, renames the org; can't touch
 *            owners or make owners
 *   member — uses the org's plan (Pro or Max) and, from Phase 2, edits its
 *            scenes
 *   viewer — read-only from Phase 2; takes no seat and gets no plan
 */

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const MANAGER_ROLES = ['owner', 'admin'];
// Roles that take a paid seat and get the org's plan.
const SEAT_ROLES = ['owner', 'admin', 'member'];
const ORG_PLANS = ['PRO', 'MAX'];

const INVITATION_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ORG_NAME_LENGTH = 80;
const MAX_INVITES_PER_CALL = 50;

const isRole = (role) => ROLES.includes(role);
const canManageOrg = (role) => MANAGER_ROLES.includes(role);
const takesSeat = (role) => SEAT_ROLES.includes(role);

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

// Deliberately simple: one @, something on each side, a dot in the domain.
// Delivery is the real test; this only catches typos and pasted junk.
const isPlausibleEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

const emailDomain = (email) => {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  return at > 0 ? normalized.slice(at + 1) : '';
};

const normalizeOrgName = (name) =>
  typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';

const isValidOrgName = (name) => {
  const normalized = normalizeOrgName(name);
  return normalized.length > 0 && normalized.length <= MAX_ORG_NAME_LENGTH;
};

/**
 * Seats taken: members in a seat role plus pending, unexpired invitations
 * for a seat role (an invitation reserves its seat until it expires).
 */
const countSeatsUsed = ({ members = [], invitations = [], nowMs = Date.now() }) =>
  members.filter((m) => takesSeat(m.role)).length +
  invitations.filter(
    (inv) => takesSeat(inv.role) && invitationState(inv, nowMs) === 'pending'
  ).length;

/** Stored status, with an expired pending invitation reported as 'expired'. */
const invitationState = (invitation, nowMs = Date.now()) => {
  if (!invitation) return 'missing';
  if (invitation.status !== 'pending') return invitation.status;
  const expiresAtMs = toMillis(invitation.expiresAt);
  return expiresAtMs !== null && expiresAtMs <= nowMs ? 'expired' : 'pending';
};

const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
};

/**
 * Whether `actorRole` may give `targetRole`'s member the role `newRole`.
 * Returns null when allowed, else a reason. `ownerCount` is the org's owners.
 */
const roleChangeRefusal = ({ actorRole, targetRole, newRole, ownerCount }) => {
  if (!isRole(newRole)) return 'invalid-role';
  if (!canManageOrg(actorRole)) return 'not-manager';
  // Admins manage admins, members and viewers; owners are the owners' call.
  if (actorRole !== 'owner' && (targetRole === 'owner' || newRole === 'owner')) {
    return 'owner-only';
  }
  if (targetRole === 'owner' && newRole !== 'owner' && ownerCount <= 1) {
    return 'last-owner';
  }
  return null;
};

/**
 * Whether `actorUid` (role `actorRole`) may remove `targetUid` (role
 * `targetRole`). Anyone may leave (remove themselves), except the last owner.
 */
const removalRefusal = ({ actorUid, actorRole, targetUid, targetRole, ownerCount }) => {
  // Permission first, so a member removing the only owner hears "not
  // allowed", not "last owner".
  if (actorUid !== targetUid) {
    if (!canManageOrg(actorRole)) return 'not-manager';
    if (targetRole === 'owner' && actorRole !== 'owner') return 'owner-only';
  }
  if (targetRole === 'owner' && ownerCount <= 1) return 'last-owner';
  return null;
};

/** Whether `actorRole` may invite someone as `role`. Null when allowed. */
const inviteRefusal = ({ actorRole, role }) => {
  if (!isRole(role)) return 'invalid-role';
  if (!canManageOrg(actorRole)) return 'not-manager';
  if (role === 'owner' && actorRole !== 'owner') return 'owner-only';
  return null;
};

/**
 * The plan a user gets from their orgs: the best plan among active orgs
 * where they hold a seat role ('MAX' > 'PRO'), or null. `memberships` is a
 * list of { role, org: { plan, status } }.
 */
const planFromMemberships = (memberships = []) => {
  let best = null;
  for (const { role, org } of memberships) {
    if (!org || org.status !== 'active' || !takesSeat(role)) continue;
    if (org.plan === 'MAX') return 'MAX';
    if (org.plan === 'PRO') best = 'PRO';
  }
  return best;
};

/** The higher of two plans ('MAX' > 'PRO' > anything else / null). */
const higherPlan = (a, b) => {
  if (a === 'MAX' || b === 'MAX') return 'MAX';
  if (a === 'PRO' || b === 'PRO') return 'PRO';
  return a || b || null;
};

const invitationExpiry = (nowMs = Date.now()) => nowMs + INVITATION_TTL_DAYS * DAY_MS;

module.exports = {
  ROLES,
  MANAGER_ROLES,
  SEAT_ROLES,
  ORG_PLANS,
  INVITATION_TTL_DAYS,
  MAX_ORG_NAME_LENGTH,
  MAX_INVITES_PER_CALL,
  isRole,
  canManageOrg,
  takesSeat,
  normalizeEmail,
  isPlausibleEmail,
  emailDomain,
  normalizeOrgName,
  isValidOrgName,
  countSeatsUsed,
  invitationState,
  roleChangeRefusal,
  removalRefusal,
  inviteRefusal,
  planFromMemberships,
  higherPlan,
  invitationExpiry
};
