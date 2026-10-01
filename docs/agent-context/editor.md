# Editor (React)

[Back to the codebase guide](../../CLAUDE.md). Source paths start at the
repository root; bare filenames name modules within this subsystem.

**Architecture:** `AFRAME.INSPECTOR` global wraps A-Frame scene, uses Events.js + command pattern

**Key Components:** MainWrapper (auth/modals) → SceneGraph (left) + PropertiesPanel (right) + Viewport (3D canvas)

**State:** `src/store.js` (Zustand) - scene metadata, modal state, save state, preferences

**Commands:** `src/editor/lib/commands/` - undo/redo pattern (AddEntity, SetComponent, EntityReparent, etc.)

**`Inspector.execute` can now refuse.** It returns the `TRANSFORM_REFUSED`
symbol (`src/editor/lib/transformGuard.js`) instead of running a command that
would violate a transform-capability marker on the target entity or the
hierarchy rules — test for the symbol, not for a falsy return, since the
success path returns `undefined`. The markers are `data-transform-no-scale`,
`data-transform-yaw-only`, `data-transform-uniform-scale` and
`data-transform-no-reparent`; an entity opts in by carrying the attribute (a
user group implies yaw-only and uniform-scale by its class). The hierarchy
rules refuse a move to another parent that `canReparent`
(`src/editor/lib/groups/groupModel.js`) rejects or that could not keep the
item's world pose, and a create or paste whose `requireParent` parent can no
longer take the item. The markers are **not** the same thing as
the far more common `data-no-transform`, which is a UI gate only (it hides the
properties-panel transform rows and the gizmo) and is enforced nowhere at the
command layer. Coverage is every command route — properties panel, AI chat,
gizmo, layers-panel reparent — but not a direct `setAttribute` from scene load
or component code. The stock rotate gizmo ("Advanced rotate") shows all three
rings, since yaw-only rotation is the easy gizmo's job; on a
`data-transform-yaw-only` entity it offers its Y ring alone
(`applyStockGizmoAxes` in `src/editor/lib/viewport.js`), so it never starts a
drag the guard would refuse.

**Per-object detach (#2011):** a generated clone (clones/stencil/pedestrians)
carries no `data-no-transform`; it is an editable object whose first edit
detaches it. `Inspector.execute` runs `routeCloneEdit` before building a
command: `entityupdate` on a clone becomes `detachclone` carrying the edit
(pose, mixin or component), `entityremove` becomes a hole-only detach,
`entityclone` a plain copy, and a `multi` batch is unwrapped member by member
with every member aimed at one clone folded into a single `detachclone`
(`MultiCommand` builds its members directly, not through `Inspector.execute`,
so an un-unwrapped batch bypasses the rule: any new command-layer rule keyed
on `entityupdate` must unwrap `multi` too, as `refuseGuardedTransform` does).
`detachclone` appends the clone's `"x z"` placement key to the generator's
`skip` (a hole; forgotten if the layout stops landing there) and creates the
plain `Detached Model` entity, as one undo entry composed from `entityupdate`

- `entitycreate`. The easy gizmo commits its drag as one `multi` and is routed
  like any door; the stock TransformControls gizmo defers its commit to
  `mouseUp` and calls `detachclone` itself; the clone
  sidebar header (`CloneSidebarHeader.jsx`) has a Detach pill; the AI chat has
  the `detachClone` tool (addresses a clone by segment + generator + slot, since
  clones have no id and are not in the scene state). Predicate, router and
  payload builders live in `src/editor/lib/detachClone.js`; doc is
  [docs/per-object-detach.md](../per-object-detach.md).

**Shapes:** editor-drawn 2D polylines with an optional filled interior. The code
spans `src/aframe-components/`, `src/editor/components/elements/`, `src/editor/lib/` and
`src/editor/lib/commands/`; [docs/shapes.md](../shapes.md) is the entry point and carries the file
map, the vertex-editing commands and the sticky-style rule.

**Custom shaders in the viewport:** the scene renders with a logarithmic
depth buffer (`index.html`), so any raw `ShaderMaterial` drawn into it (the
`InfiniteGridHelper` grid in `src/editor/lib/`, the ghost boxes in
`src/aframe-components/model-placeholder.js`) must include three's `<common>`
and `logdepthbuf` pars/vertex/fragment chunks. Without them its depth is on a
different scale from every built-in material and it occludes, or is occluded
by, real geometry at random (#1988, #2009).

**User groups:** entities with the `user-group` class, which users make, open
for editing (`inspector.groupScope`) and move items into. Which parent an item
may take is decided only by `canReparent` in `src/editor/lib/groups/groupModel.js`;
per-frame work that must see final transforms registers in the editor frame
window (`src/editor/lib/editorFrame.js`). Doc is [docs/groups.md](../groups.md).

**Street gizmos:** always-on viewport handles for managed streets (endpoint
nodes that rewrite position/rotation/length, segment width bars), additive to
the standard TransformControls gizmo. Code in `src/editor/lib/gizmos/`; doc is
[docs/street-gizmos.md](../street-gizmos.md).

**AI tool surface (WebMCP primary, MCP relay fallback):** one registry (`src/editor/lib/commands/registry.js`) feeds three consumers: the in-editor Gemini chat, WebMCP (`src/editor/lib/mcp/useWebMCP.js` registers the same tools with `document.modelContext` so a browser-embedded agent — Chrome 149+ origin trial / ChatGPT desktop browser — calls them in-process, no relay; this is the primary agent interface), and the MCP relay (fallback for clients without WebMCP such as Claude Desktop/Code: tab = MCP server, external `3dstreet-mcp` npm relay bridges stdio↔localhost WS; design in #1582; retire once those clients read WebMCP natively). Shared executor `callToolAsMCPContent` in `src/editor/lib/mcp/dispatch.js`; entry point: [docs/webmcp.md](../webmcp.md).

**Properties panel & scene graph UI (#1979–#1982):** every entity panel shares
one compact footer (`PanelFooter.jsx`: Add Component select + Advanced pill;
the raw component list in `AdvancedComponents.jsx` always opens with a
data-damage warning). Transform (position/rotation/scale) is a named
collapsible section like geometry/material; named sections persist their
collapsed state per device via `src/editor/lib/panelPrefs.js` (localStorage,
shared across entities; shift-click a header to apply to all sections in
view). The position label toggles to a read-only GeoLoc readout on geospatial
scenes (pref also in panelPrefs). Scene graph rows: expand arrow left of the
name, and a right-justified overlay bar carries passive role badges plus the
hover-revealed visibility eye (slashed eye stays visible when hidden).

**Layer Reordering:** Drag-and-drop reordering of layers in the SceneGraph, within a parent and between the top level and user groups; where groups end, the pointer's x picks the level (`docs/groups.md`). Uses `EntityReparentCommand` which serializes via `STREET.utils.getElementData()` and recreates via `STREET.utils.createEntityFromObj()` — the same proven save/load code path.
