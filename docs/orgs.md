# Organizations (teams, #1267 Phase 1)

An organization ("team" in the UI) has a plan (`PRO` or `MAX`), a number of
seats, and members with a role. This page covers membership and the plan it
gives; team-owned scenes, projects and the edit lock are in
[team-scenes.md](team-scenes.md).

## Roles

| Role   | Takes a seat | Gets the org's plan | Can manage                             |
| ------ | ------------ | ------------------- | -------------------------------------- |
| owner  | yes          | yes                 | members, invitations, owners, name     |
| admin  | yes          | yes                 | members, invitations, name; not owners |
| member | yes          | yes                 | nothing; can leave                     |
| viewer | no           | no                  | nothing; can leave                     |

- An org always keeps at least one owner: the last owner can't leave, be
  removed or be demoted.
- Admins can't invite owners, make someone an owner, or change or remove an
  owner.
- A viewer moving to a seat role needs a free seat.

## What members can edit

`orgs/{orgId}.memberEditScope` (missing = `all`), set by owners and admins in
Team settings ("What members can edit", `orgUpdateSettings`):

- `all`: members edit every team scene (one at a time, with the edit lock)
  and rename or replace every library asset. Fits a city department.
- `own`: members open and view every team scene but edit only the scenes
  they created, and rename or replace only the assets they added. Saving
  another member's scene makes their own copy in the team. Fits a class.

Owners and admins edit everything either way; viewers nothing. Removing a
library asset was already limited to managers and the member who added it.

