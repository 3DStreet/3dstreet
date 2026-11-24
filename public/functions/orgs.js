/**
 * Organizations (teams, #1267 Phase 1): members, roles, seats and
 * invitations. Pure rules are in org-utils.js; see docs/orgs.md.
 *
 * Data (Admin SDK writes only; clients read through firestore.rules):
 *   orgs/{orgId}                 { name, plan, seats, status, domains[],
 *                                  memberEditScope (all|own),
 *                                  domainJoinRole (member|viewer),
 *                                  createdAt, createdBy, updatedAt }
 *   orgs/{orgId}/members/{uid}   { uid, email, displayName, role, joinedAt,
 *                                  invitedBy, via: invitation|domain|staff }
 *   orgInvitations/{id}          { orgId, orgName, email, role, status,
 *                                  invitedBy, inviterName, createdAt,
 *                                  expiresAt, lastSentAt, sendCount, ... }
 *   orgs/{orgId}/departed/{uid}  { uid, removedBy, at }: left or removed
 *   userOrgs/{uid}               { orgs: { [orgId]: role }, activeOrgId }
 *                                  — the user's orgs in one read
 *                                  (entitlement, UI) and their active team
 *
 * Every write that changes membership also updates userOrgs, in the same
 * transaction.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('./app-check.js');
const { sendPostmarkEmail } = require('./email/postmark.js');
const { resolveEmailLocale } = require('./email/locale.js');
const EMAIL_TEMPLATES = require('./email/templates.js');
const { appBaseForProject } = require('./pass-code-utils.js');
const {
  ORG_PLANS,
  MEMBER_EDIT_SCOPES,
  DOMAIN_JOIN_ROLES,
  MAX_INVITES_PER_CALL,
  takesSeat,
  memberEditScopeOf,
  domainJoinRoleOf,
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
  invitationExpiry
} = require('./org-utils.js');
const { defaultMonthlyBudget } = require('./wallet-utils.js');

const db = () => admin.firestore();
const orgRef = (orgId) => db().collection('orgs').doc(orgId);
const memberRef = (orgId, uid) => orgRef(orgId).collection('members').doc(uid);
const departedRef = (orgId, uid) => orgRef(orgId).collection('departed').doc(uid);
const invitationRef = (id) => db().collection('orgInvitations').doc(id);
const userOrgsRef = (uid) => db().collection('userOrgs').doc(uid);

/** A refusal with a machine-readable reason (mapped to HttpsError below). */
class OrgError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const REASON_TO_HTTPS = {
  'invalid-argument': ['invalid-argument', 'Invalid request.'],
  'invalid-name': ['invalid-argument', 'Invalid organization name.'],
  'invalid-plan': ['invalid-argument', 'Invalid plan.'],
  'invalid-seats': ['invalid-argument', 'Invalid number of seats.'],
  'invalid-role': ['invalid-argument', 'Invalid role.'],
  'invalid-email': ['invalid-argument', 'Invalid email address.'],
  'invalid-setting': ['invalid-argument', 'Invalid team setting.'],
  'too-many': ['invalid-argument', 'Too many invitations at once.'],
  'org-not-found': ['not-found', 'Organization not found.'],
  'not-member': ['permission-denied', 'You are not a member of this organization.'],
  'not-manager': ['permission-denied', 'Only owners and admins can do this.'],
  'owner-only': ['permission-denied', 'Only owners can do this.'],
  'last-owner': ['failed-precondition', 'An organization needs at least one owner.'],
  'no-seat-left': ['resource-exhausted', 'No seat left in this organization.'],
  'org-suspended': ['failed-precondition', 'This organization is suspended.'],
  'invitation-not-found': ['not-found', 'Invitation not found.'],
  'invitation-expired': ['failed-precondition', 'This invitation has expired.'],
  'invitation-closed': ['failed-precondition', 'This invitation is no longer valid.'],
  'wrong-account': ['permission-denied', 'This invitation was sent to another email address.'],
  'email-not-verified': ['permission-denied', 'Your email address is not verified.'],
  'member-not-found': ['not-found', 'Member not found.'],
  // Team scenes and projects (team-scenes.js)
  'not-editor': ['permission-denied', 'Only owners, admins and members can do this.'],
  'own-only': ['permission-denied', 'In this team, members can only change what they created.'],
  'not-author': ['permission-denied', 'Only the author of a personal scene can move it.'],
  'scene-not-found': ['not-found', 'Scene not found.'],
  'project-not-found': ['not-found', 'Project not found.'],
  'invalid-move': ['failed-precondition', 'A team scene can only move between projects of its team.'],
  // Team asset library (team-assets.js)
  'asset-not-found': ['not-found', 'Asset not found.'],
  'asset-type-mismatch': ['failed-precondition', 'The new file must be the same kind of asset.'],
  'asset-converting': ['failed-precondition', 'This splat is still being optimized. Try again when it is done.'],
  'team-storage-full': ['resource-exhausted', "The team library's storage is full."]
};

