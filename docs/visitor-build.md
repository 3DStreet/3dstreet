# Visitor Build

Visitors place objects on a scene while playing, without an account. Built
for community-design use cases such as
[SF Community Corners](https://communitycorner.fun): the author models the
street and marks a painted safety zone as a build area with a palette of
planters, benches and trees; a visitor, on 3dstreet.app or inside an
`<iframe>` on the campaign's site, drags objects onto the zone, moves and
rotates them, takes a snapshot and keeps their design by opening it in a
fresh editor tab.

Read [play mode and viewer guidance](agent-context/play-mode.md) first:
Visitor Build is a play-mode capability and follows every rule there.

## User model

**Author (editor):**

1. Draw a closed shape with the shape tool (or close an existing one:
   **Closed** in its properties panel). This is the surface visitors build
   on.
2. In the shape's properties panel, **Add Component › Build Area**. The
   Build Area section appears as a featured component bar (cube icon,
   collapse, remove) with:
   - **Enabled**, **Max objects** (0 = unlimited), **Allow rotate**
   - **Palette**: a filterable, grouped checkbox list over the catalog
     mixins. Only these objects appear in the visitor's dock.
3. Optionally set the **Starting View** (View › Set as Starting View) and
   its `freeLook: false` for a fixed 45° vantage, so the visitor cannot
   orbit away from the corner.
4. Press **Start**. A buildable area registers as a playable capability
   with mode-manager, so Start appears for build scenes that have no
   traffic or vehicle. The author gets exactly the visitor experience;
   **Stop** returns to the editor with everything the preview placed
   removed and the editor's own undo stack intact.
5. Share the viewer link (`?viewer=true`) or embed it
   (`?embed=true`, see below).

**Visitor (viewer, while playing):**

- The **palette dock** (bottom centre) shows the union of every buildable
  area's palette. Drag a card onto a build area to place it there, or tap
  the card to drop it at the centre of the view (falls back to the first
  area's centroid).
- Click an object you placed to select it: the standard gizmo appears,
  translate is XZ-only (objects sit on the shape), rotate is yaw-only. An
  object dragged outside its area snaps back. Only visitor-placed objects
  are selectable: the shape, the street and the author's layers are off
  limits.
- Dock toolbar: **Rotate** (90°), **Delete**, **Undo**, **Redo**.
  Keyboard: Delete/Backspace, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z; Escape
  deselects first, then stops the session as usual.
- Right dock: **Snapshot** (the existing capture-only button) and
  **Open in 3DStreet** (below).
- **Reset** and **Stop** remove every placed object.

## Model

A `build-area` component on a closed `shape` entity
(`src/aframe-components/play/build-area.js`) is the whole configuration:
a role component, the way `drive-controls` makes a car drivable and
`focus-hotspot` makes a block clickable. Several build areas per scene are
fine, each with its own palette and cap.

**Placed objects are children of the shape entity.** "Dropped onto the
shape" is the parent relation: the pick point is converted into the
shape's local frame, the shape's ring is the clamp, and the child count
is the cap. Shapes already carry children (their `shape-vertex` markers)
and every shape internal filters on that marker, so extra children are
opaque to vertex editing, measurement and convert-to-shapes.

**Undo inside a session** stops at the mark taken at Start (`canUndo`), so
the dock's Undo never pops the author's editor commands; Stop and Reset
clamp the undo stack to the mark and put the pre-Start redo stack back.

**Nothing is persisted.** Play may change the live scene, as it already
does (animated traffic, the driven car, crash markers), but nothing that
happens during play is written to the source scene. Visitor objects carry
`data-viewer-added`, a DOM-only marker the serializer never writes
(`getElementData` allow-lists `data-*` attributes), they are stripped on
Stop and Reset, and Firestore only lets the author update the scene anyway.
The commands that created or moved them are dropped from the undo stack
back to the mark taken at Start, so an author previewing from the editor
keeps their own history.

**Session gating.** The `build-area` system mirrors `buildSessionActive`
into the store: true while a play session in control mode `viewer` has a
buildable area (enabled, closed shape, non-empty palette). Off it, the
viewer is the static scene it always was. On it:

- `viewport.js` re-arms what `Inspector.close()` turned off: the cursor
  entity plays, the selection raycaster is enabled, `sceneHelpers` is
  visible (grid and origin hidden), the stock gizmo is enabled in
  translate with Y hidden. The editor's gizmo mode is restored when the
  session ends, so a Stop into the editor finds its tools as it left them.
- `raycaster.js` resolves a viewer click to the nearest `data-viewer-added`
  ancestor of the hit, or nothing. No cascading selection.
- `BuildPalette.jsx` (`src/editor/components/elements/BuildPalette/`) is
  the dock: cards from `getGroupedMixinOptions(true)` filtered to the
  palette, a window-level drop handler with its own MIME type, the object
  toolbar, the keyboard, and the localized toasts for the refusals the
  system names through the `build-area-notice` scene event
  (`outside`, `palette`, `full`, `keepInside`).

**Drop resolution.** The system casts the pointer ray to each buildable
area's drop plane, the shape's fill cap: the mean height of the shape's
vertices plus the cap's lift (`FILL_LIFT_M`, `shapeFillRender.js`), so
objects stand on the painted surface the visitor sees rather than inside
it. Mean height is exact for a flat painted zone and an approximation for a
shape whose vertices were raised unevenly (the cap is flat too). The hit is
then tested against
the shape's world ring (`pointInRingXZ`, `build-area-rules.js`, unit
tested). It does not raycast the fill mesh, so an author who turned
`selectInside` off for a big zone still gets drops. Placement runs
through `Inspector.execute('entitycreate')` with `parentEl` = the shape,
`data-transform-no-scale` and `data-transform-no-reparent` (command-layer
guards) and, when rotate is off, `data-transform-yaw-only`.

## Keeping the work: Open in 3DStreet

`src/editor/lib/sceneHandoff.js` serializes the scene the way Save does,
strips `build-area` components (the visitor now owns an ordinary scene;
their shape stays a shape), stamps `memory.forkedFrom` with the source
scene id, crushes the JSON with JSONCrush and opens
`#crushed-3dstreet-json:…` in a new tab. That loader
(`set-loader-from-hash`, `json-utils_1.1.js`) clears metadata, so the
scene lands as a local draft: Edit needs no account, Save opens sign-in
and saves it as the visitor's own scene. The hash never reaches a server;
a street with a few hundred objects crushes to under 10 KB.

## Embedding

`?embed=true` implies `?viewer=true` and hides the app switcher, byline,
Edit action and profile button. Hosting sends no `X-Frame-Options` or
`frame-ancestors` header today (`public/firebase.json` sets only
`Cache-Control`), so third-party pages can frame the app; adding one later
must allow the campaign sites. The shuttle, Snapshot, the palette dock
and Open in 3DStreet stay. Example:

```html
<iframe
  src="https://3dstreet.app/?embed=true#/scenes/SCENE_ID"
  width="100%"
  height="600"
  allow="fullscreen; clipboard-write"
></iframe>
```

## Not in this phase

- A tethered "limited look" camera between free and fixed.
- User-uploaded assets in the palette (needs the served URL, type,
  thumbnail and bounds denormalized into the scene JSON so anonymous
  viewers need no Firestore read).
- Author-seeded objects that visitors may rearrange (only visitor-placed
  objects are movable today; anything the author placed on the shape is
  static during play).
- Submissions (a callable plus a subcollection and an author review
  panel). Until then the handoff link is the submission: the visitor opens
  it in 3DStreet, saves, and shares.
- A Share-modal Embed tab, host `postMessage` events, shape drawing in
  build sessions.

## Files

| Where                                                                  | What                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/aframe-components/play/build-area.js`                             | component + system (session, drop resolution, placement, cleanup)                                                   |
| `src/aframe-components/play/build-area-rules.js`                       | pure rules (palette parsing, cap, point-in-ring, palette union); `test/editor/buildAreaRules.test.js`               |
| `src/editor/components/elements/BuildPalette/`                         | visitor dock                                                                                                        |
| `src/editor/components/elements/BuildAreaSidebar.jsx`                  | author's Build Area section (wired in `FeaturedComponents.jsx`, `featuredComponents.js`, `ComponentsContainer.jsx`) |
| `src/editor/lib/sceneHandoff.js`                                       | Open in 3DStreet; `test/editor/sceneHandoff.test.js`                                                                |
| `src/editor/lib/viewport.js`, `src/editor/lib/raycaster.js`            | session gating, gizmo release clamp hook, viewer selection filter                                                   |
| `src/editor/components/scenegraph/Toolbar.jsx`, `src/editor/index.jsx` | Open in 3DStreet button, `?embed=true`                                                                              |
