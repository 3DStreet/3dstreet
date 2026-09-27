# Per-object detach from managed-street generators

Tracking issue: [#2011](https://github.com/3DStreet/3dstreet/issues/2011)
(part of the managed-street epic [#1720](https://github.com/3DStreet/3dstreet/issues/1720),
§3.75 "streets to shapes").

Users who import a street most often want to move **one** car, tree or
stencil. Under `managed-street` the generated clones are `autocreated`, carry
`data-no-transform` and are regenerated on every update, so a drag did nothing
and the only way out was whole-street **Convert to Shapes** (#1215). Per-object
detach closes that gap: one object leaves its generator and becomes a plain
entity the user owns, while the rest of the street stays managed.

## How it works

The `street-generated-clones`, `street-generated-stencil` and
`street-generated-pedestrians` generators rebuild every clone deterministically
(fixed mode from `spacing`/`cycleOffset`, random mode from the persisted
`seed`). Each clone is laid out at a **straight-space placement**: an `x`
across the segment and a `z` along it, computed before any bending onto a
curved street path. That placement identifies the clone; a detach leaves a
**hole** there.

- **Generator side** (`src/tested/clone-slots.js`, pure + unit-tested): each of
  the three generators has a `skip: {type: 'array', default: []}` property
  holding `"x z"` placement keys (millimeter precision, matched within 1 cm).
  `update()` starts a slot counter (`createSlotCounter(this.data.skip)`); for
  every clone it would create it calls `next(x, z)` with the straight-space
  placement, and a placement on a hole is counted but not created. Every
  created clone is stamped `data-clone-index` (creation order, used to
  address a clone) and `data-clone-key` (its placement) next to
  `data-parent-component`. Seeded draws (model pick, random facing,
  pedestrian position/variant/facing) happen **before** the counter is
  consulted, so a skipped placement consumes the same RNG calls it would have
  and the clones after the hole keep their layout.
- **Editor side** (`src/editor/lib/detachClone.js` +
  `src/editor/lib/commands/DetachCloneCommand.js`): `detachclone` is one
  undoable command composed from two existing ones — an `entityupdate` that
  appends the clone's placement key to the generator's `skip` (the generator
  regenerates minus that placement, removing the clone) and an `entitycreate`
  of a plain entity under the same segment with the clone's mixin, position
  and rotation (plus a stencil's own `geometry`/`polygon-offset`/
  `batch-member`), layer name `Detached Model • <mixin>`, no `autocreated`
  class, no `data-no-transform`. Undo removes the plain entity and restores
  the hole, so the generator puts the clone back exactly where it was, and
  reselects it.
- **Persistence:** nothing new. `skip` saves with the generator config (and
  round-trips through Managed Street JSON export/import like any schema
  property); the detached entity saves as an ordinary segment child; on load
  the generator regenerates minus that placement.

### Why holes are keyed by placement, not by slot index

The rule a user can hold in their head: *the generator stops placing an
object at that spot; if its layout later changes so that nothing lands there
any more, the spot is forgotten — every clone comes back and the detached
object stays as your own.* Concretely:

- **Unrelated edits keep the hole:** changing models, facing, direction or
  colors regenerates the same placements, so the hole stays.
- **Curving the street keeps the hole:** placements are matched in straight
  space, before bending, so a path change does not touch them. (The detached
  object itself is plain and does not follow a re-bend, like any hand-placed
  object.)
- **A layout change forgets the hole** (spacing, count, mode, seed, or a
  length change, which shifts every placement by half the added length since
  the segment stays centered): the old placement is no longer generated, so
  the hole matches nothing. All clones are created; the detached object may
  sit near one of them. A spacing that still lands on the spot keeps it a
  hole.
- **Nothing ever goes missing somewhere else.** An index-keyed hole would
  instead follow the *n*-th clone of the new layout: one clone would vanish at
  a new place while a regenerated one appeared on top of the detached object.

Each hole is spent by the first clone that lands on it in a regeneration, so
one detach always removes exactly one object. Two clones that share a
placement (a stencil group with zero padding stacks its stencils on one
spot) need two holes to both be detached; `skip` therefore keeps duplicate
keys. `skip` entries that are not `"x z"` placements (for instance an index
left by a pre-release build) are ignored, never mistaken for a hole.

## Triggers

- **Drag-to-detach (primary).** The viewport gizmo (`src/editor/lib/viewport.js`)
  attaches to a detachable clone — the one `data-no-transform` entity it
  accepts — and the action bar's translate/rotate buttons stay lit for it. The
  clone moves live during the drag, but no per-frame `entityupdate` is
  recorded against it; on the gizmo's `mouseUp` the drag is committed as a
  single `detachclone` with the dragged pose, so one Cmd-Z restores the clone
  to its slot. Afterwards the sidebar shows a normal object panel with the
  "Detached Model" layer name — that is how the user learns what happened
  (same as Figma's detached instance).
- **Toast.** `DetachCloneCommand.execute` posts a `STREET.notify` success
  toast saying the object left its generator and that Undo puts it back, so an
  accidental nudge is explained. Fires on redo and on the AI tool too.
- **Detach button** on the autocreated sidebar (`Sidebar.jsx`, next to "Edit
  Clone Settings"), for detaching without moving and for hard-to-grab objects.
- **AI tool `detachClone`** (`DetachCloneCommand.llmTool`, picked up by the
  LLM registry like every command with that static). Generated clones have no
  id and are `autocreated`, so they are absent from the scene state the model
  sees; the tool names one by `segmentId` + `component` (the generator, e.g.
  `street-generated-clones__1`) + `slotIndex`, all visible in the scene state,
  or with none of the three takes the selected clone. Optional
  `position`/`rotation` place the detached entity. Errors list the segment's
  detachable generators or the generator's live slots so the model can
  correct itself (`resolveDetachToolArgs` in `detachClone.js`).

`isDetachableClone(el)` is the single predicate both triggers and the UI gating
use: an `autocreated` entity stamped with a slot index and a placement key
whose parent still carries the named generator. Clones from surface generators (striping, rail,
grass) and clones created before slots existed (no stamp) are not detachable;
Convert to Shapes remains the bulk path.

## Accepted trade-offs

- A layout change (spacing, count, mode, seed, length) forgets the hole, so
  the generator places a clone near or on the detached object again; the user
  deletes whichever they do not want. See "Why holes are keyed by placement".
- Changing the segment type or reloading from Streetmix replaces the
  generator, so `skip` is lost and the detached object remains (possibly next
  to a regenerated duplicate). Same behavior as any hand-placed object today.
- A detached vehicle or pedestrian is no longer part of the play-mode moving
  cast (`street-traffic` finds its cast via `data-parent-component`): it stays
  put as scenery while traffic animates around it. The managed street's
  show-vehicles toggle still covers it (`getVehicleEntities` selects by mixin
  category under the street, not by generator).
- Managed Street JSON export describes generators, not children, so detached
  entities are not part of that export (the scene save carries them).

## Exports

- **Scene JSON / cloud save:** the detached entity is an ordinary segment
  child and `skip` is a non-default generator property, so both save and
  reload (`managed-street` only rebuilds segments from its source on an
  explicit synchronize).
- **GLB:** the detached entity is a normal object in the scene graph and
  exports like any hand-placed model.
- **PDF / DXF plan view:** the plan model (`src/editor/lib/plan/planModel.js`)
  treats a `Detached Model • …` entity as a clone, so a detached stencil stays
  on the markings layer behind the export modal's Clones toggle. Without that
  rule it would vanish: its layer name no longer starts with `Cloned `, and the
  loose-shapes pass skips anything owned by a street.

## Follow-up

"Duplicate segment surface as plain shape" on a segment (separate ticket) to
cover the surface-plane-as-building-block workflow without exposing raw
geometry on managed segments.