const toHttpsError = (error) => {
  if (error instanceof OrgError) {
    const [code, message] = REASON_TO_HTTPS[error.reason] || ['internal', error.reason];
    // `reason` lets the client pick localized copy without parsing messages.
    return new functions.https.HttpsError(code, message, { reason: error.reason });
  }
  console.error('orgs: unexpected error', error);
  return new functions.https.HttpsError('internal', 'Something went wrong.');
};

/**
 * The userOrgs update for `uid` getting `role` in `orgId` (null = leaving).
 * `current` is their userOrgs data as read in the transaction. Also keeps
 * their active team (the team switcher, team-wallet.js) consistent: joining
 * a first team makes it active, unless they have picked a workspace (an
 * `activeOrgId` key, null = they picked Personal); after that only they
 * switch. Leaving the active team goes back to Personal. A role change keeps
 * it (a viewer's team pays nothing anyway).
 */
const userOrgsPatch = (orgId, role, current = {}) => {
  const patch = {
    orgs: { [orgId]: role === null ? FieldValue.delete() : role },
    updatedAt: FieldValue.serverTimestamp()
  };
  const isFirstTeam = Object.keys(current.orgs || {}).length === 0;
  if (role !== null && isFirstTeam && !('activeOrgId' in current)) patch.activeOrgId = orgId;
  // Deleted, not null: the user didn't pick Personal, so a later first team
  // can become active again.
  if (role === null && current.activeOrgId === orgId) patch.activeOrgId = FieldValue.delete();
  return patch;
};

const readUserOrgsData = async (tx, uid) => {
  const snapshot = await tx.get(userOrgsRef(uid));
  return snapshot.exists ? snapshot.data() : {};
};

/** The members and live invitations of an org, read in a transaction. */
const readSeatState = async (tx, orgId) => {
  const [members, invitations] = await Promise.all([
    tx.get(orgRef(orgId).collection('members')),
    tx.get(
      db()
        .collection('orgInvitations')
        .where('orgId', '==', orgId)
        .where('status', '==', 'pending')
    )
  ]);
  return {
    members: members.docs.map((d) => d.data()),
    invitations: invitations.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
};

const ownerCount = (members) => members.filter((m) => m.role === 'owner').length;

const requireOrg = (snapshot) => {
  if (!snapshot.exists) throw new OrgError('org-not-found');
  return snapshot.data();
};

const requireActorRole = (snapshot) => {
  if (!snapshot.exists) throw new OrgError('not-member');
  return snapshot.data().role;
};

/** Name and email for a member doc, from Auth. */
const describeUser = async (uid) => {
  const user = await getAuth().getUser(uid);
  return {
    email: normalizeEmail(user.email),
    displayName: user.displayName || null,
    emailVerified: !!user.emailVerified
  };
};

// ---------------------------------------------------------------------------
// Staff: create and update orgs (Phase 1 orgs are set up by hand)
// ---------------------------------------------------------------------------

const validateOrgFields = ({ name, plan, seats, domains, status }) => {
  if (name !== undefined && !isValidOrgName(name)) throw new OrgError('invalid-name');
  if (plan !== undefined && !ORG_PLANS.includes(plan)) throw new OrgError('invalid-plan');
  if (seats !== undefined && !(Number.isInteger(seats) && seats >= 1 && seats <= 10000)) {
    throw new OrgError('invalid-seats');
  }
  if (domains !== undefined && !(Array.isArray(domains) && domains.every((d) => typeof d === 'string'))) {
    throw new OrgError('invalid-argument');
  }
  if (status !== undefined && !['active', 'suspended'].includes(status)) {
    throw new OrgError('invalid-argument');
  }
};

const normalizeDomains = (domains = []) => [
  ...new Set(domains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))
];

