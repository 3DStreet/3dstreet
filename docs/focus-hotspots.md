# Focus Hotspots

Author-placed clickable regions for the Viewer. Built for the
"semitransparent clickable building blocks over the geospatial layer"
use case, click a block, fly in to the detail (e.g. a Gaussian splat
scan of an existing treatment overlaid with a rendered GLB), read the
author's info panel, return to the overview, but deliberately generic:
any entity can be a hotspot, so scenes can be stretched into
HyperCard-style click-through experiences.

## User model

**Author (editor):**

1. Add Layer → Custom Layers → **Focus Hotspot** drops a semitransparent
   blue box (`geometry` + `material` + `focus-hotspot`). Restyle it with
   the standard featured geometry/material controls, or attach the
   `focus-hotspot` component to any other entity (GLB, splat
   placeholder, primitive) via the properties panel's add-component
   dropdown.
2. In the **Focus Hotspot** section of the properties panel: write the
   info-pane **Description**. The layer name is the panel's title.
   See-through hotspots (any transparent material) pulse to invite a
   click and hide themselves while focused so the detail they cover is
   unobstructed; opaque ones stay put. Behaviors, not settings.
3. Frame the shot you want visitors to land on, press **Set Focus View**
   (writes `focus-camera-pose`, the same mechanism as the long-press
   Focus button). **Preview Focus** replays the glide.
4. The scene's _start_ camera is the **Starting View** (below; the
   component is `viewer-start`). Setting
   a scene thumbnail in the capture modal moves it (creating it if the
   scene has none), so "the thumbnail view" and "where visitors begin"
   are one thing.
5. Press **Start** to try the visitor experience in place: an enabled
   hotspot registers as a playable capability with mode-manager, so the
   Play UI appears once the scene has at least one (no traffic or
   vehicle needed). Hotspots are only live while playing, so this is
   exactly what a visitor gets after pressing Start. Stop returns to
   editing.
6. Or frame the opening shot and choose **View › Set as Starting
   View**: it creates the Starting View layer (or moves it) and selects
   it. Re-frame and press **Set To Current View** in its panel to move
   it again (**Preview Start** replays the glide). Without one, the scene
   opens at the autosaved editor pose.

## Starting View (`viewer-start`)

The scene's start pose, as a discrete entity
(`src/aframe-components/play/viewer-start.js`) rather than scene
metadata: its position/rotation/`fov` _is_ the camera pose, so it is
selectable, movable with the gizmo, undoable, and shows up in the layers
list. One per scene: it is pinned to the top of the layers list, is not
draggable, cloning it is refused, and there is no Add Layer card. It is
created by exactly two actions, both of which move it if it exists:
**Set as thumbnail** in the capture modal and **View › Set as Starting
View** (which also selects it). Opt-in: nothing shows until one of those
happens. Deleting the layer is the off switch (no enabled toggle): once a
scene has had one, saving writes `memory.viewerStartMigrated: true`, so the
legacy default-snapshot pose is never migrated back into an entity on a
later load (the snapshot itself keeps its pose for the gallery).

**One start pose.** A scene used to carry three camera poses with no
relation between them (autosaved editor pose, default snapshot pose used
at load, Viewer Start used by Start). Now (`src/tested/scene-camera-pose.js`,
unit-tested), for owners and visitors alike:

| Launch                    | Opens at                                     |
| ------------------------- | -------------------------------------------- |
| `?camera=` deep link      | the link's pose                              |
| scene has a Starting View | the Starting View                            |
| no Starting View          | autosaved editor pose (`memory.cameraState`) |
| nothing saved             | default overview                             |

Pressing **Start** (and Reset) glides to the same Starting View. Legacy
scenes that pinned their opening view through the default snapshot's
camera state get a Starting View synthesized at load
(`migrateDefaultSnapshotToViewerStart` in `json-utils_1.1.js`; persisted
on the next save), so there is exactly one place a start pose lives. An
owner who wants "open where I left off" deletes the Starting View.
Nothing in the load path depends on auth.

