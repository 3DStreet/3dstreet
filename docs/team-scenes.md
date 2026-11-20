# Team scenes, projects and the edit lock (#1267 Phase 2)

A scene with an `orgId` belongs to that team ([orgs.md](orgs.md)); one with
`orgId: null` is personal. Projects are folders of a team's scenes.

## Who does what

|                                  | Owner, admin       | Member             | Viewer             | Not in the team              |
| -------------------------------- | ------------------ | ------------------ | ------------------ | ---------------------------- |
| Open a team-only scene           | yes                | yes                | yes (viewer first) | no                           |
| Edit and save it                 | yes, with the lock | yes, with the lock | no                 | copy only if public/unlisted |
| Change who can open it           | yes                | no                 | no                 | no                           |
| Delete it                        | yes                | no                 | no                 | no                           |
| Create projects, new team scenes | yes                | yes                | no                 | no                           |
| Move a scene between projects    | yes                | yes                | no                 | no                           |

- On a team scene, `visibility: 'private'` means **team-only**: the team's
  members open it. The team's plan pays for it (no Pro check), and new team
  scenes are team-only by default.
- The author of a team scene is only who created it: leaving the team ends
  their access like anyone else's.
- A personal scene moves into a team (by its author, an editor of that team,
  `orgMoveScene`); a private personal scene becomes team-only. A team scene
  never moves back out or to another team.
- Copies: Save As by one of the team's editors stays in the team and
  project. A viewer can't copy a team-only scene out (it would publish it).

## The edit lock (one editor at a time)

`scenes/{id}.editLock = { uid, name, expiresAt }`, managed by
`src/editor/lib/editLock.js` and started by `EditLockBanner`:

- A team editor opening the scene in the editor takes the lock in a
  transaction, renews it every 30 seconds, and releases it when leaving the
  scene or the editor. It lasts 2 minutes, so a closed tab frees it within 2
  minutes. Firestore rules refuse saves without the caller's unexpired lock,
  and locks longer than 3 minutes.
- Someone else holding it: a banner names them, saves are refused with a
  message, the Save button says why, and the tab retries every 30 seconds
  (or on "Try again"), taking the lock as soon as it's free. Owners and
  admins can "Take over".
- **Never overwriting another member's work:** each in-place save of a team
  scene increments `revision`; the tab tracks the revision it has
  (`store.sceneRevision`). When it gets the lock (first time, after waiting,
  or taking over) and the doc's revision differs, it reloads the scene from
  that doc before anything can be saved, and says so. Changes made while
  someone else held the lock are discarded: they were never saveable.
- Viewers get a "view only" banner; their edits are never saved.

`sceneSaveMode(currentUser)` (`src/editor/lib/sceneAccess.js`) is the one
answer to "can this tab save the open scene": `own`, `team`, `team-locked`,
`team-viewer`, `copy` or `new`. Autosave, the Save button, File > Save,
thumbnails, the title and the unsaved-changes warning all use it.

## Lists

- My scenes: `author == uid` and `orgId == null`.
- A team's tab in the scenes modal: `orgId == X` (and `projectId == Y`),
  with "New project" and "New scene in …" for editors. A new scene started
  there is created in that project (`store.newSceneTarget`), team-only, with
  the lock.
- The Firestore rules refuse any other list query; each has a composite
  index in `public/firestore.indexes.json`.

## Data and code

- Rules: `public/firestore.rules` (scenes, `orgs/{orgId}/projects`) and
  `public/storage.rules` (a team scene's files: members read, editors write).
- Callables (`public/functions/team-scenes.js`): `orgCreateProject`,
  `orgRenameProject`, `orgMoveScene`. `setSceneVisibility` handles team
  scenes for owners and admins; `getScene` serves team-only scenes to members
  (and answers `{ reason: 'private', team: true }` to others).
- Projects: `orgs/{orgId}/projects/{projectId}` = { name, createdBy,
  createdAt, updatedAt }.
- Existing scenes need `orgId: null` (and `visibility`):
  `scripts/backfill-scene-visibility.js` writes both.

## Tests

- `test/rules/team-scenes.rules.test.js`: rules for reading, listing,
  creating, the lock, saving, deleting and files.
- `test/rules/team-scenes.emulator.test.js`: projects, moves, getScene access.
- `test/editor/sceneAccess.test.js`: `sceneSaveMode`.

## Not yet

- Live view of the editor's changes for the others (V2) and simultaneous
  editing (V3).
- The editor isn't read-only while someone else holds the lock: edits are
  possible but never saved, and are dropped when the tab gets the lock.