/**
 * Create an org. Its first owner is added right away when `ownerEmail`
 * already has an account, otherwise invited by email.
 */
async function createOrg({ name, plan, seats, domains = [], ownerEmail, actorUid }) {
  validateOrgFields({ name, plan, seats, domains });
  const email = normalizeEmail(ownerEmail);
  if (!isPlausibleEmail(email)) throw new OrgError('invalid-email');

  const ref = db().collection('orgs').doc();
  // The team's AI token wallet (#1267 Phase 3, team-wallet.js); staff can
  // change the budget with orgUpdateWallet.
  await db()
    .collection('orgWallets')
    .doc(ref.id)
    .set({
      genToken: 0,
      monthlyTokenBudget: defaultMonthlyBudget(plan, seats),
      memberMonthlyCap: null,
      lastRefill: null,
      updatedAt: FieldValue.serverTimestamp()
    });
  await ref.set({
    name: normalizeOrgName(name),
    plan,
    seats,
    status: 'active',
    domains: normalizeDomains(domains),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid || null,
    updatedAt: FieldValue.serverTimestamp()
  });

  const owner = await getAuth()
    .getUserByEmail(email)
    .catch(() => null);
  if (owner) {
    await addMember({ orgId: ref.id, uid: owner.uid, role: 'owner', via: 'staff', invitedBy: actorUid });
    return { orgId: ref.id, owner: 'added' };
  }
  const [result] = await createInvitations({
    orgId: ref.id,
    actorUid: actorUid || null,
    inviterName: '3DStreet',
    invites: [{ email, role: 'owner' }],
    skipActorCheck: true
  });
  return { orgId: ref.id, owner: 'invited', invitation: result };
}

/** Staff update: name, plan, seats, status, domains. */
async function updateOrg({ orgId, patch = {} }) {
  const allowed = ['name', 'plan', 'seats', 'status', 'domains'];
  const fields = Object.fromEntries(
    Object.entries(patch).filter(([key]) => allowed.includes(key))
  );
  validateOrgFields(fields);
  if (fields.name !== undefined) fields.name = normalizeOrgName(fields.name);
  if (fields.domains !== undefined) fields.domains = normalizeDomains(fields.domains);
  requireOrg(await orgRef(orgId).get());
  await orgRef(orgId).update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
  return { orgId, ...fields };
}

/**
 * Add a member directly (staff, domain auto-join). Idempotent. A domain join
 * never re-adds someone who left or was removed.
 */
