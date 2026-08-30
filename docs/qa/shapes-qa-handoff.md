# Handoff: Shapes Branch QA + Street Fill Prototyping

**Branch:** `shapes` (PR #1920) · **Written:** 2026-08-24 · **Status:** all
work committed locally, not pushed at time of writing

> **2026-08-25 update — curved streets landed, street fill removed.** The
> Phase D.3 "curves" item below (and much around it) is superseded by the
> `claude/curved-street-path-prototype-7e5sqj` branch, intended to PR into
> `shapes`. See the **Curved street path session** section at the bottom;
> the original text is kept for history but read it through that lens —
> in particular, Street Fill (commit `e1f0b2ee`) has been REMOVED.

> **2026-08-26 update — merged; beta-prep underway on `shapes`.** The
> curved-street branch merged into `shapes` via PR #1924 and is defunct
> (reset to its merged tip; remote deleted). All work continues on
> `shapes` directly. See the **Beta-prep session** section at the very
> bottom for what shipped since the merge and the remaining beta list.

Purpose: enough context for a fresh session (human + Claude) to continue QA
and prototyping against real-world use cases without re-deriving anything.

## What this covers

The archetypal user story and its QA flow live in
[`user-story-annotated-photo-email.md`](./user-story-annotated-photo-email.md)
— read that first. Short version: a non-technical manager emails a printed
aerial photo of Laguna Honda Blvd (SF) with a marker line and three
handwritten sentences (two-way bike+ped path on the east side, roadway to
the west, roundabout at Clarendon). The QA flow is the "classic tutorial,
modernized": locate the real place, measure the existing roadway with the
polyline tool, build an editable street from the measurement, lay it along
the real corridor. Findings so far are in that doc's table.

## What was built this session (all on `shapes`)

| Commit     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d20c00a2` | Street gizmos ported from the lab branch (`claude/gizmo-prototypes-3d-ui-2w5szw`), reworked additive + always-on: **endpoint nodes** on managed streets (#1096) and **segment width handles** (#1218). Standard TransformControls gizmo kept for everything. New managed streets now created with `street-align: length: middle` (explicit at creation sites, NOT a schema default — old scenes serialize `street-align: ""` and would shift by half their length if the default changed). Docs: `docs/gizmo-prototypes.md`.                                                         |
| `e1f0b2ee` | **Street Fill v1 (naive)** + **Direction • Reverse**. `src/editor/lib/streetFill.js` + a dropdown in `ShapeSidebar.js`: assign a managed street to a polyline; one clone per segment, start endpoint on the vertex (via `street-align length: end`), no elbow/miter geometry. 'None' clears; state derives from the wrapper's `data-street-fill`/`data-street-fill-source` attributes, nothing persisted in the shape schema. Reverse swaps vertex order (one `multi` undo step) and auto re-fills — fixes the mirrored-cross-section problem when a line was drawn the "wrong" way. |
| `c4fa9a82` | The user story / QA findings doc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Human-verified in-browser on the Laguna Honda corridor: measure → street →
duplicate → fill along path → reverse all work. Naive joints on curves look
acceptable from typical viewing distance — the prototype's key surprise.

## Test environment recipe

1. `npm start` → http://localhost:3333, branch `shapes`.
2. Test scene: **"Shapes Laguna Honda Demo"** (scene id
   `1a594532-8938-4ac4-9800-861f3f11429d`, dev Firebase), geo at Laguna
   Honda Blvd & 7th Ave, SF (37.7538934, -122.4638265, source: manual).
3. For Claude-driven QA, open `https://3dstreet.app/#mcp` (or the localhost
   equivalent hash) to pair the tab with the MCP relay; then
   `takeSnapshot` / `getScene` / `managedStreetCreate` etc. work from the
   session. `getScene` + reading vertex positions is how the cross-section
   was measured; `managedStreetCreate` is how the missing
   "convert to street" button was simulated.

## Known gaps / next work (rough priority)