Enforced in three places that must agree: the Firestore rules
(`canEditTeamItem`: taking the edit lock and saving a scene, updating a
library asset), the callables (`canEditTeamItem` in `org-utils.js`: moving a
scene between projects, replacing an asset's file) and the client
(`src/shared/utils/teamPermissions.js`, drift test
`test/shared/teamPermissions-sync.test.js`; `canEditTeamScene` in
`src/editor/lib/sceneAccess.js`). The client reads the setting from
`currentUser.orgs` (`readUserOrgs`), so a member's open tab sees a change
after a reload; the rules apply it at once (a lock taken before no longer
saves).

Known gap: Storage rules can read only two Firestore documents per check,
and a scene's files already use both (scene, membership). A member can
still overwrite another member's scene thumbnail or screenshot under `own`.

## Seats

Seats used = members in a seat role + pending, unexpired invitations for a
seat role. Inviting, accepting and promoting a viewer are refused with
`no-seat-left` when the org is full. If staff lower the seat count below the
members, nobody is removed; new invitations and acceptances are refused until
seats free up. Only managers see the count (members can't read invitations).

## Invitations

- Managers invite by email with a role (up to 50 addresses per call). Each
  address gets a result: `invited`, `already-member`, `already-invited`,
  `invalid-email` or `no-seat-left`.
- The invitation email (`orgInvitation` in
  `public/functions/email/templates.js`, en/es/pt-BR/fr) goes to an address,
  not a user, so it skips `sendLifecycleEmail`. Its language is the invitee's
  when they have an account, else the inviter's. Sending is best-effort: the
  invitation exists even if the email fails (`emailSent: false`), and
  managers can resend.
- The link is `<app>/?utm_…#invite=<id>` (`src/tested/org-invite-link.js`),
  pointing at the project's own app (`appBaseForProject`), so staging
  invitations open staging. It opens `InvitationModal`; signed-out visitors
  sign in first and come back to it.
- Accepting requires signing in with the invited email, verified. Invitations
  expire after 7 days; an expired one can be resent (new expiry, and a seat
  again). Invitees also find their pending invitations in Settings > Teams.

## Domain auto-join

The lookup (`domains` array-contains + `status ==`) needs the composite
index on `orgs` in `public/firestore.indexes.json`; the emulator doesn't
enforce indexes, so the tests can't catch a missing one.

An org's `domains` (set by staff) make users with a verified email on those
domains join it when they sign in (`autoJoinDomainOrgs`, run by
`checkUserProStatus`), with the org's `domainJoinRole` (missing = `member`):
members while seats last, viewers (no seat) always. Owners and admins pick
the role in Team settings when the team has domains, so a school can let
students in as viewers. Turning auto-join off is staff removing the
domains, since staff verify them. Someone who left or was removed
(`orgs/{orgId}/departed/{uid}`) is not joined again until they accept an
invitation. This replaces the
`ALLOWED_PRO_TEAM_DOMAINS` secret for customers moved into orgs; the secret
still works for the others.

## Plan and entitlement

A seat (owner, admin, member) in an active org gives the org's plan,
everywhere Pro or the plan is checked: `hasProEntitlement` (`orgPlan`),
`isUserProInternal`, `checkUserProStatus` (which also returns `orgPlan` and
`orgs`), the storage quota (`asset-quota.js`) and pass codes (an org seat
is already Pro). The best plan wins across the user's orgs and their own
subscription. A suspended org gives nothing.

A seat does not refill the member's personal AI tokens: the team pays their
generations from its wallet, within its monthly budget
([team-wallet.md](team-wallet.md)).

On the client, `currentUser.orgs`, `orgPlan` and `teamName` come from
`src/shared/auth/api/user.js`. `plan` stays the user's own subscription
(billing UI keys off it); labels use `orgPlan` for Max and `teamName` for the
team label.

## Data

All written by the callables in `public/functions/orgs.js` (Admin SDK); the
rules in `firestore.rules` only allow reads.

| Document                     | Fields                                                                                                                                                              | Readable by                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `orgs/{orgId}`               | name, plan, seats, status (`active`, `suspended`), domains, memberEditScope (`all`, `own`), domainJoinRole (`member`, `viewer`), createdAt, createdBy, updatedAt    | members                                             |
| `orgs/{orgId}/members/{uid}` | uid, email, displayName, role, joinedAt, invitedBy, via (`invitation`, `domain`, `staff`)                                                                           | members                                             |
| `orgs/{orgId}/departed/{uid}` | uid, removedBy, at: left or was removed; cleared on joining again | nobody (functions only) |
| `orgInvitations/{id}`        | orgId, orgName, email (lowercase), role, status (`pending`, `accepted`, `declined`, `revoked`), invitedBy, inviterName, createdAt, expiresAt, lastSentAt, sendCount | the invitee (verified email) and the org's managers |
| `userOrgs/{uid}`             | orgs: { [orgId]: role }, activeOrgId (the team switcher, null = Personal; [team-wallet.md](team-wallet.md))                                                         | the user                                            |

Every membership change updates `userOrgs` in the same transaction.

## Callables

| Callable                                      | Who                                 | Does                                                                    |
| --------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `orgCreate`                                   | staff (admin claim)                 | create an org; the owner is added, or invited when they have no account |
| `orgUpdate`                                   | staff                               | name, plan, seats, status, domains                                      |
| `orgRename`                                   | owner, admin                        | rename                                                                  |
| `orgUpdateSettings`                           | owner, admin                        | memberEditScope, domainJoinRole                                         |
| `orgInvite`                                   | owner, admin                        | invite emails with a role                                               |
| `orgResendInvitation`, `orgRevokeInvitation`  | owner, admin                        |                                                                         |
| `orgAcceptInvitation`, `orgDeclineInvitation` | the invitee                         |                                                                         |
| `orgChangeRole`                               | owner, admin                        |                                                                         |
| `orgRemoveMember`                             | owner, admin; anyone for themselves | remove or leave                                                         |

Refusals are `HttpsError`s with `details.reason` (`not-manager`,
`owner-only`, `last-owner`, `no-seat-left`, `wrong-account`,
`invitation-expired`, ...), mapped to messages in
`src/shared/settings/team/orgMessages.js`.

Staff create and update orgs from the browser console while signed in with an
admin account: `adminTools.createOrg({ name, plan, seats, ownerEmail,
domains })` and `adminTools.updateOrg(orgId, patch)`
(`src/shared/services/firebase.js`).

## UI

- Settings ([settings.md](settings.md)): Profile lists pending invitations
  (View invitation → `InvitationModal`); each team has "Usage and billing ·
  {team}" (plan, storage, AI tokens) and "Manage {team}" (`TeamSection`):
  members and roles, what members can edit (`TeamPermissionsSection`),
  pending invitations (resend, revoke), invite form, rename, leave.
  Managers see the seats.
- The profile menu's team switcher picks the active team.
- The plan badge and Settings show Max for a Max org and the team name.

## Tests

- `test/core/org-utils.test.js`: the pure rules (roles, seats, plan).
- `test/rules/orgs.emulator.test.js`: the transactions against the emulators.
- `test/rules/orgs.rules.test.js`: the Firestore rules.