async function addMember({ orgId, uid, role, via, invitedBy = null }) {
  const who = await describeUser(uid);
  await db().runTransaction(async (tx) => {
    const org = requireOrg(await tx.get(orgRef(orgId)));
    const existing = await tx.get(memberRef(orgId, uid));
    if (existing.exists) return;
    if (via === 'domain' && (await tx.get(departedRef(orgId, uid))).exists) {
      throw new OrgError('departed');
    }
    const current = await readUserOrgsData(tx, uid);
    if (takesSeat(role)) {
      const state = await readSeatState(tx, orgId);
      if (countSeatsUsed(state) >= org.seats) throw new OrgError('no-seat-left');
    }
    tx.set(memberRef(orgId, uid), {
      uid,
      email: who.email,
      displayName: who.displayName,
      role,
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy,
      via
    });
    tx.set(userOrgsRef(uid), userOrgsPatch(orgId, role, current), { merge: true });
    tx.delete(departedRef(orgId, uid));
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------


/**
 * Email an invitation. The invitee's language when they have an account,
 * else the inviter's. Best-effort: returns whether it was sent.
 */
async function sendInvitationEmail(id, invitation) {
  try {
    const invitee = await getAuth()
      .getUserByEmail(invitation.email)
      .catch(() => null);
    const localeUid = invitee ? invitee.uid : invitation.invitedBy;
    const locale = localeUid ? await resolveEmailLocale(db(), localeUid) : null;
    const t = EMAIL_TEMPLATES.orgInvitation;
    const data = {
      orgName: invitation.orgName,
      inviterName: invitation.inviterName,
      role: invitation.role,
      expiresAtMs: invitation.expiresAt.toMillis(),
      // Staging invitations open the staging app.
      appBase: appBaseForProject(process.env.GCLOUD_PROJECT),
      invitationId: id
    };
    const name = invitee ? invitee.displayName : null;
    await sendPostmarkEmail(
      invitation.email,
      t.getSubject(name, data, locale),
      t.getHtmlBody(name, data, locale),
      t.getTextBody(name, data, locale)
    );
    return true;
  } catch (error) {
    console.error(`orgInvitation email for ${id} failed:`, error);
    return false;
  }
}

/**
 * Invite people to an org. One result per requested email:
 * { email, status: 'invited' | 'already-member' | 'already-invited' |
 *   'invalid-email' | 'no-seat-left', invitationId?, emailSent? }.
 * Seats are reserved in one transaction for the whole batch.
 */
async function createInvitations({ orgId, actorUid, inviterName, invites, skipActorCheck = false }) {
  if (!Array.isArray(invites) || invites.length === 0) throw new OrgError('invalid-argument');
  if (invites.length > MAX_INVITES_PER_CALL) throw new OrgError('too-many');

  const created = [];
  const results = await db().runTransaction(async (tx) => {
    const org = requireOrg(await tx.get(orgRef(orgId)));
    if (org.status !== 'active') throw new OrgError('org-suspended');
    let actorRole = 'owner';
    if (!skipActorCheck) actorRole = requireActorRole(await tx.get(memberRef(orgId, actorUid)));
    const state = await readSeatState(tx, orgId);
    const memberEmails = new Set(state.members.map((m) => m.email));
    const pendingEmails = new Set(
      state.invitations.filter((inv) => invitationState(inv) === 'pending').map((inv) => inv.email)
    );
    let seatsUsed = countSeatsUsed(state);
    const out = [];
    for (const invite of invites) {
      const email = normalizeEmail(invite && invite.email);
      const role = invite && invite.role;
      const refusal = inviteRefusal({ actorRole, role });
      if (refusal) throw new OrgError(refusal);
      if (!isPlausibleEmail(email)) {
        out.push({ email, status: 'invalid-email' });
      } else if (memberEmails.has(email)) {
        out.push({ email, status: 'already-member' });
      } else if (pendingEmails.has(email)) {
        out.push({ email, status: 'already-invited' });
      } else if (takesSeat(role) && seatsUsed >= org.seats) {
        out.push({ email, status: 'no-seat-left' });
      } else {
        const ref = db().collection('orgInvitations').doc();
        const invitation = {
          orgId,
          orgName: org.name,
          email,
          role,
          status: 'pending',
          invitedBy: actorUid,
          inviterName,
          createdAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(invitationExpiry()),
          lastSentAt: Timestamp.now(),
          sendCount: 1
        };
        tx.set(ref, invitation);
        created.push({ id: ref.id, invitation });
        pendingEmails.add(email);
        if (takesSeat(role)) seatsUsed++;
        out.push({ email, status: 'invited', invitationId: ref.id });
      }
    }
    return out;
  });

  // Emails go out after the commit, so a failed send never loses the
  // invitation: the manager can resend it.
  for (const { id, invitation } of created) {
    const sent = await sendInvitationEmail(id, invitation);
    const result = results.find((r) => r.invitationId === id);
    if (result) result.emailSent = sent;
  }
  return results;
}

/** Re-send an invitation and give it a fresh expiry. */
async function resendInvitation({ actorUid, invitationId }) {
  const invitation = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(invitationRef(invitationId));
    if (!snapshot.exists) throw new OrgError('invitation-not-found');
    const inv = snapshot.data();
    const actorRole = requireActorRole(await tx.get(memberRef(inv.orgId, actorUid)));
    const refusal = inviteRefusal({ actorRole, role: inv.role });
    if (refusal) throw new OrgError(refusal);
    const state = invitationState(inv);
    if (state !== 'pending' && state !== 'expired') throw new OrgError('invitation-closed');
    if (state === 'expired' && takesSeat(inv.role)) {
      // An expired invitation gave its seat back: take one again.
      const org = requireOrg(await tx.get(orgRef(inv.orgId)));
      const seatState = await readSeatState(tx, inv.orgId);
      if (countSeatsUsed(seatState) >= org.seats) throw new OrgError('no-seat-left');
    }
    const update = {
      expiresAt: Timestamp.fromMillis(invitationExpiry()),
      lastSentAt: Timestamp.now(),
      sendCount: (inv.sendCount || 1) + 1
    };
    tx.update(invitationRef(invitationId), update);
    return { ...inv, ...update };
  });
  const emailSent = await sendInvitationEmail(invitationId, invitation);
  return { invitationId, emailSent };
}

async function revokeInvitation({ actorUid, invitationId }) {
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(invitationRef(invitationId));
    if (!snapshot.exists) throw new OrgError('invitation-not-found');
    const inv = snapshot.data();
    const actorRole = requireActorRole(await tx.get(memberRef(inv.orgId, actorUid)));
    const refusal = inviteRefusal({ actorRole, role: inv.role });
    if (refusal) throw new OrgError(refusal);
    if (inv.status !== 'pending') throw new OrgError('invitation-closed');
    tx.update(invitationRef(invitationId), {
      status: 'revoked',
      respondedAt: FieldValue.serverTimestamp(),
      revokedBy: actorUid
    });
  });
  return { invitationId };
}