1. **Convert-to-street button** (Phase B.2): the polyline data is proven
   sufficient. The button must derive placement + orientation from the
   cross-line itself and preview side-handedness (see findings B.2). Per-type
   visual defaults (green bike lanes, striping, stencils) must come from a
   shared preset library — the MCP/json-blob path currently produces bare
   geometry (findings "per-type visual defaults").
2. **Target Width** on managed-street (Phase C.3): notify visually when
   segment edits over/under-shoot the original right-of-way. Streetmix
   tablestakes.
3. **Street Fill UX pass**: dropdown-as-action is a placeholder; fills are
   snapshots (vertex edits don't re-lay; no auto-refill except on Reverse);
   no joint geometry. Design before polishing.
4. **Curves** (Phase D.3): curved interpolation along the fill path instead
   of hard joints. Hardest item; explicitly deferred.
5. **Decimal feet display**: shape lengths read `7.17ft`, convention is
   `7'2"`.
6. **LATER bucket**: extend a street path before/after in shapes mode;
   roundabout/traffic circle at Clarendon; plan-view PDF/DXF export of the
   proposal (shapes already export — the _proposal streets_ pass is untested).

## Suggested next-session QA scripts

- **Re-run the archetype end-to-end** with fresh eyes: new scene, new
  location (pick a different real corridor — e.g. a gridded street with
  parking, to exercise parking-lane measurement), no MCP crutches except
  where a gap is being simulated deliberately. Log new findings in the user
  story doc's table.
- **Street Fill stress tests**: closed polylines (loop roads), 2-vertex
  lines, very short segments (< street width), filling with a street whose
  source was itself edited per-segment, undo/redo ordering (fill → reverse →
  undo ×3), save/reload a scene containing fills (wrappers + clones are
  plain entities and should round-trip — untested).
- **Gizmo regression pass**: endpoint nodes + width handles on the filled
  clones (they are real managed streets — dragging an endpoint of a fill
  clone desyncs it from the polyline by design; decide if that's fine).
- **Save/reload the whole demo scene** and verify camera, shapes, fills,
  streets, and `street-align: middle` defaults all round-trip.

## Watch out for

- Untracked files were lost once this session on a branch/repo switch
  (`docs/shapes-merge-prep.md` is gone for good). Commit docs early.
- `npm run test:rules` needs JDK 21 on PATH (see CLAUDE.md) — irrelevant to
  this work but bites if touched.
- The lab branch (`claude/gizmo-prototypes-3d-ui-2w5szw`) still holds the
  unported prototypes (#1674 simplified gizmo, #1446 ground clamp) and the
  #1806 segment-gizmo suppression.

## Curved street path session (2026-08-25)

**Branch:** `claude/curved-street-path-prototype-7e5sqj` (based on the
`shapes` tip above; assume it PRs into `shapes` and work continues there).
**Entry point:** [`docs/curved-street-path.md`](../curved-street-path.md)
carries the architecture, event flow, and known limitations — this section
is just the QA-facing delta.

### What changed, in order

| Commit    | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4ef01ce` | **Path following (Phase D.3, inverted).** A managed street gains `managed-street.path` → a drawn shape; the whole street bends along it as ONE continuous street (surfaces, striping, rails, ground, clones, stencils, pedestrians). The PATH owns the curve controls (`street-path` component: smooth centripetal Catmull-Rom / arc fillets with clamped radius / linear). Length tracks arc length; live re-lay on vertex edits and drags of either entity; closed shapes = loop streets. Endpoint/width gizmos suppressed on pathed streets. |
| `75993a4` | **Curve-aware editor & play.** Hover/selection highlight conforms to the curved lane meshes (was the AABB); `street-curve-changed` bubbles so live helpers refresh; slope segments tilt on curves (ribbon cross-tilt, below-box parity); play traffic follows the curve (straight-pose stamps + per-tick re-bend, determinism preserved); street-label sits at the curve end, yawed to the exit tangent.                                                                                                                                        |
| `e2f60cc` | **The shape draws (and exports) its curve.** The polyline outline — and a closed shape's fill/area — renders through the SAME `buildCenterlinePoints` the street uses, so path and street visibly trace one centerline. Curve Style is a standalone shape-sidebar control (attaches `street-path` on demand, no street needed). Plan DXF/PDF/SVG exports curves: shapes as sampled centerlines, curved streets as ribbon-edge outlines with polyline curbs, loops as annulus rings.                                                             |
| `1cf1897` | **Street Fill removed** (`lib/streetFill.js` + sidebar dropdown). Superseded by path following; `linear` curve style reproduces the hard-cornered look as one street. Direction • Reverse stays (now flips path direction; following streets re-lay automatically). Old scenes with fills still load (wrappers were plain entities).                                                                                                                                                                                                            |

### How to try it

`npm start`, then: build any managed street → draw a polyline with the
shape tool → select the street → **Follow Path** → pick the shape. Curve
style/radius live on the SHAPE's sidebar. **Shift-drag a vertex handle to
raise/lower it** — the path (and any street following it) ramps along the
vertical profile; note cross-sections stay level (no banking) and clones
get no pitch, so keep grades gentle. Everything is covered by
headless end-to-end verification (see the commit messages for what each
round asserted) plus unit suites: vitest 1008 / mocha 196 / browser
components 74, all green.

### Next-session QA scripts (updated)

- **Re-run the Laguna Honda archetype with path following**: measure the
  corridor with the polyline, build the street, Follow Path onto the
  measurement line — the flow street fill was standing in for. Log
  findings in the user story doc's table.
- **Human-driven passes on what's only machine-verified**: vertex-drag
  responsiveness on long streets (rebuilds are throttled ~250ms), undo/redo
  ordering (assign → restyle → reverse → undo ×3), save/reload a curved
  scene (path resolves by id with retries — untested against slow loads),
  drive mode on a curved street (wheels ride the real meshes; untested).
- **Boundary segments on curves** are explicitly unsupported/untested.
- **DXF arc entities deferred by decision**: arc-mode fillets export as
  tessellated polylines. Emitting true ARC/bulge output is queued behind
  SME-provided acceptance criteria + iterative testing against a real
  AutoCAD session (MCP-driven) — don't start it without that harness.

### Open architecture question for the next session

Should a managed street BE a path, rather than follow one? The endpoint
gizmos already treat a straight street as a 2-vertex path; an intrinsic
centerline (street-owned vertices, insert-vertex-to-bend, external shapes
becoming an import/link) is the natural convergence — see the discussion
in the PR / session notes before starting Phase 2 work.

## Beta-prep session (2026-08-25/26)

**Branch:** `shapes` — PR #1924 merged the curved-street branch in; that
branch is now defunct (reset to its merged tip, remote already deleted).
Goal of this pass: the "must have to ship a beta (behind a menu)" list.

### Landed via the merge tail (last commits of the old branch)

| Commit     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1317df54` | Shape entities get a custom icon in the scene graph + properties panel: `ShapeIcon` in `street-icons.jsx` (toolbar glyph recolored cyan/white to the managed-street icon language) wired via `getEntityIcon` in `editor/lib/entity.js`. One branch covers both surfaces (both render through `EntityLabel`).                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `e364bbcb` | Draw tool starts unclosed: `shapeDrawMode` store default flipped `'auto'` → `'manual'` (session-only, not persisted); sidebar radio order matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `2dc907b1` | **The shape owns its curve.** `curveType`/`filletRadius` moved off `street-path` onto the `shape` schema; `street-path` is now a schema-less role component (eventing + system registration + ribbon helpers, reads curve props via `getCurveOptions()`). `curveType` defaults to `linear`; assigning a shape via Follow Path bumps it to `smooth` ONCE, at the gesture in `ManagedStreetSidebar` — never on scene load, so a deliberate linear choice survives reload (side effect: fully undoing an assignment is two Ctrl+Z). `filletRadius` default 6 → 20 (6m rounds ~2.5m off a right angle — invisible at street scale). **No migration for pre-move scenes by decision** (never released; they load straight with console warnings). |

### Landed on `shapes` since the merge

| Commit     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a26095b6` | Core bundle back under its 4.0 MiB CI budget (was 4.02): svg-extruder lazy-loads the vendored SVGLoader; six illustration-grade icon SVGs (~107 KiB of `@shared/icons`, `GeospatialIcon` alone 41.6 KiB) moved to `ui_assets/icons/` as `<img>`-backed components (same export names, no call-site changes; the unused `GeospatialIconWhite` deleted). Core now 3.90 MiB. Dead end documented in the commit: `sideEffects` tree-shaking of icons recovers nothing. |
| `8214350c` | Load crash on curved-street scenes fixed: batching's BVH pass read `attributes.position.count` on an empty BufferGeometry — which `street-ribbon` legitimately builds when a segment initializes before its street's curve resolves. Now skipped. Verified against the failing cloud scene (`31ed37d0…`).                                                                                                                                                          |
| `f730af6b` | i18n CI failure fixed: the workflow re-extracts `en.json` before its drift check, so the two `managedStreetSidebar.followPath*` strings (path-following hint + "None (straight)" option) failed PR #1920's `Check / refresh translations` job. Re-extracted, translated by hand for es/pt-BR/fr (no local API key), manifest updated. `npm run i18n:extract && npm run i18n:check` is the local repro for any future string additions.                             |

### Beta must-have list — status

- ~~Shape icon in scene graph + props panel~~ DONE (`1317df54`)
- ~~Start unclosed by default~~ DONE (`e364bbcb`)
- **Help tip edit — KF** (copy lives in `ShapeDrawInstructions` /
  `ShapeSidebar.js`; the ActionBar button tooltip too)
- **Hide transform gizmo on shape selection** — agreed approach: skip
  `attachStockGizmo()` for entities with a `shape` component in
  `attachControlsForSelection()` (`viewport.js` ~751), KEEPING the numeric
  transform rows (the gizmo is currently the only whole-shape move, so
  the panel rows are the interim mover; whole-shape drag is the eventual
  replacement). Not yet implemented.
- **Beta gate** — agreed shape: "Shapes (Beta)" checkbox in the View menu
  writing a persisted pref + `?shapes=on` URL override (nav-scheme
  pattern in `nav-experimental/flag.js`, but no reload needed if the
  ActionBar reads the store); hide the shape tool button when off. Not
  yet implemented.
- **Backward compat**: the saved contract is `shape` props (incl.
  curveType/filletRadius), `shape-vertex` children, schema-less
  `street-path`, and `managed-street.path` (`#id` selector). Policy:
  post-beta changes to these ship a load-time migration
  (`migrateLegacyFlatteningShape` in `json-utils_1.1.js` is the
  precedent), never a silent break.

- ~~Ruler/measure-line → shape migration~~ DONE (`9dfa9f79`): every
  saved `measure-line` becomes a 2-vertex open shape at load
  (`src/tested/migrate-measure-lines.js`, beside
  `migrateLegacyFlatteningShape`). The ruler tool, its sidebar, its
  gizmo and the component itself are deleted; shapes replace it outright,
  no beta gate.

### Decided against (don't re-open without new evidence)

- **Beta gate for shapes**: shapes strictly supersede the ruler they
  replace, so they ship to everyone; future changes to the saved contract
  get a load-time migration rather than a flag.
- **Pre-release street-path curve-prop migration**: written, verified,
  then removed — pre-move scenes were never public.
- **Icon tree-shaking via `sideEffects`**: recovers ~nothing; the six
  big files were the problem, now moved out.

### Verification notes

Every change above was verified in-browser against the live dev server
(headless Playwright driving localhost:3333): the curve-props move ran a
16-check pass (draw default, smooth bump, arc-length tracking, linear
persistence, serialization defaults-stripping), and the batching fix was
confirmed against the exact crashing cloud scene. The check scripts lived
in the session scratchpad (gone with the session); the commit messages
record what each pass asserted.
