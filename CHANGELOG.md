# Changelog

Human-facing notes for each 3DStreet release. See `docs/releasing.md` for how
releases are versioned and cut. Versions use CalVer (`YYYY.M.patch`); the build
SHA shown in-app (`+a1b2c3d`) identifies the exact deployed commit.

## 2026.8.0

- **Play mode & driving sim.** Unified Viewer with a Start/Stop play lifecycle
  (#1812): drive a car through your scene with keyboard or gamepad (Rapier
  physics), race a finish gate with local best times, and watch animated
  traffic that mirrors the vehicles you placed while editing (#1845). Scenes
  can also replay real roadside-sensor traffic manifests (#1875, #1878).
  Anyone with view access can press Start — no edit permission needed.
- **Localization.** The editor UI now ships in Spanish, French, and Brazilian
  Portuguese (#1747, #1776, #1857), and account emails arrive in your language
  too (#1854).
- **Export overhaul.** New Export modal (#1811) with DXF and PDF plan-view
  export (Pro) covering the whole scene (#1821, #1852), `.managed-street.json`
  export with round-trip import (#1809), GLB export fixes for the new batching
  system (#1794–#1796), and a blocking progress indicator (#1798).
- **Editing quality-of-life.** Edit menu with copy/cut/paste for streets,
  segments, and entities (#1814); inline scene-title rename (#1808); Convert
  to Shapes turns a whole managed street into plain editable entities (#1822);
  snapshot camera focus and auto-named clones (#1778); first-class
  geometry/material sidebar plus an animated grass generator (#1756).
- **Managed streets.** Boundary import with a layout model, metric elevation
  migration, per-segment content toggles, and segment slope (#1792).
- **Geospatial.** Terrain flattening volumes via the new `geo-flatten`
  component — streets flatten 3D tiles under their footprint by default
  (#1902); map opacity control and a `3d-tiles-renderer` 0.5.0 performance
  upgrade (#1862); "Use My Location" and typed-address fixes in the Geo modal
  (#1899, #1903).
- **Performance.** Runtime batching of repeated models cuts draw calls
  dramatically in dense scenes (#1755); faster navigation raycasts (#1855) and
  frame-rate-independent wheel zoom (#1859), plus a round of nav fixes
  (#1851, #1868, #1881).
- **Platform.** Upgraded to A-Frame 1.8.0 / three.js r184 (#1801).
- **AI Generator.** Medium-based tabs with async image→3D model generation via
  Hunyuan3D and TRELLIS (#1779); all image generations now run as background
  jobs that survive a closed tab, with optional outcome emails (#1836);
  stylistic render presets like watercolor, blue pencil, and street diagram
  (#1846).
- **Accounts.** Lifecycle emails with per-category unsubscribe (#1819);
  self-service one-time generation-token packs for paid plans (#1905, #1909).
- **Bollard Buddy Web.** Browser-based AR street capture via 8th Wall, with
  iOS-first CTAs and a photo→AI flow (#1793).

## 2026.6.0

- Adopt CalVer + git build-stamp versioning, replacing the legacy `0.5.x`
  npm-library version. The deployed build identity (`YYYY.M.patch+sha`) is now
  shown in the Profile modal and tagged on every Sentry issue.