/**
 * The invitee's checks, shared by accept and decline: the invitation is
 * pending and was sent to this account's verified email.
 */
const checkInvitee = (inv, who) => {
  const state = invitationState(inv);
  if (state === 'expired') throw new OrgError('invitation-expired');
  if (state !== 'pending') throw new OrgError('invitation-closed');
  if (inv.email !== who.email) throw new OrgError('wrong-account');
  if (!who.emailVerified) throw new OrgError('email-not-verified');
};

async function acceptInvitation({ uid, invitationId }) {
  const who = await describeUser(uid);
  return db().runTransaction(async (tx) => {
    const snapshot = await tx.get(invitationRef(invitationId));
    if (!snapshot.exists) throw new OrgError('invitation-not-found');
    const inv = snapshot.data();
    checkInvitee(inv, who);
    const org = requireOrg(await tx.get(orgRef(inv.orgId)));
    if (org.status !== 'active') throw new OrgError('org-suspended');
    const existing = await tx.get(memberRef(inv.orgId, uid));
    const current = await readUserOrgsData(tx, uid);
    if (!existing.exists) {
      if (takesSeat(inv.role)) {
        // This invitation already holds a seat, unless the seat count was
        // lowered since: count everyone else, then check one more fits.
        const state = await readSeatState(tx, inv.orgId);
        const others = {
          members: state.members,
          invitations: state.invitations.filter((i) => i.id !== invitationId)
        };
        if (countSeatsUsed(others) >= org.seats) throw new OrgError('no-seat-left');
      }
      tx.set(memberRef(inv.orgId, uid), {
        uid,
        email: who.email,
        displayName: who.displayName,
        role: inv.role,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: inv.invitedBy || null,
        via: 'invitation'
      });
      tx.set(userOrgsRef(uid), userOrgsPatch(inv.orgId, inv.role, current), {
        merge: true
      });
      tx.delete(departedRef(inv.orgId, uid));
    }
    tx.update(invitationRef(invitationId), {
      status: 'accepted',
      respondedAt: FieldValue.serverTimestamp(),
      acceptedBy: uid
    });
    return {
      orgId: inv.orgId,
      orgName: org.name,
      role: existing.exists ? existing.data().role : inv.role,
      alreadyMember: existing.exists
    };
  });
}

