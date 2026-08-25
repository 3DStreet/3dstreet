# Handoff: Shapes Branch QA + Street Fill Prototyping

**Branch:** `shapes` (PR #1920) · **Written:** 2026-08-24 · **Status:** all
work committed locally, not pushed at time of writing

> **2026-08-25 update — curved streets landed, street fill removed.** The
> Phase D.3 "curves" item below (and much around it) is superseded by the
> `claude/curved-street-path-prototype-7e5sqj` branch, intended to PR into
> `shapes`. See the **Curved street path session** section at the bottom;
> the original text is kept for history but read it through that lens —
> in particular, Street Fill (commit `e1f0b2ee`) has been REMOVED.

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
