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
`seed`), so the order in which they create clones is stable across
regenerations and reloads. That creation order is a clone's **slot** index.

- **Generator side** (`src/tested/clone-slots.js`, pure + unit-tested): each of
  the three generators has a `skip: {type: 'array', default: []}` property.
  `update()` starts a slot counter (`createSlotCounter(this.data.skip)`); every
  clone the generator would create takes the next slot, and a slot listed in
  `skip` is counted but not created. Every created clone is stamped
  `data-clone-index` next to `data-parent-component`. Seeded draws (model
  pick, random facing, pedestrian position/variant/facing) happen **before**
  the counter is consulted, so a skipped slot consumes the same RNG calls it
  would have and the clones after the hole keep their layout.
- **Editor side** (`src/editor/lib/detachClone.js` +
  `src/editor/lib/commands/DetachCloneCommand.js`): `detachclone` is one
  undoable command composed from two existing ones — an `entityupdate` that
  appends the slot to the generator's `skip` (the generator regenerates minus
  that slot, removing the clone) and an `entitycreate` of a plain entity under
  the same segment with the clone's mixin, position and rotation (plus a
  stencil's own `geometry`/`polygon-offset`/`batch-member`), layer name
  `Detached Model • <mixin>`, no `autocreated` class, no `data-no-transform`.
  Undo removes the plain entity and restores the slot, so the generator puts
  the clone back exactly where it was, and reselects it.
- **Persistence:** nothing new. `skip` saves with the generator config (and
  round-trips through Managed Street JSON export/import like any schema
  property); the detached entity saves as an ordinary segment child; on load
  the generator regenerates minus that slot.

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
- **Detach button** on the autocreated sidebar (`Sidebar.jsx`, next to "Edit
  Clone Settings"), for detaching without moving and for hard-to-grab objects.

`isDetachableClone(el)` is the single predicate both triggers and the UI gating
use: an `autocreated` entity stamped with a slot index whose parent still
carries the named generator. Clones from surface generators (striping, rail,
grass) and clones created before slots existed (no stamp) are not detachable;
Convert to Shapes remains the bulk path.

## Accepted trade-offs

- The hole is keyed by slot index; changing that generator's spacing, count,
  mode or models later shifts which object the hole lands on.
- Changing the segment type or reloading from Streetmix replaces the
  generator, so `skip` is lost and the detached object remains (possibly next
  to a regenerated duplicate). Same behavior as any hand-placed object today.
- A detached vehicle or pedestrian is no longer part of the play-mode moving
  cast (`street-traffic` finds its cast via `data-parent-component`): it stays
  put as scenery while traffic animates around it, and the managed street's
  show-vehicles toggle no longer affects it.
- Managed Street JSON export describes generators, not children, so detached
  entities are not part of that export (the scene save carries them).

## Follow-up

"Duplicate segment surface as plain shape" on a segment (separate ticket) to
cover the surface-plane-as-building-block workflow without exposing raw
geometry on managed segments.