async function declineInvitation({ uid, invitationId }) {
  const who = await describeUser(uid);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(invitationRef(invitationId));
    if (!snapshot.exists) throw new OrgError('invitation-not-found');
    checkInvitee(snapshot.data(), who);
    tx.update(invitationRef(invitationId), {
      status: 'declined',
      respondedAt: FieldValue.serverTimestamp()
    });
  });
  return { invitationId };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function changeMemberRole({ actorUid, orgId, targetUid, role }) {
  await db().runTransaction(async (tx) => {
    const org = requireOrg(await tx.get(orgRef(orgId)));
    const actorRole = requireActorRole(await tx.get(memberRef(orgId, actorUid)));
    const target = await tx.get(memberRef(orgId, targetUid));
    if (!target.exists) throw new OrgError('member-not-found');
    const targetRole = target.data().role;
    if (targetRole === role) return;
    const current = await readUserOrgsData(tx, targetUid);
    const state = await readSeatState(tx, orgId);
    const refusal = roleChangeRefusal({
      actorRole,
      targetRole,
      newRole: role,
      ownerCount: ownerCount(state.members)
    });
    if (refusal) throw new OrgError(refusal);
    // A viewer moving to a seat role needs a free seat.
    if (!takesSeat(targetRole) && takesSeat(role) && countSeatsUsed(state) >= org.seats) {
      throw new OrgError('no-seat-left');
    }
    tx.update(memberRef(orgId, targetUid), { role });
    tx.set(userOrgsRef(targetUid), userOrgsPatch(orgId, role, current), {
      merge: true
    });
  });
  return { orgId, uid: targetUid, role };
}

/** Remove a member, or leave (actor === target). */
async function removeMember({ actorUid, orgId, targetUid }) {
  await db().runTransaction(async (tx) => {
    requireOrg(await tx.get(orgRef(orgId)));
    const actorRole = requireActorRole(await tx.get(memberRef(orgId, actorUid)));
    const target = await tx.get(memberRef(orgId, targetUid));
    if (!target.exists) throw new OrgError('member-not-found');
    const current = await readUserOrgsData(tx, targetUid);
    const state = await readSeatState(tx, orgId);
    const refusal = removalRefusal({
      actorUid,
      actorRole,
      targetUid,
      targetRole: target.data().role,
      ownerCount: ownerCount(state.members)
    });
    if (refusal) throw new OrgError(refusal);
    tx.delete(memberRef(orgId, targetUid));
    // Domain auto-join skips them until they accept an invitation.
    tx.set(departedRef(orgId, targetUid), {
      uid: targetUid,
      removedBy: actorUid,
      at: FieldValue.serverTimestamp()
    });
    tx.set(userOrgsRef(targetUid), userOrgsPatch(orgId, null, current), {
      merge: true
    });
  });
  return { orgId, uid: targetUid };
}

