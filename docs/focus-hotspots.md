# Focus Hotspots & Embed Mode

Author-placed clickable regions for the Viewer, plus a chrome-free embed
presentation for iframing scenes into other sites. Built for the
"semitransparent clickable building blocks over the geospatial layer"
use case — click a block, fly in to the detail (e.g. a Gaussian splat
scan of an existing treatment overlaid with a rendered GLB), read the
author's info panel, return to the overview — but deliberately generic:
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
2. In the **Focus Hotspot** sidebar: set the info-pane **Title** and
   **Description**, toggle **Hide When Focused** (for ghost blocks
   placed over detail content) and **Pulse**.
3. Frame the shot you want visitors to land on, press **Set Focus View**
   (writes `focus-camera-pose`, the same mechanism as the long-press
   Focus button). **Preview Focus** replays the glide.
4. The scene's *start* camera is the existing saved-view machinery
   (default snapshot > auto-saved `memory.cameraState`), nothing new.

**Visitor (viewer / embed):**

- Hotspots pulse gently; hovering brightens them and shows a pointer
  cursor.
- Click → camera glides to the author's focus view (or bbox framing if
  none was set), the info panel opens bottom-left with title,
  description and **Back to overview**.
- Back / Escape returns the camera to wherever the visitor was before
  their *first* hotspot click. Clicking another hotspot mid-focus
  switches directly. The panel's ✕ closes the text but leaves the
  camera in place.

**Embed:** `https://3dstreet.app/?embed=true#/scenes/UUID` — viewer mode
with the app switcher and the edit/auth dock stripped (title + byline
pill stays as attribution; play shuttle appears if the scene is
playable; Escape never opens the editor). The Share modal offers a
copy-paste iframe snippet. The existing `?camera=` deep-link param
composes with it for a link-time camera override.

## File map

| Piece | File |
| --- | --- |
| Component + system (pointer, camera, state) | `src/aframe-components/focus-hotspot.js` |
| Viewer info panel | `src/editor/components/elements/FocusHotspotPanel/` |
| Authoring sidebar | `src/editor/components/elements/FocusHotspotSidebar.jsx` |
| Store mirror (`focusedHotspot`, `isEmbedMode`) | `src/store.js` |
| Add Layer card | `AddLayerPanel/{layersData,createLayerFunctions,addLayerMessages}.js` |
| Add-component dropdown entry | `elements/ComponentsContainer.jsx` (`getApprovedComponents`) |
| Embed param + viewer entry | `src/editor/index.jsx` |
| Embed chrome gating + Escape laddering | `src/editor/components/scenegraph/Toolbar.jsx` |
| Share modal iframe snippet | `modals/ShareModal/ShareModal.component.jsx` |

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
  during playback by design.
- **All camera motion reuses the editor controls** (shared with the
  viewer since #1848): `controls.focus()` — which already honors
  `focus-camera-pose` — for the fly-in, `controls.focusCameraState()`
  for the return glide. The overview pose is captured on the first
  click and cleared when focus clears or the mode changes.
- **Persistence is free.** `focus-hotspot` and `focus-camera-pose` are
  ordinary schema components, so non-default values round-trip through
  scene save/load with no serializer changes.
- **Material effects restore, never own.** Hover (emissive tint +
  opacity boost) and pulse write over captured base values and restore
  them when leaving the viewer; bases are re-captured on `material`
  component changes and mesh swaps. Only materials the author made
  transparent get opacity effects. Caveat: a GLB whose materials are
  shared across entities will highlight all sharers — use a dedicated
  ghost block over such models.
- **`hideOnFocus` uses `setAttribute('visible', …)`** (the batching-safe
  path) and the picker skips invisible hotspots so a hidden block never
  swallows clicks on the content behind it.

## Stretch ideas (not built)

- Hotspot-to-hotspot links ("go to" another hotspot from the panel) for
  full click-adventure graphs.
- Rich text / image URLs in the info pane.
- Per-hotspot camera *rotation* in `focus-camera-pose` (today: position
  only; look-at is the hotspot's center).
- An `?embed=…` allowlist / CORS review before advertising embeds
  broadly (#1315 tracks the productization: querystring scheme, Pro
  gating, image-preview fallback).