- **No geometry:** the entity is a camera pose, not a thing in the
  scene, so it draws nothing and cannot be picked in the viewport (an
  earlier marker's frustum lines, raycast with a one-unit threshold, ate
  every click while the camera sat on it after a load). Select it from
  the layers list. Focusing it (double-click, Focus, F) glides to the
  pose itself, the same as Preview Start: `ExperimentalControls.focus`
  routes `viewer-start` targets to the system's `goToStart`. Nothing but
  position/rotation/`viewer-start` serializes.
- **Play:** the system glides the shared editor/viewer camera to the
  start pose on `play-mode-start` (`controls.focusCameraState`, which
  honors `fov` as `zoom`) and, for editor-origin sessions only, restores
  the pre-Start pose on `play-mode-stop`. Skipped when the scene's
  playable capabilities include drive or fly, since those borrow the rig
  camera for the whole session ("drive wins": a drivable car is
  effectively its own start point).
- **Not playable by itself:** set-thumbnail creates a Starting View
  implicitly, so it must not surface Start on its own (every scene with
  a thumbnail would get a do-nothing Start button). Hotspots, traffic
  and vehicles make a scene playable; Start then glides here.
- **Roles are open:** `viewer-start` is a role component like
  `drive-controls`; future camera controls (a look-at target / object,
  pedestrian or FPS spawn semantics) hang off its schema rather than
  each inventing a start marker.

**Visitor (viewer):**

- See-through hotspots pulse gently; hovering brightens any hotspot and
  shows a pointer cursor.
- Click → camera glides to the author's focus view (or bbox framing if
  none was set), the info panel opens bottom-left with the layer name,
  the description and **Back**.
- Back / Escape returns the camera to wherever the visitor was before
  their _first_ hotspot click. Clicking another hotspot mid-focus
  switches directly. There is no close/dismiss on the panel: Back is
  the one way out, so it stays up while focused.
- **Fixed camera** (Starting View `freeLook: false`): while playing, the
  visitor's orbit/pan/zoom/fly input is ignored; only hotspot clicks and
  Back move the camera. The `viewer-start` system sets
  `controls.inputLocked` during an active play session in control mode
  `viewer` (idle viewer and the editor are always free); scripted glides
  still run, since the lock is separate from the `enabled` flag
  drive/WebXR use to take the camera away.

## File map

| Piece                                       | File                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Component + system (pointer, camera, state) | `src/aframe-components/focus-hotspot.js`                              |
| Viewer info panel                           | `src/editor/components/elements/FocusHotspotPanel/`                   |
| Authoring sidebar                           | `src/editor/components/elements/FocusHotspotSidebar.jsx`              |
| Store mirror (`focusedHotspot`)             | `src/store.js`                                                        |
| Add Layer card                              | `AddLayerPanel/{layersData,createLayerFunctions,addLayerMessages}.js` |
| Add-component dropdown entry                | `elements/ComponentsContainer.jsx` (`getApprovedComponents`)          |
| Share modal iframe snippet                  | `modals/ShareModal/ShareModal.component.jsx`                          |

## Design notes

- **The system is the single pointer owner.** The editor's selection
  raycaster is disabled in viewer mode (`viewport.js`), and geo layers
  carry `data-ignore-raycaster`, so hotspots run their own raycast:
  one throttled `pointermove` + click-with-slop pick against only the
  registered hotspot meshes, walking `object.el` up to the owning
  entity. Components never bind listeners.
- **Interaction gates on control mode `viewer`** (mode-manager): the
  editor keeps its selection semantics, drive/fly keep the camera.
  Play (traffic sim) stays in `viewer`, so hotspots remain clickable
  during playback by design. The system also registers a
  `focus-hotspot` playable check (any hotspot with `enabled: true`) so
  the Start button surfaces for hotspot-only scenes.
- **Layers badge:** `getEntityBadges` (`src/editor/lib/entity.js`)
  returns passive inline badges for role components an entity carries
  (a bullseye for `focus-hotspot`), rendered by `scenegraph/Entity.jsx`
  after the name and before the expand arrow. They never replace the
  entity's type icon: a hotspot building stays a building. A saved
  `focus-camera-pose` deliberately gets no badge: it is a per-entity
  setting with no row-level affordance (remove it under Advanced
  Components). `viewer-start` is a type, so it keeps its own play icon
  via `getEntityIcon`.
