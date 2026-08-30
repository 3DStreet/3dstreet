# Shapes / curved streets: review follow-ups

Open items from the 2026-08-29 code-review pass on the `shapes` branch
(PR #1920). The critical fixes from that pass landed in `3e364a82`.

Resolved 2026-08-30 (see git log for the commit):

- **Convert to Shapes on a path-following street** no longer bakes an
  invisible layer: the sidebar refuses with a toast when the street has an
  active curve. Curve-preserving conversion is deferred to #1720
  (managed-street → shapes QA).
- **Curved striping honors `facing`**: the ribbon branch mirrors the texture
  (`repeat: -1 n; offset: 1 0`) when facing is 180.
- **`multi` payloads** now go through the transform guard (each member
  tuple is checked; the batch is refused as a whole).
- **`street-curve-changed` listener** self-detaches when the segment moves
  under a different parent, not only when it leaves the DOM.

## Lower-severity items from the same pass (not started)

- Closed-loop seam vertex is never mitered: `getRingStations` excludes
  vertex 0 at both s=0 and s=L (`src/tested/street-path-utils.js` ~322);
  notched outer edge + inner wedge at one corner on every ribbon and the
  plan-export outline.
- Curved grass segments lose top-only sampling and rebuild every layout
  event: primitive check only knows `box`/`below-box`
  (`street-generated-grass.js` ~144).
- Migrated ruler vertices lack class `hideFromSceneGraph`
  (`src/tested/migrate-measure-lines.js` ~48).
- Double regeneration per curved-street rebuild (length cascade +
  `street-curve-changed`; `managed-street.js` ~703 / `street-segment.js`
  ~366).
- Right/middle-click commits a draw vertex (`ShapeDrawAction.jsx` ~513).
- Follow-Path assignment is two undo entries, not one multi
  (`ManagedStreetSidebar.jsx` ~75).
- Corner Radius input can't be cleared/retyped (`ShapeSidebar.jsx` ~719).
- Re-selecting the shape tool mid-draw swaps crosshair for grab
  (`ActionBar.component.jsx` ~51).
- Collinear closed rings get an empty fill and a "0.00 m²" label
  (`shape.js` ~679).
- `querySelector('#' + id)` throws for non-CSS-identifier ids
  (`managed-street.js` ~600).
- json-utils drops `material` for segments (`json-utils_1.1.js` ~176).
- Hygiene: camelCase `polygonMath.js` / `shapeFillRender.js`;
  `docs/shapes.md` says `ShapeSidebar.js` (file is `.jsx`); the two
  session-scoped `docs/qa/*.md` files are committed as durable docs.
