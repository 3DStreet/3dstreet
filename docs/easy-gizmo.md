# Easy move/rotate gizmo

The experimental `?easygizmo=on` toolbar mode combines horizontal movement, yaw
rotation and explicit landing buttons. Its implementation lives in
`src/editor/lib/gizmos/`. The viewport routes selection and camera changes;
the controller owns gesture state, presentation and ground queries.

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

Easy mode temporarily suspends the selected subtree's terrain flatten volumes
without changing serialized settings. Terrain is sampled after the selected
shapes are removed and tile regeneration finishes. This avoids sampling terrain
modified by the item being placed. Detach, disposal and editor close release the
runtime suspension; unrelated flatten volumes remain active.

## Pointer ownership

Listeners attach at window capture so a claimed press is handled before canvas
listeners. Pointer, mouse and touch events are separate event families: claiming
a pointer event alone does not suppress the mouse event used by A-Frame selection.
Touch listeners that call `preventDefault()` must be non-passive.

Other editor handles are tested before claiming a press. Capture does not confer
priority over another listener on the same node and phase. Once claimed, the
gesture follows its initiating pointer until release or cancellation.

Translation records pointer movement and evaluates it once per scene frame.
Release queues the final coordinate for the next frame token, so finishing a drag
does not spend a second path-query budget within one frame. Cancellation restores
the press snapshot instead of committing that queued movement.

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
