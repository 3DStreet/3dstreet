# Editor (React)

[Back to the codebase guide](../../CLAUDE.md). Source paths start at the
repository root; bare filenames name modules within this subsystem.

**Architecture:** `AFRAME.INSPECTOR` global wraps A-Frame scene, uses Events.js + command pattern

**Key Components:** MainWrapper (auth/modals) → SceneGraph (left) + PropertiesPanel (right) + Viewport (3D canvas)

**State:** `src/store.js` (Zustand) - scene metadata, modal state, save state, preferences

**Commands:** `src/editor/lib/commands/` - undo/redo pattern (AddEntity, SetComponent, EntityReparent, etc.)

**`Inspector.execute` can now refuse.** It returns the `TRANSFORM_REFUSED`
symbol (`src/editor/lib/transformGuard.js`) instead of running a command that
would violate a transform-capability marker on the target entity — test for the
symbol, not for a falsy return, since the success path returns `undefined`. The
markers are `data-transform-no-scale`, `data-transform-yaw-only` and
`data-transform-no-reparent`; an entity opts in by carrying the attribute and
the guard is otherwise entity-type-agnostic. They are **not** the same thing as
the far more common `data-no-transform`, which is a UI gate only (it hides the
properties-panel transform rows and the gizmo) and is enforced nowhere at the
command layer. Coverage is every command route — properties panel, AI chat,
gizmo, layers-panel reparent — but not a direct `setAttribute` from scene load
or component code.

**Shapes:** editor-drawn 2D polylines with an optional filled interior. The code
spans `src/aframe-components/`, `src/editor/components/elements/`, `src/editor/lib/` and
`src/editor/lib/commands/`; [docs/shapes.md](../shapes.md) is the entry point and carries the file
map, the vertex-editing commands and the sticky-style rule.

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

**Layer Reordering:** Drag-and-drop reordering of layers within the same parent in the SceneGraph. Uses `EntityReparentCommand` which serializes via `STREET.utils.getElementData()` and recreates via `STREET.utils.createEntityFromObj()` — the same proven save/load code path.
