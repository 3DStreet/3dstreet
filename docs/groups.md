# User groups

A user group is an entity the user makes with the layer panel's **New group**
button to hold other items, so they can be moved, turned and scaled together
and edited in isolation. The code is in `src/editor/lib/groups/`; the
`group-center` component is in `src/aframe-components/`.

## What a group is

- A group is any entity with the `user-group` class. The class is what the
  scene saves, and it is not `custom-group`, which the Add Layer panel uses for
  its own street-prop holders.
- Items move between the top level of the scene and user groups only.
  `groupModel.js` holds the one rule for that, used by the layer panel's drop
  zones, by placement and by the command guard: `canReparent` reads it from an
  entity, and `isGroupableItem` from the data of an item about to be created.
  Items the editor keeps under a fixed parent (street segments, generated
  content, shapes, the Starting View) never enter a group. Nor does a new
  360° panorama, which surrounds the whole scene: it carries the saved
  `scene-backdrop` class and stays at the top level on every route. A
  panorama in a scene saved before that class existed has none, and can still
  be pasted or dragged into a group.
- A group turns about Y only and scales by the same amount on every axis. The
  command guard (`transformGuard.js`) reads both from the class, so an AI
  command sees them with no editor code having run. A group scaled unevenly
  could only hold a turned member by shearing it.

## Bounds, center and origin

- A group has no geometry of its own. Its **bounds** are what its visible
  members span, measured in the group's own axes, so a turned group has a
  turned box. The group's origin is not part of them. Hidden members are left
  out.
- Its **center** is where its handles stand and what it turns about: a center
  stored with the group (`group-center`, `pinned`), else the middle of its
  bounds, else the origin (an empty group). The **origin** is the entity's
  position, which is what the properties panel shows and edits. The two
  differ, and the panel says so under the Transform heading.
- The selected group and the innermost open group are re-measured every frame
  in the editor frame window (below), and `groupboundschanged` fires when a
  box changes. Every other read returns the stored box. A gesture on a group
  holds its box, and so its center, until release.
- `group-center` stores its point in the group's local frame, so it travels
  with the group. The editor reads and keeps it but has no control that sets
  it.

## The editor frame window

`editorFrame.js` runs registered work inside the main scene's
`onBeforeRender` and `onAfterRender`, only while the editor is open. By then
every tick has run (including a gizmo drag) and three has updated every
`matrixWorld`, so this is the place for work that must see the frame's final
transforms and land before the frame is drawn. `FRAME_ORDER` in the same file
names where each piece of the groups code runs: the bounds, then the
selection and hover boxes of a group that moved or turned as a whole, the
center markers, the outline and scrim, and the fading of the outside; after the
render, the fading is undone before the step of opening a group that waits for
that render.

- Anything a callback poses after three's matrix update calls that object's
  own `updateMatrixWorld(true)`.
- A callback that throws is isolated from the others and from the render, and
  is dropped after a set number of consecutive throws.

## Opening a group

The open groups (the scope) are a stack of ids, outermost first, kept by the
scope controller `inspector.groupScope` (`openStack`; `openElements()` gives
the elements). The stack is session state only and is never saved.

- **Clicks.** A click on a member of a closed group selects the group. A click
  on the selected group's box or center marker opens it and clears the
  selection: an open group is never itself selected, because inside it the
  user works on its members. Inside an open group, a click reaches its members
  only, even behind a nearer outside object; empty space inside its box clears
  the selection. An open empty group's only inside is its marker, and a click
  there leaves the group and selects it. A click outside a nested open group
  leaves one level and selects the group it left. Outside the outermost one,
  empty space does the same, and an item closes the group and is selected.
  Escape leaves one level, selecting the group it left.
  `resolveCanvasClick` in `groupScope.js` decides; the controller applies.
- **Selection.** The scope follows the selection wherever it comes from:
  selecting an item opens the groups around it, and selecting a group closes
  it. A null selection (opening a group, a tool switch, undoing a create)
  leaves the scope as it is.
