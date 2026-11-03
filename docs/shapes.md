# Shapes

Editor-drawn 2D shapes: a closed or open polyline with an optional filled
interior, drawn with the shape tool in the Action Bar and edited from the
properties panel.

The code is spread across several directories, so this file is the entry point:

| Where                             | What                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/aframe-components/`          | `shape.js` (the component and its schema), `shape-vertex.js`, `shapeFillRender.js`, `shape-fill-textures.js` (a fill's textures)                                       |
| `src/tested/`                     | `shape-fill.js` (fill catalogues, UV frame, pattern geometry and tile raster)                                                                                          |
| `src/editor/components/elements/` | `ShapeSidebar.jsx` (properties panel), `ShapeStyleSectionControls.jsx` (the Style section), `SurfaceSwatchOption.jsx`, `ActionBar/ShapeDrawAction.jsx` (the draw tool) |
| `src/editor/lib/`                 | `shapeStyle.js`, `shapeEditRules.js`, `shapeMeasure.js`, `ShapeReadouts.js`, `ShapeVertexControls.js`, `convertToShapes.js`                                            |
| `src/editor/lib/commands/`        | `ShapeVertex{Insert,Move,Remove}Command.js`, `StreetConvertToShapesCommand.js`                                                                                         |
| `test/`                           | `editor/shape*.test.js`, `editor/shapeFill*.test.js`, `editor/components/ShapeStyle*.test.jsx`, `components/shape-*.test.js`                                           |
| `docs/`                           | `shape-vertex-editing.md` — how the on-canvas vertex handles, the measurement chips and the two buttons divide the work between them, and why                          |

## Fill appearance

A closed shape's fill has two layers: the **material layer** (Solid color, or
a street-surface texture at the size a segment paints it) and the **pattern
layer** drawn over it (stripes, crosshatch, checkerboard, dots), each on or off
by its own opacity and nothing else. In the code, "material" alone means the
material layer; each layer is drawn by its own THREE material
(`fillLayerMaterials`), and `fillTextures` holds the textures they show.

- **One mesh, two materials.** The cap is one mesh whose geometry has a draw
  group per painted layer, `[material, pattern]`, over the same triangles. One
  mesh has one `renderOrder`, one depth and one id, so nothing in the scene can
  sort between a shape's two layers: where shapes overlap, each shape's pattern
  paints straight after its own material, whatever the sort. Both materials are
  transparent and non-depth-writing at every opacity, so both stay in the
  transparent list.
- **Draw groups are the per-layer switch.** An unpainted layer has no group,
  so it is neither drawn nor exported; `visible` is never used (the editor's
  pick list and the exporter's restore pass both key off it). With neither
  layer painted the material group stays, colour-write off, as the click
  target under select-inside, and the fill is marked editor-only so it does not
  export.
- **One UV set, in metres, in the shape's own frame.** Measured from the entity
  origin (the gizmo point, which no vertex edit moves), turned by `fillAngle`
  and slid by `fillOffsetAlong` / `fillOffsetAcross` after the turn. At Angle 0
  "along" runs toward -z, the direction a segment runs its texture along its
  length; a positive Angle turns the way a positive rotation does. Each layer's
  real-world size is its texture's `repeat`, which glTF carries as a scale-only
  `KHR_texture_transform`. Angle and Offset edits rewrite the UVs in place,
  with no rebuild. The frame and the pattern geometry are in
  `src/tested/shape-fill.js`.
- **Angle is set once**, by the draw tool, from the first side of the shape as
  drawn; no vertex edit or Reverse writes it. Angle and Offset are per shape and
  never sticky.
- **Layer textures are wanted when the shape is closed and that layer is
  painted**, re-checked on every property sync — not when the cap is built — so
  a shape created with a texture already set (a loaded scene, a sticky style, a
  duplicate, an undone delete) loads it, and the draw tool's open preview loads
  nothing. One per-shape object (`shape-fill-textures.js`) owns them through
  one transition function.
- **Surface textures load through the material system** (`loadTexture`), so
  the lazy-texture hook downloads them on first use and they share a source with
  segments; until one lands the material layer shows the image's placeholder
  colour multiplied by the tint, and keeps it if the load fails. A per-scene
  cache hands a loaded texture to a later shape at once, and tells shapes
  waiting on a load inside its callback, so a bound texture always belongs to a
  loaded surface.
- **Pattern tiles are drawn in code**, white with the coverage in alpha, so the
  pattern layer's colour (`fillPatternColor`) tints them; shared per scene for
  each exact
  pattern, spacing and width, and disposed on the last release. A changed tile
  replaces the shown one a frame later; the first is drawn at once, so a
  pattern is never drawn without its tile.

## Measurements

The side lengths and angles are editor chips (`ShapeReadouts`) that exist only
while the shape is selected. The enclosed area is a label the `shape`
component itself builds and positions, so it tracks every re-derive, but it is
shown only while the shape is selected too: `ShapeSidebar` calls
`setAreaLabelVisible(true)` on mount and `false` on unmount. Nothing measures
an unselected shape, in the viewer or during play.

## Vertex editing commands

Vertex editing adds three commands to the undo/redo family:
`shapevertexinsert` / `shapevertexremove` / `shapevertexmove`.

They exist rather than reusing `EntityRemoveCommand` / `EntityUpdateCommand`
because those steal selection, clone the entity on the reverse leg, and coalesce
consecutive updates into one undo step — none of which is wanted when the thing
being edited is one vertex of a still-selected shape. See each file's docblock
for the specifics.

The layer above them — the on-canvas handles, the measurement chips that double
as controls, and which module owns which gesture — is
`docs/shape-vertex-editing.md`.

## Sticky style

The **sticky style** is the appearance a newly drawn shape inherits: every key
of `SHAPE_STYLE_SPEC` in `src/editor/lib/shapeStyle.js` — the line's colour and
width and the fill's material, pattern, opacities, colours and sizes. The fill's
Angle and Offsets are deliberately not in it: each shape takes its Angle from
its own first side, and an Offset lines a pattern up with one shape's edge.

### The rule

**The drawing default follows the appearance of the shape you have selected,
whenever that appearance changes.** Restyle a shape's line or fill in the
properties panel, and the next shape you draw comes out looking like that one.

Properties of the rule, each of which is load-bearing somewhere:

- **One write site, one read site.** The write happens in the shape properties
  panel's `entityupdate` effect; the draw tool only reads. **Drawing a shape
  never changes the sticky style** — a shape drawn from the default does not
  re-persist that default.
- **It over-triggers, deliberately.** The write site is a listener on the global
  `Events` bus, filtered by `detail.entity === entity` and
  `detail.component === 'shape'` — and then by a third filter in the seed
  function, which rejects a _named_ non-appearance property (`closed`,
  `selectInside`, `updateEvent`). So a single-property edit only ever reseats the
  default when the property named is one of the sticky keys. What gets through
  unconditionally is a **whole-component write**: one whose `property` is absent
  or empty (`EntityUpdateCommand` sets `this.property = payload.property ?? ''`,
  and its LLM tool schema lists only `entityId` and `component` as required).
  That is accepted whether or not any appearance key actually moved. So the
  writer is not really "the properties panel" — it is _any emitter_ that writes
  the selected shape's `shape` component as a whole, e.g. an AI chat edit
  dispatched with no `property` at all. Such a write reseats the default to the
  shape's current appearance. That
  is accepted rather than fixed: the reseat is to the values the selected shape
  already has and the user can see, so the worst case is a no-op or a default
  the user would have got by editing that shape anyway.
- **Read once per draw-tool activation.** The draw tool reads the style when it
  activates and holds that value for the whole drawing gesture, so the preview
  and the committed shape cannot disagree — even if the style changes mid-draw.
- **The snapshot is of the whole shape, not the edit.** Changing one property
  captures them all, read back off the entity after the update rather than from
  the event payload. So restyling a yellow-lined shape's fill makes the next
  shape yellow-lined too, even if the stored style was red. `shapeStyle.js`
  reads `entity.getAttribute('shape')` for exactly this reason; simplifying it
  to `detail.value` would silently change the rule.
- **It is a snapshot, not a live link, and it is scoped to selection.** The
  default is captured at the moment of the change and then frozen. Undo and redo
  therefore move it only while the changed shape is still selected — which also
  means the default can end up holding a value nothing on screen still has
  (restyle a shape, deselect it, then undo). That is deliberate: the wider rule,
  where any appearance change anywhere reseats the default, would let an undo of
  a six-steps-old edit change the drawing default with no visible cue at all.

There is no undo of the sticky style itself. It is a preference, not scene
state, and sits outside the undo history — the same class as the units
preference.

There is also no swatch showing the current default and no reset control. The
escape route from any style, including an invisible one, is to select a shape
(a newly drawn one arrives selected) and set a visible value.

### Validation, in one rule

Both the stored value and every live write go through `normaliseShapeStyle`,
which applies the same rule to each key independently — never all-or-nothing,
which is what makes it the migration as well as the validator:

1. **Missing** → that key's default.
2. **Not a usable value of its type** → that key's default. Usable is judged
   _before_ coercion: a colour must be a non-empty string; a number must be an
   actual finite number, or a string that is non-empty after trimming and maps
   to a finite value.
3. **Coercion**, including `int` rounding.
4. **Out of the schema's range** → clamped to it.

Step 2's ordering matters: `Number(null)`, `Number('')`, `Number([])`,
`Number(false)` and `Number(' ')` are all `0`, so a coerce-then-check-finite
version would quietly turn wrong-type stored values into a zero line width and a
zero fill opacity — an invisible shape.

Colours accept any non-empty string rather than hex specifically. The colour
field commits whatever is typed into it verbatim and A-Frame stores it as given,
so `red` and `rgb(1,2,3)` are real live values; a hex test would reject a user's
own working colour and reset it on the next reload.

**Zero is a real value for the opacities and is remembered; a length is
floored instead.** A zero material or pattern opacity is that layer off and is
remembered as such. A zero line width is an outline-off, i.e. a fill-only shape,
and stays that way on the shape itself — but the remembered default is floored
at 0.05 m. Zero is a legal width and a useless default: a shape drawn with it
shows nothing at all until its third vertex closes the ring and the fill
appears, which reads as a broken tool rather than a style. Turning the fill off
as well is still reachable and still named by the tips block in the shape panel.
A pattern's spacing and width are floored the same way, at their schema
minimums.

Cold start — nothing persisted, nothing restyled — is the `shape` component's
own schema defaults, so the first shape a user ever draws is identical to what
they got before this feature existed, and identical to a shape created via Add
Layer. `DEFAULT_SHAPE_STYLE` mirrors those schema literals rather than reading
them, so that an A-Frame schema still carries a literal default; a test in the
components suite compares the two and fails if either moves.

### Scope: per browser, and it reaches the export

The value is persisted in `localStorage`, so it is **per browser profile, not
per scene**. A style set while editing one project applies to the first shape
drawn in another, and does not follow the user to a second machine. Note this is
the first `localStorage` preference here that changes content authored into a
document rather than app chrome — two collaborators on one scene will draw
differently-styled shapes.

A sticky fill also changes what gets **exported**, not just what is displayed:
an unpainted layer is absent from the file, and the shape component marks a
fill with neither layer painted as inspector-owned, which the exporter omits.
So a sticky 0% material with a sticky pattern exports the pattern alone, and
only both layers off makes subsequently drawn shapes export with outlines and no
interior faces. That follows a shape's _current_ opacities, so turning both
layers of an already-drawn shape off removes its interior from the file too.

### Why the value is not in the zustand store

`shapeStyle.js` owns the value outright — a module-level current value, a lazy
first read from `localStorage`, a best-effort write.

The read/write pair lives in a lib module for the same reason
`i18n/config.js`'s `resolveInitialLocale` / `persistLocale` do — storage I/O
belongs there — minus the store half, because nothing subscribes to this value.
Its only reader calls it imperatively when the draw tool activates. Putting it
in the store would re-render every selector-less `useStore()` component once per
animation frame during a fill-opacity drag, in exchange for reactivity no one
uses. `aframe-components/play/best-times.js` is the same shape.

The read is lazy and then **cached for the session**. That is not only a
startup-ordering convenience: it is why the feature keeps working for a whole
session when storage is unavailable or throwing. The first read fails safely
into defaults and later writes still update the in-memory value, so the
preference degrades to "does not survive a reload" rather than to "does
nothing". The cost is that an external edit to the stored value does not take
effect until a reload.
