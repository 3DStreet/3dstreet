# Team asset library (#1267 Phase 4)

A team ([orgs.md](orgs.md)) has a library of models, splats and images that
it owns, like its scenes ([team-scenes.md](team-scenes.md)): a member
leaving never takes an asset away from the team's scenes.

## Who does what

|                              | Owner, admin | Member              | Viewer |
| ---------------------------- | ------------ | ------------------- | ------ |
| See and place library assets | yes          | yes                 | yes    |
| Add one of their own assets  | yes          | yes                 | no     |
| Replace an asset's file      | yes          | yes                 | no     |
| Remove an asset              | yes          | the ones they added | no     |

- **Adding** (`orgAddAsset`, "Add to {team}'s library" in an asset's
  details): the server copies the member's asset files (original, optimized
  variant or streaming RAD, thumbnail) into
  `orgs/{orgId}/assets/{assetId}/{copyId}/`, each with its own download
  token, and writes the team asset doc with the content fields (type, name,
  size, bounds, attribution...). Nothing is uploaded, optimized or converted
  again, and the member's own asset stays. A splat still being converted is
  refused until the conversion is done.
- **Replacing** (`orgReplaceAssetFile`, "Replace file", then one of the
  member's assets of the same type): same copy into a new folder; the team
  asset keeps its id and name, so every scene using it gets the new file on
  its next load. Earlier files stay, for scenes opened by people outside
  the team (who can't read the team doc and use the saved URL).
- **Removing** (`orgRemoveAsset`): soft delete. The weekly asset GC
  (`scheduled/asset-gc.js`, a collection-group query) purges the current
  files after 30 days.
- There is no direct upload into a team library: members upload to their
  own assets, then add.

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
  first. A team library has no Upload button.
- Asset details (`TeamLibraryActions`, in `MeshDetailsModal` and
  `AssetsModal`): "Add to team library" on one's own assets; "Added by",
  "Replace file" and "Remove from library" on a team asset, by role.

## Data and code

- Functions: `public/functions/team-assets.js` (callables, usage trigger),
  pure rules in `team-assets-utils.js`.
- Rules: `orgs/{orgId}/assets` and `orgs/{orgId}/meta` readable by members,
  never written by clients; Storage `orgs/{orgId}/assets/**` readable by
  members, never written by clients. The app loads the files through
  download-token URLs.
- Client: `src/shared/assets/teamLibrary.js` (callables, permissions,
  limit), `hooks/useTeamAssets.js`, `components/TeamLibraryActions.jsx`.
- No new index: the `assets` composite indexes are collection-scoped and
  serve `orgs/{orgId}/assets` too.

## Tests

- `test/core/team-assets-utils.test.js`: limit, copies, permissions, URLs.
- `test/rules/team-assets.emulator.test.js`: add, replace, remove, refusals
  (Firestore and Storage emulators).
- `test/rules/orgs.rules.test.js`, `test/rules/team-scenes.rules.test.js`:
  library, usage and file rules.
- `test/shared/assets/assetOwner.test.js`,
  `test/shared/assets/teamLibrary-sync.test.js`.

## Not yet

- Renaming a team asset, and editing its attribution.
- Picking team assets in "Replace" from a scene entity's info panel.
- The orphan cleanup (`scheduled/asset-orphan-cleanup.js`) scans `users/`
  only, so files a replace left behind in a team folder are kept.
