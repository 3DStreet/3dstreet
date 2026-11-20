/**
 * Organizations (teams, #1267 Phase 1), client side. Reads go straight to
 * Firestore (firestore.rules: members read their org, managers and the
 * invitee read invitations); every change goes through the org callables in
 * public/functions/orgs.js. See docs/orgs.md.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@shared/services/firebase';
import { isUserPro } from '@shared/auth/api/user';

const call = async (name, data) =>
  (await httpsCallable(functions, name)(data)).data;

/** The refusal reason of an org callable error (see orgs.js), or null. */
export const orgErrorReason = (error) => error?.details?.reason || null;

export const getOrg = async (orgId) => {
  const snapshot = await getDoc(doc(db, 'orgs', orgId));
  return snapshot.exists() ? { orgId, ...snapshot.data() } : null;
};

export const listMembers = async (orgId) =>
  (await getDocs(collection(db, 'orgs', orgId, 'members'))).docs.map((d) =>
    d.data()
  );

/** Pending invitations of an org (expired ones included). Managers only. */
export const listOrgInvitations = async (orgId) =>
  (
    await getDocs(
      query(
        collection(db, 'orgInvitations'),
        where('orgId', '==', orgId),
        where('status', '==', 'pending')
      )
    )
  ).docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * An invitation, as its invitee or an org manager. Throws
 * permission-denied for anyone else (e.g. signed in with another email).
 */
export const getInvitation = async (invitationId) => {
  const snapshot = await getDoc(doc(db, 'orgInvitations', invitationId));
  return snapshot.exists() ? { id: invitationId, ...snapshot.data() } : null;
};

/** The signed-in user's pending invitations (by their email). */
export const listMyInvitations = async (email) => {
  if (!email) return [];
  return (
    await getDocs(
      query(
        collection(db, 'orgInvitations'),
        where('email', '==', email.trim().toLowerCase()),
        where('status', '==', 'pending')
      )
    )
  ).docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const inviteMembers = (orgId, invites) =>
  call('orgInvite', { orgId, invites });
export const resendInvitation = (invitationId) =>
  call('orgResendInvitation', { invitationId });
export const revokeInvitation = (invitationId) =>
  call('orgRevokeInvitation', { invitationId });
export const acceptInvitation = (invitationId) =>
  call('orgAcceptInvitation', { invitationId });
export const declineInvitation = (invitationId) =>
  call('orgDeclineInvitation', { invitationId });
export const changeMemberRole = (orgId, uid, role) =>
  call('orgChangeRole', { orgId, uid, role });
export const removeMember = (orgId, uid) =>
  call('orgRemoveMember', { orgId, uid });
export const renameOrg = (orgId, name) => call('orgRename', { orgId, name });

const toMillis = (value) =>
  typeof value?.toMillis === 'function' ? value.toMillis() : null;

/** 'pending' | 'expired', from an invitation's expiresAt. */
export const invitationState = (invitation, nowMs = Date.now()) => {
  const expiresAtMs = toMillis(invitation?.expiresAt);
  return expiresAtMs !== null && expiresAtMs <= nowMs ? 'expired' : 'pending';
};

export const invitationExpiresAtMs = (invitation) =>
  toMillis(invitation?.expiresAt);

/**
 * Re-read the user's Pro status (plan, orgs) into the auth context after a
 * membership change, so the plan badge and every Pro gate update without a
 * reload. `setCurrentUser` is the auth context's setter.
 */
export const refreshMembershipStatus = async (setCurrentUser) => {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;
  const status = await isUserPro(firebaseUser);
  setCurrentUser((prev) => ({
    ...prev,
    isPro: status.isPro,
    isProTeam: status.isProTeam,
    teamDomain: status.teamDomain,
    teamName: status.teamName ?? null,
    plan: status.plan ?? null,
    orgPlan: status.orgPlan ?? null,
    orgs: status.orgs ?? [],
    isProPass: !!status.isProPass,
    proUntil: status.proUntil ?? null
  }));
  window.dispatchEvent(new Event('planChanged'));
  window.dispatchEvent(new Event('tokenCountChanged'));
  return status;
};