- **Component bar:** `focus-hotspot` is a featured component
  (`lib/featuredComponents.js`), so the properties panel renders it as
  the standard collapsible bar (bullseye icon, title, remove) with the
  curated `FocusHotspotSectionControls` as its body, like a street
  generator, instead of a bespoke headerless block.
- **All camera motion reuses the editor controls** (shared with the
  viewer since #1848): `controls.focus()` for the fly-in,
  `controls.focusCameraState()` for the return glide. The overview pose
  is captured on the first click and cleared when focus clears or the
  mode changes.
- **One pose representation.** `focus-camera-pose` stores the full
  camera pose in the entity's frame (`relativePosition`,
  `relativeRotation` in degrees/YXZ, `fov`) and `controls.focus()` hands
  a stored pose to `focusCameraState()`, the same glide the Starting View
  and snapshots use, so the visitor lands exactly as the author framed
  it (off-center, tighter lens). Capture/resolve live in
  `src/editor/lib/focusPose.js` (unit-tested). Poses saved before
  rotation existed have `lookAt: true` (the schema default) and keep the
  legacy stand-here-and-aim-at-the-center behavior; no migration.
- **Persistence is free.** `focus-hotspot` and `focus-camera-pose` are
  ordinary schema components, so non-default values round-trip through
  scene save/load with no serializer changes.
- **Material effects restore, never own.** Hover (emissive tint +
  opacity boost) and pulse write over captured base values and restore
  them when leaving the viewer; bases are re-captured on `material`
  component changes and mesh swaps. Only materials the author made
  transparent get opacity effects. Caveat: a GLB whose materials are
  shared across entities will highlight all sharers, use a dedicated
  ghost block over such models.
- **Ghost hide-on-focus uses `setAttribute('visible', …)`** (the
  batching-safe path) and the picker skips invisible hotspots so a hidden
  block never swallows clicks on the content behind it. "Ghost" is read
  off the live materials (`isGhost()`), so an author toggling a material
  transparent flips the behavior without a separate setting.

## Visitor entry: first-entry Start and auto-start

- **First-entry Start.** A viewer-origin session with a playable scene
  and Play idle shows one large centered Start (viewer `Toolbar`,
  `hasPlayedThisScene`) instead of the small shuttle, for every playable
  kind (hotspots, traffic, the car). After the first Start (or an
  auto-start) the small shuttle takes over, including after a Stop.
  Owners never see it: they enter the viewer through Start.
- **`autoStart`** on the Starting View (default **off**): a viewer-origin
  entry starts Play as soon as the scene is presented (viewer mode,
  editor closed), skipping Start's glide so the load fly-in finishes on
  its own. Armed per scene load in the `viewer-start` system, consumed by
  any Start. Drive/fly scenes never auto-start (the vehicle takes the
  camera). Off by default for two reasons that will outlive this PR: the
  visitor's press is the user gesture browsers require before audio can
  play, and it is the de facto "everything has loaded" gate the
  deterministic simulation relies on. **Known limitation:** an
  auto-started scene whose streets are still loading starts traffic
  non-deterministically; the vehicle press-to-play is the reference
  behavior if load-gating is ever needed.
- The "welcome modal" / intro-animation ideas are presentations of the
  auto-start-off state and are not built.

## Stretch ideas (not built)

- Hotspot-to-hotspot links ("go to" another hotspot from the panel) for
  full click-adventure graphs.
- Rich text / image URLs in the info pane.
- **Embed mode** (a chrome-free `?embed=true` viewer for iframes plus a
  Share-modal snippet) was built and then removed from this PR: an
  iframe anyone can place anywhere needs server-side embedding policy
  first (allowlist / CORS / frame-ancestors). #1315 tracks the
  productization (querystring scheme, Pro gating, image-preview
  fallback); the code is in this branch's history.
