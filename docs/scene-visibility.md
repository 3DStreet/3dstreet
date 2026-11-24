# Scene visibility (#1267)

Every cloud scene has a `visibility` field on its `scenes/{id}` document:

| Value      | Who can open it                                                                          | Listed in the community scenes | Embeds |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| `public`   | anyone                                                                                   | yes                            | yes    |
| `unlisted` | anyone with the link                                                                     | no                             | yes    |
| `private`  | its author only (a team scene: its team's members, see [team-scenes.md](team-scenes.md)) | no                             | no     |

A scene without the field (written before visibility existed) is public
everywhere: the rules, `getScene` and the client all read a missing field as
`public`. The community feed is the exception, because a Firestore query can't
match a missing field; `scripts/backfill-scene-visibility.js` sets it on old
scenes (see Deploying).

Unlisted and private are Pro features. An author can always make a scene less
restricted, so one whose Pro ended keeps what they have and can lower it.

## Where it is enforced

- **Firestore rules** (`public/firestore.rules`, `scenes`):
  - `get`: anyone, unless the scene is private (author only).
  - `list`: the query must be limited to public scenes
    (`where('visibility', '==', 'public')`, the community feed) or to the
    caller's own (`where('author', '==', uid)`, My scenes); anything else is
    refused.
  - `create`: the author must be the caller; visibility `public` only.
  - `update`: author only, `author` immutable, visibility unchanged or less
    restricted.
  - Clients can never raise the visibility: the Pro entitlement includes team
    domains (a secret the rules can't read).
- **`setSceneVisibility` callable** (`public/functions/scene-visibility.js`):
  checks authorship and, to restrict a scene, the full Pro rule (`isUserProInternal`: plan claim, team domain, Project Pass).
  It never touches `updateTimestamp`, the feed's sort key.
- **`createRestrictedScene` callable**: creates an empty scene that is
  unlisted or private from the start (Pro), for copying one without it ever
  being public; the client then saves the content into it.
- **AI outputs** (`mayPostToCommunity`): posted to the community Discord only
  when made from a scene that is public at that moment, and never when a team
  paid. Without a scene (generator, unsaved) or when it can't be read: not
  posted.
- **Personal assets** (uploads and AI outputs): created `unlisted`, and the
  rules let only their owner list them. Anyone else needs the asset's id,
  which the scenes using it carry, so a private scene's assets can't be
  discovered while a public scene's keep working.
- **`getScene`** (`/scenes/UUID.json`): serves a private scene only with an
  `Authorization: Bearer <Firebase ID token>` header of its author, with
  `Cache-Control: private, no-store`; otherwise `403 { reason: 'private' }`.
- **Storage rules** (`public/storage.rules`): `scenes/{id}/files/**` of a
  private scene are readable by the author only. Download-token URLs (the
  stored `imagePath` thumbnail, uploaded assets) bypass rules by design, so a
  private scene's files stay reachable by anyone who has such a URL.

## Client

- `useStore` `sceneVisibility` is the current scene's visibility, set by every
  load path (`fetchJSON` in `json-utils_1.1.js`, the scenes modal, the MCP
  `loadScene` tool) and by saves; a new scene is public.
- Loading a private scene: `fetchJSON` gets the 403 and retries once with the
  signed-in user's ID token. Signed out, it opens the sign-in modal (whose
  message says the scene is private, from `privateSceneBlocked`) and retries
  when the user signs in.
  A signed-in non-author, or any embed (`?embed=true`), gets an error dialog.
- Share modal: a "Who can open this scene" picker for the author. Picking
  Unlisted or Private without Pro opens the upgrade modal (`private_scene` paywall
  surface). The Share button's
  padlock is closed for a private scene.
- Save As of your own scene keeps its visibility (an unlisted or private
  copy goes through `createRestrictedScene`); without Pro nothing is saved and
  the user is told. A copy of
  someone else's scene is public.
- A private or unlisted scene stays so if its author's Pro ends; they can still open,
  edit and lower it.

## Deploying

Order matters, because old clients and old scenes meet the new rules:

1. Deploy the Firestore index (`visibility` + `updateTimestamp`) and wait for
   it to build.
2. Run the backfill on the project:
   `node scripts/backfill-scene-visibility.js --project=<id>` (dry run), then
   with `--apply`.
3. Deploy functions, hosting and rules together.

A tab opened before the deploy keeps running the old code until it reloads:
its community list is empty (the new rules refuse the unfiltered query), and
scenes it creates have no `visibility`, so they stay out of the feed. Run the
backfill once more after the deploy to pick those up.

Rolling the rules back makes private scenes readable by anyone with the link
again.

## Tests

- `test/rules/scenes.rules.test.js`, `test/rules/storage.rules.test.js`
  (`npm run test:rules`, which now also starts the storage emulator).
- `test/core/scene-visibility.test.js`: who may read and who may change the
  visibility.