async function renameOrg({ actorUid, orgId, name }) {
  if (!isValidOrgName(name)) throw new OrgError('invalid-name');
  const normalized = normalizeOrgName(name);
  await db().runTransaction(async (tx) => {
    requireOrg(await tx.get(orgRef(orgId)));
    const actorRole = requireActorRole(await tx.get(memberRef(orgId, actorUid)));
    if (!['owner', 'admin'].includes(actorRole)) throw new OrgError('not-manager');
    tx.update(orgRef(orgId), { name: normalized, updatedAt: FieldValue.serverTimestamp() });
  });
  return { orgId, name: normalized };
}

/**
 * Owners and admins set what members may edit (`memberEditScope`) and the
 * role a domain auto-join gives (`domainJoinRole`). The domains themselves
 * stay staff-set (orgUpdate): staff verify them.
 */
async function updateOrgSettings({ actorUid, orgId, memberEditScope, domainJoinRole }) {
  const fields = {};
  if (memberEditScope !== undefined) {
    if (!MEMBER_EDIT_SCOPES.includes(memberEditScope)) throw new OrgError('invalid-setting');
    fields.memberEditScope = memberEditScope;
  }
  if (domainJoinRole !== undefined) {
    if (!DOMAIN_JOIN_ROLES.includes(domainJoinRole)) throw new OrgError('invalid-setting');
    fields.domainJoinRole = domainJoinRole;
  }
  if (typeof orgId !== 'string' || !orgId || !Object.keys(fields).length) {
    throw new OrgError('invalid-argument');
  }
  await db().runTransaction(async (tx) => {
    requireOrg(await tx.get(orgRef(orgId)));
    const actorRole = requireActorRole(await tx.get(memberRef(orgId, actorUid)));
    if (!['owner', 'admin'].includes(actorRole)) throw new OrgError('not-manager');
    tx.update(orgRef(orgId), { ...fields, updatedAt: FieldValue.serverTimestamp() });
  });
  return { orgId, ...fields };
}

// ---------------------------------------------------------------------------
// Domain auto-join and entitlement
// ---------------------------------------------------------------------------

/**
 * Join the active orgs that claim the user's verified email domain, with
 * the org's domainJoinRole (member by default; a member needs a free seat,
 * a viewer takes none), except one they left or were removed from. Replaces the ALLOWED_PRO_TEAM_DOMAINS secret
 * for the customers moved into orgs. Returns the orgIds joined.
 */
async function autoJoinDomainOrgs(uid) {
  const who = await describeUser(uid);
  const domain = emailDomain(who.email);
  if (!domain || !who.emailVerified) return [];
  const orgs = await db()
    .collection('orgs')
    .where('domains', 'array-contains', domain)
    .where('status', '==', 'active')
    .get();
  const joined = [];
  for (const doc of orgs.docs) {
    const [existing, departed] = await Promise.all([
      memberRef(doc.id, uid).get(),
      departedRef(doc.id, uid).get()
    ]);
    if (existing.exists || departed.exists) continue;
    try {
      await addMember({ orgId: doc.id, uid, role: domainJoinRoleOf(doc.data()), via: 'domain' });
      joined.push(doc.id);
    } catch (error) {
      // No seat left: the org's managers can free one or ask for more.
      if (!(error instanceof OrgError)) throw error;
      console.warn(`autoJoinDomainOrgs: ${uid} not added to ${doc.id}: ${error.reason}`);
    }
  }
  return joined;
}

/**
 * The user's orgs: [{ orgId, role, name, plan, status, memberEditScope }].
 * Reads userOrgs, then each org doc.
 */
async function readUserOrgs(uid) {
  const snapshot = await userOrgsRef(uid).get();
  const roles = (snapshot.exists && snapshot.data().orgs) || {};
  const entries = Object.entries(roles);
  const docs = await Promise.all(entries.map(([orgId]) => orgRef(orgId).get()));
  return entries
    .map(([orgId, role], i) =>
      docs[i].exists
        ? {
            orgId,
            role,
            name: docs[i].data().name,
            plan: docs[i].data().plan,
            status: docs[i].data().status,
            memberEditScope: memberEditScopeOf(docs[i].data())
          }
        : null
    )
    .filter(Boolean);
}

