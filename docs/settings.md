# Settings, the profile menu and the team switcher

Kieran's review of teams (#1267): a profile menu shared by the editor and
the generator switches the active team and opens Settings, one modal with
its sections listed on the left, which replaces the profile modal and the
team settings modal.

## The profile menu

`ProfileButton` with `showHoverCard` opens `ProfileHoverCard`
(`src/shared/auth/components`), in the editor (right panel, viewer toolbar)
and the generator:

- who is signed in;
- **Working in**: Personal and each team (plan or Inactive · role), the active one
  checked. Picking one saves `userOrgs/{uid}.activeOrgId` (`orgSetActive`)
  and refreshes the user's status (`refreshMembershipStatus`, whose
  `MEMBERSHIP_CHANGED_EVENT` updates every auth context on the page, e.g.
  the generator's token counter, a separate React root);
- Settings;
- "Need this for a team? Contact us" (an email, `TeamContactLink`) is in
  Personal billing and the upgrade modal until teams are self-service;
- Log Out and the language picker, the app's only one (the editor's
  `LocaleProvider` follows its `changeLocale` broadcast).

Its text is in `@shared/i18n/sharedMessages` (the generator has no
react-intl). An app passes `onOpenSettings(section)`; without it (Bollard
Buddy), the links open the editor's in a new tab.

The plan badge beside the profile button (the editor's own; `WorkspaceBadge`
in the generator) shows the same workspace:
the active team's plan and name, or the user's own plan under Personal
(`workspaceOf` in `@shared/utils/workspace`). What the user can do still
comes from all their plans; only the label follows the workspace.

## The active team

`activeOrgId` is any team the user belongs to, or null for Personal. It is
a default, never a permission: an open team scene always follows its own
team. It sets:

| What                             | Where                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Who pays AI generations          | the active team when the user holds a seat in it, else their own tokens ([team-wallet.md](team-wallet.md))   |
| Where a brand-new scene is saved | the active team, in no project, team-only, when they can edit there (`activeTeamTarget` in `sceneAccess.js`) |
| The Assets panel's first library | the open team scene's team, else the active team's (`AssetsPanelBody`)                                       |
| The scenes modal's first tab     | the active team's                                                                                            |

Joining a first team makes it active; after that only the user switches.
Leaving the active team goes back to Personal (`userOrgsPatch`,
[team-wallet.md](team-wallet.md#who-pays)). The client reads it as `currentUser.activeOrgId`
and the paying team as `billingOrgOf(currentUser)`
(`@shared/utils/teamWallet`).

## Settings

`src/shared/settings/SettingsModal.jsx`: the sections on the left (tabs on
a phone), the selected one on the right.

| Section (id)                                                   | Holds                                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Profile (`profile`)                                            | who is signed in, the provider, Log Out; the @username (`UsernameEditor`); pending team invitations; the version |
| Usage and billing · Personal (`billing`)                       | the user's own plan (upgrade, or the Stripe portal) and tokens; a line when the active team pays their AI        |
| Teams, for each: Usage and billing · {team} (`billing`, orgId) | the team's plan (covers a seat, not a viewer), library storage, AI wallet (`TeamWalletSection`)                  |
| Manage {team} (`team`, orgId)                                  | `TeamSection`: members, roles, invitations, what members can edit                                                |

The plan badge beside the profile button opens the active workspace's
Usage and billing.

It's shared: it never touches an app's store. The app passes what's
app-specific (`SettingsHost.js`): `notify`, `onUpgrade`, `onOpenInvitation`,
`onClose`, the section and `onSectionChange`. Confirmations use the shared
`ConfirmModal`. Its text is react-intl (the editor catalogs, extracted as
usual); in the generator, which has no IntlProvider, `loadMessages` loads
the editor catalogs on first open.

- Editor: `EditorSettingsModal` (`src/editor/components/modals/SettingsModal`),
  `store.openSettings(section)`; `openTeamModal(orgId)` opens a team's
  section.
- Generator: `src/generator/components/ProfileButton.jsx`.

## Deep links

`#/modal/settings/profile`, `#/modal/settings/billing[/<orgId>]` and
`#/modal/settings/team/<orgId>` open a section, in either app
(`src/tested/settings-hash.js`); the old `#/modal/profile` and unknown
sections open Profile. The Stripe portal returns to Usage and billing ·
Personal.

## Tests

- `test/core/settings-hash.test.js`: the deep links.
- `test/shared/team-wallet-sync.test.js`: `billingOrgOf`.
- `test/shared/workspace.test.js`: the workspace and its plan.
- `test/rules/team-wallet.emulator.test.js`: who pays, switching, joining
  and leaving.
