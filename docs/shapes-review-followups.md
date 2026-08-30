# Shapes / curved streets: review follow-ups

Open items from the 2026-08-29 code-review pass on the `shapes` branch
(PR #1920). The critical fixes from that pass landed in `3e364a82`.

## 1. Convert to Shapes on a path-following street produces an invisible layer

**Where:** `src/editor/lib/convertToShapes.js` (~line 137).

**What happens:** `includeAutocreated` bypasses the `ownsMesh` skip, so each
lane's `street-ribbon` `geometry` attribute is serialized into the converted
"Street Shapes" layer while `managed-street` is stripped from the root. On
rebuild, `street-ribbon` init does
`getElementById(streetId)?.components['managed-street']?.streetCurve`, gets
`undefined`, and returns an empty `BufferGeometry`. No error, and it recurs on
every save/reload of that scene. Straight streets are unaffected.

**Repro:** assign a shape as `managed-street.path`, run Convert to Shapes:
the converted layer is invisible.

**Fix direction (pick one):**
- Skip `street-ribbon` geometry when serializing the converted layer (treat
  it like the other `ownsMesh` geometry) and let the converted segments fall
  back to their straight box geometry; or
- Keep enough of the curve on the converted root (e.g. retain
  `managed-street` with `path`) so the ribbons can re-resolve.

The first is simpler; the second preserves the curved look. Decide based on
what Convert to Shapes is meant to freeze.

## 2. Curved striping ignores `data.facing` (solid/dashed sides swap)

**Where:** `src/aframe-components/street-generated-striping.js` (~line 99,
the `ribbonAttr` branch in `update`).

**What happens:** the straight branch applies `data.facing` as the plane's
Y rotation, which is how `managed-street` mirrors `striping-solid-dashed`
(`facing: 180` on a drive lane that follows a `turn-lane` with variant
`shared`, see `managed-street.js` ~line 2002). The ribbon branch only sets
position, and the ribbon's UV v always runs 0..1 along s, so on a bent street
the solid line ends up on the dashed side and vice versa. Any user-set
`facing` on striping is ignored the same way.

**Repro:** `#fixture:downtown-main-street` (dev only): segment 8 is
`turn-lane inbound|shared` followed by a drive lane. Note which side the
solid line is on, draw a bent shape, assign it as the street's path, and the
sides swap. `#fixture:kfarr-demo-street-v34` (segment 16) also reproduces.

**Fix direction:** in the ribbon branch, when `facing` is 180 flip the
texture across the stripe (either set `material.repeat` to `-1 repeatY` with
an offset of 1, or pass a `flipU` option through `getRibbonGeometryAttr` /
`buildRibbonGeometry` to mirror the u coordinate). Also handle the mirror
texture id (`striping-solid-dashed-mirror` exists in `assets.js`) if that
turns out to be the cleaner path.

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
- `multi` payloads bypass the transform guard (`transformGuard.js` ~76).
- `street-curve-changed` listener survives `remove()`/reparent
  (`street-segment.js` ~361).
- `querySelector('#' + id)` throws for non-CSS-identifier ids
  (`managed-street.js` ~600).
- json-utils drops `material` for segments (`json-utils_1.1.js` ~176).
- Hygiene: camelCase `polygonMath.js` / `shapeFillRender.js`;
  `docs/shapes.md` says `ShapeSidebar.js` (file is `.jsx`); the two
  session-scoped `docs/qa/*.md` files are committed as durable docs.
