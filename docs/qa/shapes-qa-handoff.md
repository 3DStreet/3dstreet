# Handoff: Shapes Branch QA + Street Fill Prototyping

**Branch:** `shapes` (PR #1920) · **Written:** 2026-08-24 · **Status:** all
work committed locally, not pushed at time of writing

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

| Commit | What |
| --- | --- |
| `d20c00a2` | Street gizmos ported from the lab branch (`claude/gizmo-prototypes-3d-ui-2w5szw`), reworked additive + always-on: **endpoint nodes** on managed streets (#1096) and **segment width handles** (#1218). Standard TransformControls gizmo kept for everything. New managed streets now created with `street-align: length: middle` (explicit at creation sites, NOT a schema default — old scenes serialize `street-align: ""` and would shift by half their length if the default changed). Docs: `docs/gizmo-prototypes.md`. |
| `e1f0b2ee` | **Street Fill v1 (naive)** + **Direction • Reverse**. `src/editor/lib/streetFill.js` + a dropdown in `ShapeSidebar.js`: assign a managed street to a polyline; one clone per segment, start endpoint on the vertex (via `street-align length: end`), no elbow/miter geometry. 'None' clears; state derives from the wrapper's `data-street-fill`/`data-street-fill-source` attributes, nothing persisted in the shape schema. Reverse swaps vertex order (one `multi` undo step) and auto re-fills — fixes the mirrored-cross-section problem when a line was drawn the "wrong" way. |
| `c4fa9a82` | The user story / QA findings doc. |

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
   proposal (shapes already export — the *proposal streets* pass is untested).

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
