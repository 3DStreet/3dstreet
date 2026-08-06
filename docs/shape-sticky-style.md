# Shape sticky style

The **sticky style** is the appearance a newly drawn shape inherits: the
four-tuple `lineColor`, `lineWidth`, `fillColor`, `fillOpacity`. It lives in
`src/editor/lib/shapeStyle.js`.

## The rule

**The drawing default follows the appearance of the shape you have selected,
whenever that appearance changes.** Restyle a shape's line colour, line width,
fill colour or fill opacity in the properties panel, and the next shape you draw
comes out looking like that one.

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
  default when the property named is one of the four. What gets through
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
  captures all four, read back off the entity after the update rather than from
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

## Validation, in one rule

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

**Zero is a real value on both numeric keys.** A zero fill opacity is a
fill-off; a zero line width is an outline-off, i.e. a fill-only shape. Both
stick, with no carve-out. Setting both leaves the draw tool committing shapes
with no line and no fill — the tips block in the shape panel names this state,
and any non-zero line width recovers from it.

Cold start — nothing persisted, nothing restyled — is the `shape` component's
own schema defaults, so the first shape a user ever draws is identical to what
they got before this feature existed, and identical to a shape created via Add
Layer. `DEFAULT_SHAPE_STYLE` mirrors those schema literals rather than reading
them, so that an A-Frame schema still carries a literal default; a test in the
components suite compares the two and fails if either moves.

## Scope: per browser, and it reaches the export

The value is persisted in `localStorage`, so it is **per browser profile, not
per scene**. A style set while editing one project applies to the first shape
drawn in another, and does not follow the user to a second machine. Note this is
the first `localStorage` preference here that changes content authored into a
document rather than app chrome — two collaborators on one scene will draw
differently-styled shapes.

A sticky fill opacity of 0 also changes what gets **exported**, not just what is
displayed: the shape component marks an invisible fill group as inspector-owned,
and the exporter omits objects carrying that marker. So once a user turns one
shape's fill off, subsequently drawn shapes export with outlines and no interior
faces. That marker follows a shape's _current_ opacity, so zeroing an
already-drawn shape's fill removes its interior from the file too.

## Why the value is not in the zustand store

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