/**
 * The plan the user gets from their orgs ('MAX' | 'PRO' | null). A read
 * failure resolves to null: org Pro fails closed, like the pass.
 */
async function readOrgPlan(uid) {
  try {
    const orgs = await readUserOrgs(uid);
    return planFromMemberships(orgs.map((o) => ({ role: o.role, org: o })));
  } catch (error) {
    console.error(`readOrgPlan failed for ${uid}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

const requireAuth = (context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  }
  assertAppCheck(context);
  return context.auth.uid;
};

const requireStaff = (context) => {
  const uid = requireAuth(context);
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only.');
  }
  return uid;
};

const callable = (handler, { secrets = [] } = {}) =>
  functions
    .runWith({ secrets })
    .https.onCall(async (data, context) => {
      try {
        return await handler(data || {}, context);
      } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw toHttpsError(error);
      }
    });

const inviterNameFor = async (uid) => {
  try {
    const user = await getAuth().getUser(uid);
    return user.displayName || user.email || null;
  } catch {
    return null;
  }
};

const orgCreate = callable(
  (data, context) =>
    createOrg({ ...data, actorUid: requireStaff(context) }),
  { secrets: ['POSTMARK_API_KEY'] }
);

const orgUpdate = callable((data, context) => {
  requireStaff(context);
  return updateOrg({ orgId: data.orgId, patch: data.patch });
});

const orgRename = callable((data, context) =>
  renameOrg({ actorUid: requireAuth(context), orgId: data.orgId, name: data.name })
);

const orgUpdateSettings = callable((data, context) =>
  updateOrgSettings({
    actorUid: requireAuth(context),
    orgId: data.orgId,
    memberEditScope: data.memberEditScope,
    domainJoinRole: data.domainJoinRole
  })
);

const orgInvite = callable(
  async (data, context) => {
    const actorUid = requireAuth(context);
    return {
      results: await createInvitations({
        orgId: data.orgId,
        actorUid,
        inviterName: await inviterNameFor(actorUid),
        invites: data.invites
      })
    };
  },
  { secrets: ['POSTMARK_API_KEY'] }
);

const orgResendInvitation = callable(
  (data, context) =>
    resendInvitation({ actorUid: requireAuth(context), invitationId: data.invitationId }),
  { secrets: ['POSTMARK_API_KEY'] }
);

const orgRevokeInvitation = callable((data, context) =>
  revokeInvitation({ actorUid: requireAuth(context), invitationId: data.invitationId })
);

const orgAcceptInvitation = callable((data, context) =>
  acceptInvitation({ uid: requireAuth(context), invitationId: data.invitationId })
);

const orgDeclineInvitation = callable((data, context) =>
  declineInvitation({ uid: requireAuth(context), invitationId: data.invitationId })
);

const orgChangeRole = callable((data, context) =>
  changeMemberRole({
    actorUid: requireAuth(context),
    orgId: data.orgId,
    targetUid: data.uid,
    role: data.role
  })
);

const orgRemoveMember = callable((data, context) =>
  removeMember({ actorUid: requireAuth(context), orgId: data.orgId, targetUid: data.uid })
);

module.exports = {
  OrgError,
  callable,
  requireAuth,
  createOrg,
  updateOrg,
  addMember,
  createInvitations,
  resendInvitation,
  revokeInvitation,
  acceptInvitation,
  declineInvitation,
  changeMemberRole,
  removeMember,
  renameOrg,
  updateOrgSettings,
  autoJoinDomainOrgs,
  readUserOrgs,
  readOrgPlan,
  orgCreate,
  orgUpdate,
  orgRename,
  orgUpdateSettings,
  orgInvite,
  orgResendInvitation,
  orgRevokeInvitation,
  orgAcceptInvitation,
  orgDeclineInvitation,
  orgChangeRole,
  orgRemoveMember
};
