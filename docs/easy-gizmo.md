# Easy move/rotate gizmo

The easy toolbar mode combines horizontal movement, vertical adjustment, yaw
rotation and explicit landing buttons. Its implementation lives in
`src/editor/lib/gizmos/`. The viewport routes selection and camera changes;
the controller owns gesture state, presentation and ground queries.

## Vertical adjustment and visual feedback

Drag the yellow double-headed arrow above the movement pad to raise or lower
the selected object. It moves along world Y without changing horizontal
position or rotation. The arrow is sized with the gizmo and may extend beyond
the object. It hides above a 70-degree viewing elevation; an existing vertical
drag continues until release. No modifier key is required.

The drag follows a world-Y line through the grab point, so perspective changes
do not change which point is held. It uses the normal move command and undo
path. Landing estimates update during the drag from the sampled column.

Controls have dark outlines only when hovered or active. The vertical and
shallow horizontal arrows keep their external shoulders without a line across
the shaft/head join. A shallow landing target appears as a single outlined
stroke while retaining a broader clickable region. The cyan shaft's picking
tube is 1.5 times its visible thickness; nearest-hit picking still applies.

The cyan outlines use a private depth-tested render of the visible rotation
surfaces. Separate surface IDs retain the visible head rims and the shaft's
actual junction with each head. A cropped, supersampled composite keeps these
edges visible over scene objects without including yellow controls or picking
proxies. Cropped dimensions are bucketed to reduce reallocations and capped at
1024 pixels per axis. Oversized/near-plane views may therefore use less than
two samples per axis. The overlay handles ordinary canvas rendering; offscreen
targets and XR use the underlying geometry without the hover outline. Capture
paths that hide editor helpers continue to hide the whole gizmo.

## Placement surfaces

Placement ranks streets, buildings, imported meshes and furniture in that order.
An item can use only item surfaces earlier in the list. Google 3D Tiles count as
terrain for every class, including rooftops embedded in the photogrammetric mesh.
Imported mesh identity takes precedence over the catalog building category.
Each catalog building contributes only its highest intersected surface in the
column. Separate stacked buildings retain separate roof targets. Intermediate
surfaces within imported meshes and Google 3D Tiles remain eligible.

The column probe filters hits before support picking, path evaluation and landing
rechecks, keeping continuous following and explicit landings under one policy.
Street height uses its road reference: managed streets transform the existing
material-depth offset above their dirt origin; legacy streets and standalone
segments use their origin. Other items retain bounding-box-base alignment.

A gesture temporarily suspends the dragged subtree's terrain flatten volumes
without changing serialized settings. Terrain is sampled after the selected
shapes are removed and tile regeneration finishes; until then the probe holds
tile support, so the first frames of a drag hold height rather than reading the
item's own plateau, and the drag's reference support and clearance are
re-seeded from a fresh probe the moment the tiles are back (the press measures
its reference after suspending, so a flattened street never carries its own
plateau as the reference). This avoids sampling terrain modified by the item
being placed. The suspension lasts exactly as long as the gesture: a street that is
merely selected keeps flattening the terrain around it (idle probes and landing
targets read the flattened terrain, so a flattened street reads as supported),
and every gesture exit, commit or cancel, restores it so the terrain
re-flattens around wherever the item ended up. Detach, disposal and editor close
release it too; unrelated flatten volumes remain active.

## Pointer ownership

Listeners attach at window capture so a claimed press is handled before canvas
listeners. Pointer, mouse and touch events are separate event families: claiming
a pointer event alone does not suppress the mouse event used by A-Frame selection.
Touch listeners that call `preventDefault()` must be non-passive.

Other editor handles are tested before claiming a press. Capture does not confer
priority over another listener on the same node and phase. Once claimed, the
gesture follows its initiating pointer until release or cancellation. The click
that trails a claimed press is swallowed (it would hand the selection to what
sits under the handle); the double-click is not, so the editor's double-click
focus frames the selected object even when the gizmo covers it at distance.
Nothing of a claimed press is left for the canvas: the next click, mouse or
touch, selects as usual.

