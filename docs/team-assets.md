# Team asset library (#1267 Phase 4)

A team ([orgs.md](orgs.md)) has a library of models, splats and images that
it owns, like its scenes ([team-scenes.md](team-scenes.md)): a member
leaving never takes an asset away from the team's scenes.

## Who does what

|                              | Owner, admin | Member              | Viewer |
| ---------------------------- | ------------ | ------------------- | ------ |
| See and place library assets | yes          | yes                 | yes    |
| Upload into the library      | yes          | yes                 | no     |
| Add one of their own assets  | yes          | yes                 | no     |
| Rename, edit attribution     | yes          | yes¹                | no     |
| Replace an asset's file      | yes          | yes¹                | no     |
| Remove an asset              | yes          | the ones they added | no     |

¹ Only the ones they added when the team's `memberEditScope` is `own`
([orgs.md](orgs.md#what-members-can-edit)).

- **Uploading** (the Assets panel's Upload with the team's library shown,
  or dropping a file in a team scene): the client writes the files to
  `orgs/{orgId}/assets/{assetId}/` and the doc to `orgs/{orgId}/assets`
  (`assetsService.addAsset` with `orgId`; `uploadAsset` and
  `uploadAndPlaceAsset` take `orgId`). The rules let seats create them, the
  doc naming its team and uploader (`addedBy`), every path in the asset's
  folder; Storage files are create-only. The preflight is
  `getUploadQuota({ orgId })` (the team's storage and plan). A splat is
  converted like a personal one: `onTeamSplatAssetCreated` queues the job in
  the uploader's `generationJobs` with `orgId`, and the converter writes the
  `.rad` into the asset's folder and patches the team doc.
- **Adding one's own asset** (`orgAddAsset`, "Add to {team}'s library" in an
  asset's details): the server copies the member's asset files (original,
  optimized variant or streaming RAD, thumbnail) into
  `orgs/{orgId}/assets/{assetId}/{copyId}/`, each with its own download
  token, and writes the team asset doc with the content fields (type, name,
  size, bounds, attribution...). Nothing is uploaded, optimized or converted
  again, and the member's own asset stays. A splat still being converted is
  refused until the conversion is done.
- **Renaming and attribution**: seats edit `name` and `attribution` (and add
  a missing thumbnail) from the asset's details; the rules allow only those
  fields.
- **Replacing** (`orgReplaceAssetFile`, "Replace file", then one of the
  member's assets of the same type): same copy into a new folder; the team
  asset keeps its id and name, so every scene using it gets the new file on
  its next load. Earlier files stay, for scenes opened by people outside
  the team (who can't read the team doc and use the saved URL).
- **Removing** (`orgRemoveAsset`): soft delete. The weekly asset GC
  (`scheduled/asset-gc.js`, a collection-group query) purges the current
  files after 30 days.

## A team scene uses only its team's assets

A personal asset belongs to one member: in a team scene the others can't
read it and it would leave with the member. So in a team scene
(`src/editor/lib/asset-upload/teamSceneAssets.js`):

- the Assets panel opens the team's library, and uploads go there (also a
  file dropped in the scene); other libraries are shown but not placeable,
  with a line saying why;
- `placeCloudAsset` and `replaceCloudAssetInScene` refuse any other asset,
  with a message;
- Replace in an object's info panel picks from the team's library;
- a personal asset already in the scene (e.g. a scene moved into the team)
  is flagged in its info panel; "Add to team library" from its Details puts
  the team's copy in its place.

## Scenes reference team assets by an owner key

`data-asset-owner-uid` holds an **owner key**
(`src/shared/assets/assetOwner.js`): a uid for a personal asset, or
`org:<orgId>` for a team asset. `assetsService` maps it to `users/{uid}` or
`orgs/{orgId}`, so everything that carries an asset's identity
(serialization, `resolveCloudAssetUrls`, the placeholder box, the fallback,
upload status, Replace) works for team assets unchanged. Ownership checks
compare the key with the user's uid, so a team asset is never "mine":
Reoptimize, rename and delete stay personal-only, "Copy to my library" is
offered.

## Storage

The library's limit is the plan's personal storage per seat (Pro 5 GB, Max
25 GB, times the seats). `onTeamAssetWritten` keeps
`orgs/{orgId}/meta/usage.bytesUsed` (originals only, like the personal
quota); the add and replace callables refuse past the limit
(`team-storage-full`). Team settings show "Asset library: X of Y".

## UI

- Assets panel (editor and generator): a "My assets / {team}'s library"
  switch when the user is in a team; a team scene opens its team's library
  first. Upload goes into the library shown (seats only for a team).
- Asset details (`TeamLibraryActions`, in `MeshDetailsModal` and
  `AssetsModal`): "Add to team library" on one's own assets; "Added by",
  "Replace file" and "Remove from library" on a team asset, by role.

## Data and code

- Functions: `public/functions/team-assets.js` (callables, usage trigger),
  pure rules in `team-assets-utils.js`.
- Rules: `orgs/{orgId}/assets` readable by members, created by seats (direct
  upload) and updated by them for name, attribution and thumbnail only;
  `orgs/{orgId}/meta` readable by members, written by functions; Storage
  `orgs/{orgId}/assets/**` readable by members, new files created by seats
  in an asset's folder. The app loads the files through download-token URLs.
- Client: `src/shared/assets/teamLibrary.js` (callables, permissions,
  limit), `hooks/useTeamAssets.js`, `components/TeamLibraryActions.jsx`.
- No new index: the `assets` composite indexes are collection-scoped and
  serve `orgs/{orgId}/assets` too.

## Tests

- `test/core/team-assets-utils.test.js`: limit, copies, permissions, URLs.
- `test/rules/team-assets.emulator.test.js`: add, replace, remove, refusals,
  the upload preflight, a team splat's conversion job, the orphan cleanup
  (Firestore and Storage emulators).
- `test/editor/teamSceneAssets.test.js`: which assets a scene accepts.
- `test/rules/orgs.rules.test.js`, `test/rules/team-scenes.rules.test.js`:
  library, usage and file rules.
- `test/shared/assets/assetOwner.test.js`,
  `test/shared/assets/teamLibrary-sync.test.js`.

## Cleanup

The monthly orphan cleanup (`scheduled/asset-orphan-cleanup.js`) also scans
`orgs/`: every file in the folder of a live team asset is kept (a replaced
file may still be in a scene opened outside the team); a folder whose asset
was purged, or an upload whose doc was never written, is reclaimed.
