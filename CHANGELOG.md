# Changelog

Human-facing notes for each 3DStreet release. See `docs/releasing.md` for how
releases are versioned and cut. Versions use CalVer (`YYYY.M.patch`); the build
SHA shown in-app (`+a1b2c3d`) identifies the exact deployed commit.

## 2026.6.0

- Adopt CalVer + git build-stamp versioning, replacing the legacy `0.5.x`
  npm-library version. The deployed build identity (`YYYY.M.patch+sha`) is now
  shown in the Profile modal and tagged on every Sentry issue.
