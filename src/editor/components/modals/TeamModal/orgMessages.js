import { defineMessages } from 'react-intl';

// Organizations (teams, #1267): strings shared by TeamModal,
// InvitationModal and the profile's Teams section.
export const roleMessages = defineMessages({
  owner: { id: 'orgs.role.owner', defaultMessage: 'Owner' },
  admin: { id: 'orgs.role.admin', defaultMessage: 'Admin' },
  member: { id: 'orgs.role.member', defaultMessage: 'Member' },
  viewer: { id: 'orgs.role.viewer', defaultMessage: 'Viewer' }
});

export const roleDescriptionMessages = defineMessages({
  owner: {
    id: 'orgs.roleDescription.owner',
    defaultMessage: 'Manages the team, its members and its owners.'
  },
  admin: {
    id: 'orgs.roleDescription.admin',
    defaultMessage: 'Manages members and invitations.'
  },
  member: {
    id: 'orgs.roleDescription.member',
    defaultMessage: "Uses the team's plan. Takes a seat."
  },
  viewer: {
    id: 'orgs.roleDescription.viewer',
    defaultMessage: "Can view the team's work. Takes no seat."
  }
});

// Server refusal reasons (public/functions/orgs.js) → message.
export const orgErrorMessages = defineMessages({
  'not-manager': {
    id: 'orgs.error.notManager',
    defaultMessage: 'Only owners and admins can do this.'
  },
  'owner-only': {
    id: 'orgs.error.ownerOnly',
    defaultMessage: 'Only owners can do this.'
  },
  'last-owner': {
    id: 'orgs.error.lastOwner',
    defaultMessage:
      'A team needs at least one owner. Make someone else an owner first.'
  },
  'no-seat-left': {
    id: 'orgs.error.noSeatLeft',
    defaultMessage:
      'No seat left in this team. Free a seat or contact 3DStreet for more.'
  },
  'org-suspended': {
    id: 'orgs.error.orgSuspended',
    defaultMessage: 'This team is suspended.'
  },
  'invitation-not-found': {
    id: 'orgs.error.invitationNotFound',
    defaultMessage: 'This invitation does not exist.'
  },
  'invitation-expired': {
    id: 'orgs.error.invitationExpired',
    defaultMessage:
      'This invitation has expired. Ask the person who invited you to send it again.'
  },
  'invitation-closed': {
    id: 'orgs.error.invitationClosed',
    defaultMessage: 'This invitation is no longer valid.'
  },
  'wrong-account': {
    id: 'orgs.error.wrongAccount',
    defaultMessage:
      'This invitation was sent to another email address. Sign in with that address to accept it.'
  },
  'email-not-verified': {
    id: 'orgs.error.emailNotVerified',
    defaultMessage: 'Your email address is not verified.'
  },
  'invalid-name': {
    id: 'orgs.error.invalidName',
    defaultMessage: 'Enter a team name of 80 characters or fewer.'
  },
  // Team scenes and projects (team-scenes.js)
  'not-editor': {
    id: 'orgs.error.notEditor',
    defaultMessage: 'Only owners, admins and members can do this.'
  },
  'own-only': {
    id: 'orgs.error.ownOnly',
    defaultMessage: 'In this team, members can only change what they created.'
  },
  'invalid-setting': {
    id: 'orgs.error.invalidSetting',
    defaultMessage: 'This team setting is not valid.'
  },
  'not-author': {
    id: 'orgs.error.notAuthor',
    defaultMessage: 'Only the author of a personal scene can move it.'
  },
  'project-not-found': {
    id: 'orgs.error.projectNotFound',
    defaultMessage: 'This project does not exist.'
  },
  'invalid-move': {
    id: 'orgs.error.invalidMove',
    defaultMessage: 'A team scene can only move between projects of its team.'
  },
  generic: {
    id: 'orgs.error.generic',
    defaultMessage: 'Something went wrong. Please try again.'
  }
});

// Per-address results of an invitation batch (orgInvite).
export const inviteResultMessages = defineMessages({
  invited: {
    id: 'orgs.inviteResult.invited',
    defaultMessage: '{email}: invitation sent.'
  },
  invitedNoEmail: {
    id: 'orgs.inviteResult.invitedNoEmail',
    defaultMessage:
      '{email}: invitation created, but the email could not be sent. Use Resend.'
  },
  'already-member': {
    id: 'orgs.inviteResult.alreadyMember',
    defaultMessage: '{email} is already in the team.'
  },
  'already-invited': {
    id: 'orgs.inviteResult.alreadyInvited',
    defaultMessage: '{email} already has a pending invitation.'
  },
  'invalid-email': {
    id: 'orgs.inviteResult.invalidEmail',
    defaultMessage: '{email} is not a valid email address.'
  },
  'no-seat-left': {
    id: 'orgs.inviteResult.noSeatLeft',
    defaultMessage: '{email}: no seat left.'
  }
});

export const orgErrorMessage = (intl, reason) =>
  intl.formatMessage(orgErrorMessages[reason] || orgErrorMessages.generic);
