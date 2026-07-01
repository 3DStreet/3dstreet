# Releasing 3DStreet

3DStreet is a continuously-deployed web app, not a published library, so we
don't use semver (it exists to signal API-breaking changes to downstream
importers, of which we have none). We use two identifiers instead.

## Two identifiers, two jobs

1. **Build stamp** (`+a1b2c3d`) — the short git SHA, appended automatically to
   every build by webpack (`buildVersion()` in `webpack.config.js` /
   `webpack.prod.config.js`). It uniquely fingerprints the exact deployed
   bundle. This is what gets set as the Sentry `release`, and what a user reads
   off the Profile modal when reporting a bug. Nobody touches it by hand.

2. **CalVer base** (`2026.6.0`, `YYYY.M.patch`) — the human-facing "release."
   Lives in `package.json` `version`. Bumped deliberately, by hand, when we
   write a release blog post.

Together the app reports e.g. `2026.6.0+a1b2c3d`: the base says how fresh, the
SHA says exactly which commit.

## Cutting a release

A release == a blog post about what shipped since the last one. Between
releases the SHA advances on its own and nobody needs to touch the version; it
will look "stale" but the build stamp proves the deploy is current.

To cut one:

1. Decide the new CalVer base. Same month as the last release → bump the patch
   (`2026.6.0` → `2026.6.1`). New month → roll the date (`2026.7.0`).
2. Bump `version` in `package.json`.
3. Add an entry to `CHANGELOG.md`.
4. Commit, then tag and push:
   ```
   git tag 2026.6.0
   git push --tags
   ```
5. Publish the blog post / Discord announcement.

## Reading the version when debugging

- **In-app:** Profile modal footer shows `3DStreet 2026.6.0+a1b2c3d`.
- **Console:** logged on load by `src/index.js`.
- **Sentry:** every issue is tagged with the same string as its `release`.
