# Archetypal User Story: Proposal from an Email with an Annotated Photo

**Status:** QA in progress against `shapes` branch (PR #1920)
**Logged:** 2026-08-23

## Persona

A non-technical manager at a local organization (city staff, neighborhood group,
or advocacy org). Comfortable with email and printed maps; not a CAD or 3D user.
They communicate street improvement ideas with the minimum possible artifact:
sometimes a few photos and a text prompt, sometimes just an email. In this case,
the prompt is *handwritten on the photo itself*.

## The input (anonymized)

An email, subject "3D Street for Laguna Honda?", body:

> One thing I forgot to show you today was the idea for Laguna Honda. I've
> attached it below. Let me know your thoughts!

Attachment: a photo of a **printed Google Maps aerial** of Laguna Honda Blvd
(San Francisco), the stretch running along the Laguna Honda Reservoir south
from Clarendon Ave. Marker annotations in teal:

- a line traced along the **east side** of Laguna Honda Blvd, following the
  reservoir curve, terminating in an arrow at the bottom of the frame
- a small **circle** at the Clarendon Ave intersection

Handwritten below the map:

> Two-way bike + ped path on east side
> Roadway moves to west side
> Roundabout at Clarendon

## The ask, interpreted

Produce a shareable 3D concept of Laguna Honda Blvd (Clarendon Ave southward
along the reservoir) where:

1. The **roadway shifts to the west side** of the right-of-way
2. A **two-way bike + pedestrian path** occupies the **east side** (reservoir
   side), following the road's curve
3. A **roundabout** replaces the signalized intersection at Clarendon Ave

## QA flow: the classic tutorial, modernized

The historical 3DStreet tutorial started from a Streetmix import. This flow
replaces it: start from the real world, measure what's there with the polyline
tool, and build an editable street from the measurement. No Streetmix required.

Steps marked **[exists]** are manual QA of the `shapes` branch today. Steps
marked **[NEW]** do not exist yet — hitting them is the point: they get logged
as feature gaps with enough context to become dev tasks. **[LATER]** items are
out of scope for this session.

### Phase A — Match location and perspective [exists]

1. Look up the site manually in the geospatial UI (Google 3D Tiles, Laguna
   Honda Blvd & Clarendon Ave, SF).
2. Use camera position/rotation controls to match the perspective of the
   user's annotated aerial photo.
3. Find a straight section of the target roadway; save the scene so the camera
   returns to this position on reload.

### Phase B — Measure the roadway, create an editable street

1. **[exists]** Draw a multi-segment polyline cross-wise against the target
   street — one vertex at each visible lane edge — measuring the existing
   cross-section against the 3D tiles.
2. **[NEW: convert to street]** A "convert to street" affordance on the
   polyline: a dropdown per segment assigns a type (sidewalk, parking, bike
   lane, drive lane, …), then a button creates a managed street whose segment
   widths come from the polyline's segment lengths.
3. Name it "Current Conditions Laguna Honda Blvd"; duplicate it and rename the
   copy "Proposed Conditions Laguna Honda Blvd".

### Phase C — Edit to the target configuration [exists, with a gap]

1. On the proposed street: move the two bike lanes to be adjacent on the east
   side (reservoir side).
2. Modify other lane widths; add/delete/edit segments as needed.
3. **[NEW: target width]** Gap to log: managed-street schema needs a
   **Target Width** so the user can change segment count/types/widths and be
   visually notified when the total over- or under-shoots the original
   right-of-way. Streetmix tablestakes.

### Phase D — Lay the street along the real roadway

1. **[exists]** Draw a polyline following the roadway from the start point
   (traffic circle) to the end of the corridor.
2. **[NEW: fill with street]** A "fill with street" feature: pick a managed
   street from the scene; it is cloned along each segment of the polyline
   path.
3. **[NEW: curves]** A switch for curved interpolation along the path instead
   of hard segment joints with no transition. Long-term important; expected to
   be the hardest of the three.

### LATER (future stories, or appended here)

- In shapes mode, extend a street's path before/after its current extent
- Traffic circle / roundabout at Clarendon
- Plan-view PDF/DXF export of the proposal

## Findings

Log pass/fail plus friction at each step. Friction counts even when a step
succeeds: anything requiring insider knowledge is a product gap for the
archetype user, not a pass.

| Phase.Step | Result | Notes |
|------------|--------|-------|
| A.1 geo lookup | PASS | Manual lookup, Laguna Honda Blvd & 7th Ave (37.7538934, -122.4638265) |
| B.1 cross-section polyline | PASS | 8 segments drawn cross-wise over 3D tiles; per-segment lengths + angles shown in properties panel. Measured widths came out highly plausible for this block (two ~11' drive lanes, buffered bike lanes, total 47'7" / 14.50 m) |
| B.1 friction | GAP (minor) | Lengths display as decimal feet (7.17ft); street-measurement convention is feet+inches (7'2") |
| B.2 convert to street | GAP (confirmed) + simulated | Feature doesn't exist; simulated via MCP `managedStreetCreate` using the polyline's 8 segment lengths + hand-assigned types → sidewalk / bike / buffer / drive / buffer / drive / buffer / bike, total width 14.502 m. Data on the polyline is sufficient to drive the future button. |
| B.2 learnings for the button | NOTE | (1) The button must derive street *placement + orientation* from the polyline: spawned street came in axis-aligned and needed a hand rotation (90°, then −90°) to run along the roadway. The cross-line's own direction defines the street's perpendicular. (2) Segment order ↔ side handedness matters: which end of the line is vertex 1 decides which side the sidewalk lands on — first try put it on the wrong side. Button UI needs an in-scene preview or flip control. (3) geo-flatten auto-attach worked: terrain snapped flush under the new street with no manual step. |
| B.2 measure-line → street overall | HARDER THAN EXPECTED | The conversion concept works, but orientation + vertex-order handedness made it a multi-step, guess-and-check process even for an expert operator driving via MCP. The future button must solve both automatically or the archetype user is lost here. |
| B.2 per-type visual defaults | GAP (debug) | Street created from measurements had correct semantic segment types, but the visual display was bare: no green bike-lane surface, no stencils, no lane striping. Operator had to hand-edit each segment afterward. Whatever path creates a street from a measurement (MCP today, convert-to-street button later) must apply the same per-type visual defaults (colors, stencils, striping) the segment-editor UI applies when adding a segment of that type. Not a deal breaker, but annoying; deserves its own debugging pass. |
| D.1 path polyline | PASS | Open polyline drawn along the roadway with the draw tool |
| D.2 fill with street | BUILT + PASS (naive v1) | Built this session (`lib/streetFill.js` + ShapeSidebar dropdown, commit `e1f0b2ee`). One street clone per polyline segment, start endpoint on the vertex, no joint geometry. Human-verified in-browser on the Laguna Honda corridor: works, and the naive joints on curves "look ok from a distance" — better than expected. |
| D.2 direction handedness | FIXED via Reverse | First fill came out mirrored (drawing order decides which side the cross-section lands). Added Direction • Reverse on the shape (single undo step, auto re-fills). Same fix addresses the B.2 vertex-order handedness finding. |
| D.2 UX debt | NOTE | Whole flow works but is a "UX mess" (operator's words): dropdown-as-action, snapshot fills that don't follow vertex edits, no joint geometry, direction discovered by trial. Logged for a design pass, not a blocker for prototyping. |
| D.3 curves | GAP (open) | Not started. Naive straight segments acceptable at distance viewing; curve interpolation remains the long-term item. |

## Related tooling ported mid-session

To support Phases C and D, two gizmo prototypes were ported onto `shapes`
from the gizmo prototype lab branch (commit `984c2d89`, from
`claude/gizmo-prototypes-3d-ui-2w5szw`): **street endpoint nodes** (#1096,
drag a street's ends to reposition/rotate/lengthen it) and **segment width
handles** (#1218, drag a segment edge to resize it). Enable via
View → Gizmo Prototypes (Lab). See `docs/gizmo-prototypes.md`.
