# Organizations (teams, #1267 Phase 1)

An organization ("team" in the UI) has a plan (`PRO` or `MAX`), a number of
seats, and members with a role. Phase 1 covers membership and the plan it
gives; team-owned scenes and projects come in Phase 2.

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
  again). Invitees also find their pending invitations in the profile.

## Domain auto-join

The lookup (`domains` array-contains + `status ==`) needs the composite
index on `orgs` in `public/firestore.indexes.json`; the emulator doesn't
enforce indexes, so the tests can't catch a missing one.

An org's `domains` (set by staff) make users with a verified email on those
domains join it as members when they sign in (`autoJoinDomainOrgs`, run by
`checkUserProStatus`), while seats last. This replaces the
`ALLOWED_PRO_TEAM_DOMAINS` secret for customers moved into orgs; the secret
still works for the others.

## Plan and entitlement

A seat (owner, admin, member) in an active org gives the org's plan,
everywhere Pro or the plan is checked: `hasProEntitlement` (`orgPlan`),
`isUserProInternal`, `checkUserProStatus` (which also returns `orgPlan` and
`orgs`), the monthly token refill (the org's plan allowance), the storage
quota (`asset-quota.js`) and pass codes (an org seat is already Pro). The
best plan wins across the user's orgs and their own subscription. A suspended
org gives nothing. In Phase 1 members spend their own tokens; an org token
wallet is Phase 3.

On the client, `currentUser.orgs`, `orgPlan` and `teamName` come from
`src/shared/auth/api/user.js`. `plan` stays the user's own subscription
(billing UI keys off it); labels use `orgPlan` for Max and `teamName` for the
team label.

## Data

All written by the callables in `public/functions/orgs.js` (Admin SDK); the
rules in `firestore.rules` only allow reads.

| Document                     | Fields                                                                                                                                                              | Readable by                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `orgs/{orgId}`               | name, plan, seats, status (`active`, `suspended`), domains, createdAt, createdBy, updatedAt                                                                         | members                                             |
| `orgs/{orgId}/members/{uid}` | uid, email, displayName, role, joinedAt, invitedBy, via (`invitation`, `domain`, `staff`)                                                                           | members                                             |
| `orgInvitations/{id}`        | orgId, orgName, email (lowercase), role, status (`pending`, `accepted`, `declined`, `revoked`), invitedBy, inviterName, createdAt, expiresAt, lastSentAt, sendCount | the invitee (verified email) and the org's managers |
| `userOrgs/{uid}`             | orgs: { [orgId]: role }                                                                                                                                             | the user                                            |

Every membership change updates `userOrgs` in the same transaction.

## Callables

| Callable                                      | Who                                 | Does                                                                    |
| --------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `orgCreate`                                   | staff (admin claim)                 | create an org; the owner is added, or invited when they have no account |
| `orgUpdate`                                   | staff                               | name, plan, seats, status, domains                                      |
| `orgRename`                                   | owner, admin                        | rename                                                                  |
| `orgInvite`                                   | owner, admin                        | invite emails with a role                                               |
| `orgResendInvitation`, `orgRevokeInvitation`  | owner, admin                        |                                                                         |
| `orgAcceptInvitation`, `orgDeclineInvitation` | the invitee                         |                                                                         |
| `orgChangeRole`                               | owner, admin                        |                                                                         |
| `orgRemoveMember`                             | owner, admin; anyone for themselves | remove or leave                                                         |

Refusals are `HttpsError`s with `details.reason` (`not-manager`,
`owner-only`, `last-owner`, `no-seat-left`, `wrong-account`,
`invitation-expired`, ...), mapped to messages in
`src/editor/components/modals/TeamModal/orgMessages.js`.

Staff create and update orgs from the browser console while signed in with an
admin account: `adminTools.createOrg({ name, plan, seats, ownerEmail,
domains })` and `adminTools.updateOrg(orgId, patch)`
(`src/shared/services/firebase.js`).

## UI

- Profile → Teams: the user's orgs (Open → `TeamModal`) and pending
  invitations (View invitation → `InvitationModal`).
- `TeamModal`: members and roles, pending invitations (resend, revoke),
  invite form, rename, leave. Managers see the seats.
- The plan badge and the profile show Max for a Max org and the team name.

## Tests

- `test/core/org-utils.test.js`: the pure rules (roles, seats, plan).
- `test/rules/orgs.emulator.test.js`: the transactions against the emulators.
- `test/rules/orgs.rules.test.js`: the Firestore rules.