Native pointer capture is a convenience, not the ownership mechanism. Chrome
drops capture mid-drag as soon as a pointermove reports no buttons held, which a
macOS trackpad produces during a real drag (a second finger brushing the pad,
three-finger drag, drag lock), with the real pointerup still to come. A
`lostpointercapture` for the owning pointer therefore never ends the gesture:
the window listeners keep following that pointer by id, capture is re-acquired
on the next move that reports the button down, a canvas `mouseleave` seen while
capture is lost is ignored (without capture the canvas sees the cursor cross
into a side panel, which is not a release), and the drag ends on pointerup,
pointercancel, blur or Escape as usual. Treating the loss as a cancel restored
the press pose on release, which users saw as the object snapping back.

The protocol has a second owner. `ClaimedPress` (`gizmos/claimedPress.js`)
carries it as a unit, without the parts only the easy gizmo needs, for a
control that cannot listen for itself: a group's stock control in the Advanced
modes ([groups](groups.md#handles)). A change to the protocol here belongs
there too.

Translation records pointer movement and evaluates it once per scene frame.
Release queues the final coordinate for the next frame token, so finishing a drag
does not spend a second path-query budget within one frame. Cancellation restores
the press snapshot instead of committing that queued movement.

## Attach policies

`attach(el, policy)` takes an optional policy for an entity the item rules do
not fit; without one nothing changes. User groups are the one caller: the
viewport passes a policy for every group in easy mode. A policy supplies the
pivot the handles stand at and a turn holds still, and the box whose bottom
they stand on, read at every layout rather than measured from meshes. It can
switch off ground behaviour (a move keeps its height, with no column probe and
no landing targets), keep geometry edits inside the entity from cancelling a
gesture, and defer presses.

A deferred press is claimed and suppressed as usual, and its control shows as
active at once, but nothing moves until the pointer has been 2 CSS pixels or
more from the press point, including coalesced samples (`pressClassifier.js`).
Then the drag starts from the press point. Released sooner, with no time
limit, it is a click: the gizmo dispatches `handleClick` with the press point
and the click count, and nothing else. A mouse's count is known only from the
`click` event that follows the release (a cancelled `pointerdown` means no
`mousedown` is sent to carry it), so a mouse click is reported from that event;
a touch press is reported on release. `handlePress` and `handlePressEnd`
bracket the held press; blur, `pointercancel`, Escape, detach and closing the
editor end it with nothing done, and an Escape that ends one does nothing
else. For a group, such a click over its box opens the group, and the
double-click it starts does not frame ([groups](groups.md)).

A commit rounds the position and the yaw, and writes pitch and roll exactly as
read, since the gizmo only ever edits yaw. A cancel puts back the pose exactly
as it was at the press.

## Work per frame and per event

The canvas rectangle is read at most once per scene frame (`_canvasRect`):
every matrix update and every pointer move maps through it, and each read is
a forced layout flush. An `entityupdate` re-probes support only when the
updated entity is the selection, an ancestor or a descendant; support changing
beneath it from elsewhere is the idle probe's job, so a batch command over many
entities or a scrub on an unrelated entity costs no scene raycasts here.

## Flattened frame

The flattened handle uses horizontal camera-right and holds that frame throughout
a gesture. Its frame depends on camera orientation and object heading, not object
position: translating an off-centre object should not turn its rotation arrows.

The square admits equivalent quarter-turn orientations in its round state, while
the flattened handle admits a half turn. Choose a nearby equivalent orientation
only at transition endpoints; changing representatives mid-transition would make
the rectangular plate and fading heads jump. Store the quarter-turn offset, not
the resulting heading, so object rotation still moves the handle.

The strip's long axis shows the permitted drag direction. The rotation ring stays
horizontal to communicate yaw. Its arrowhead arrangement is not invariant under
a half turn, so it does not share the handle's half-turn normalization.

## Projected rotation lever

At press time, project a calibration point before and after a small yaw to measure
horizontal pixels per radian through the current camera. This accounts for the
ring's depth and position in the viewport. Calibrate at the join between the arms,
using the picked radius and height, so the rate does not vary with the press angle.
A second calibration a quarter turn away provides the scale used to bound a
near-zero lever. The controller retains the measured sign.

Flattened translation instead converts horizontal cursor travel directly to
metres along camera-right. Intersecting a grazing ray with a horizontal plane
would make small vertical pointer movements produce large unintended travel.