- **Pruning.** Deleting or hiding an open group closes it and every group
  inside it. Loading a scene and leaving the editor close every group; on
  return, a selection inside a group becomes that group's outermost group,
  selected and closed. A group being moved stays in the stack while the move
  settles; the move then selects it, which closes it.
- **Pick targets.** The selected group's box, the markers and the open group's
  volume are ray/box tests, not scene objects, so camera navigation and
  placement never land on them.
- **Double-click.** The clicks of a double-click that select or open a group
  are the whole gesture: the camera does not move.
- **Hover** previews what a click would select. A dark magenta (#808) box
  means the click would open the selected group; it stays on the group's
  current box while the group moves or turns. A click that leaves a group
  previews nothing, though it selects that group: the group's outline already
  marks it. The one exception is an open empty group's marker, which is
  emphasised. While the cursor is on a group's Advanced move or rotate handle,
  no red hover is shown: a click there belongs to the handle and never selects
  what lies beneath.
- **OSM streets.** While any group is open, the editor offers no OSM street
  upgrade, neither on hover nor on a click; the offer returns once no group is
  open. OSM streets are not part of any group.
- **Touch.** The A-Frame cursor acts on a tap only when it hits an entity. On a
  touch device, taps on empty space, on the empty inside of a group's box and
  on an empty group's marker do nothing; the layer panel does those jobs, and
  tapping an outside object leaves the group.

## Handles

In easy mode a group gets the easy gizmo, with an attach policy
(`docs/easy-gizmo.md`, "Attach policies"): the handles stand at the center on
the bottom of the member box, a move keeps the group's height, and a turn is
about the center.

In Advanced move and rotate a group gets a stock transform control of its own
(`groupStockGesture.js`), a second instance with no canvas listeners. The
stock control stands at the origin of what it is attached to, so it is
attached to a proxy at the group's center that carries the group's heading;
each change of the proxy is mapped onto the group. Move shows every axis;
rotate shows only the vertical ring, and turns about the center. Its press is
owned by `gizmos/claimedPress.js`, the easy gizmo's press protocol as a unit. A
drag is one undo step, and Escape, blur or a cancelled pointer put the group
back exactly. Scale mode shows a placeholder on the center marker, a wire cube
with nothing to drag: a group scales only uniformly, in the properties panel.

A press on a group's handle is held until the pointer has moved 2 CSS
pixels. Released sooner, it is a click: over the selected closed group's
box it opens the group, and anywhere else it does nothing. An open group is
never selected, so it has no handles.

## Showing the open group

- A white outline around the member box and a scrim darkening the screen
  outside the box's outline appear in the same task as the group opens, so
  they are on screen in the next frame.
- Fading the outside follows one animation frame after the first render that
  shows the outline. Every change of open group cancels pending work for the
  previous one, and anything that still runs checks the scope generation it
  was scheduled for.
- Each step leaves a `performance` mark (`group-scope:open`,
  `group-scope:outlined-frame`, `group-scope:fade-enabled`,
  `group-scope:first-faded-frame`) carrying the generation, so entry time
  can be measured in any build.

## Fading the outside

While a group is open, scene content outside it is drawn at a fifth of its own
opacity (`scopeFade.js`). Editor helpers are drawn normally. Nothing
saved changes, and visibility is never written.

- **Meshes** are drawn with a faded copy of their material, swapped in at the
  start of each render and swapped back at its end. Outside the render window
  every material is the original, so batching, exporters and the serializer
  never see a copy. A copy is refreshed when its original changes (a texture
  arrives, a material is replaced). Copies are transparent, write no depth,
  and scale a cutout's alpha test with its opacity.
- The shadow pass runs inside the window, so an outside cutout casts a
  slightly wider shadow while a group is open.
- A shader material with no `opacity` uniform cannot be faded and is drawn as
  it is.
- Content that arrives while a group is open is classified before it is first
  drawn.
- If a render window throws, every swap is undone and fading stops for the
  session; the group stays open.
- **Captures and exports** see the original appearance. A synchronous render
  that is read back runs inside `withOriginalAppearanceSync`; an export that
  reads materials across awaits runs inside `withOriginalAppearance`. A new
  capture or export path needs one of them. While an export runs, the viewport
  shows the outside unfaded.

### Batches

A batch (`batch-models.js`) can hold instances on both sides of the group, so
it is split per instance for each render (`fadeBatches.js`). The batch
keeps only its inside instances for the window's camera and everything for any
other camera, so shadows are unchanged. A second `BatchedMesh`, attached as
its child for the render, draws the outside instances with a faded material.

That second mesh shares the batch's data through fields private to three.js
(`SHARED_FIELDS`), re-bound from the batch at every render, so it never
depends on when three replaces them. It never calls `dispose()`, which would
free data it borrows. At run time the fields and `THREE.REVISION` are checked
against `SUPPORTED_THREE_REVISION`; a batch that does not fit keeps its outside
instances unfaded and logs one warning. After a three.js upgrade, check the
fields against `BatchedMesh` and update the revision;
`test/components/group-fade-real-three.test.js` runs the split against the
real `BatchedMesh`.

### Map layers and splats

- Google 3D Tiles, the 2D basemap and OSM buildings fade through their own
  opacity path, because their tile materials must keep their identity. Each
  multiplies a presentation factor (`src/tested/reference-layer-presentation.js`)
  into its opacity; the saved `opacity` never changes. They keep depth writes,
  as the layer opacity policy requires.
- A Gaussian splat fades through its own `opacity`, restored on exit unless
  something else has set it meanwhile.

## Adding items while a group is open

`groupPlacement.js` holds the rule.

- An item that may go into a group goes into the innermost open group, at the
  world pose it would have had at the top level, so a route's preview is where
  the item lands. An item that may not keeps its route's destination, and a
  notice says it landed outside the group.
- A few routes keep their own destination even for an item that could be
  grouped: the Traffic Replay layer and the street its panel creates, the Geo
  panel's flattening box, OSM street upgrades and street imports from a URL.
  Their items land at the top level, and the notice says the item can be
  dragged into the group in the layer panel.
- The destination is taken when the operation begins (a card click, a file
  picker opening, a paste) and checked again when the item is committed. If the
  group has gone, or can no longer take the item, the placement is refused with
  an explanation; it never falls back to the top level.
- A placement "in view" that finds no ground uses the group's stand point (the
  center, on the bottom of its members; an empty group's center itself),
  never its origin. So does a route with no position of its own (the Assets
  panel's Upload button, File › Import), reading the stand point when the item
  is committed.
- Items the editor makes for the user rather than ones the user adds
  (`isSystemItem`: the Starting View) get no notice, and creating or moving
  one leaves the selection, and so the open group, as it was.
- **New group** with a group open makes the new group inside it, with its
  origin at that group's center.
- **Paste.** An item copied from inside a group, or pasted into an open group,
  keeps its world pose. Every other paste keeps the copied local pose.

## Moving items between groups

`EntityReparentCommand` moves an item by serializing it and recreating it
under the new parent with the same id.

- A move to another parent keeps the item's world pose. It is refused when
  that pose would need a shear, or when the group model does not allow the
  move. A reorder within the same parent keeps the saved local pose.
- Everything that can be checked is checked before the original leaves the
  scene. If building the copy still throws, the original goes back where it
  was and the user is told; its components have already been removed, so its
  model may not show until the scene is saved and reloaded.
- A row whose move is still settling cannot be dragged.
- **Drop levels.** Where groups end, one gap between two rows can mean several
  places: after the last member, after its group, after the group around that.
  The pointer's horizontal position picks one, each level owning the band
  that starts at its own indent (`dropLevels.js`), and the drop line starts at
  that indent, with a chevron marking a drop inside a group. A top-level drop
  keeps the full-width line. Gaps with no user group involved keep the hovered
  row's own zones.
- Because a move replaces the element, code that holds an entity across an
  await must look it up again by id, as the upload flow does; a pending upload
  survives a move. An upload that finishes after its item was deleted tells the
  user the asset is in their library.
- Deleting an item from a parent with no id gives the parent one, so undo can
  find it after the parent has been moved.
