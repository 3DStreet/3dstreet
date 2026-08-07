# Shape vertex editing — the on-canvas layer

A selected `shape` gets an editing overlay: a draggable handle per vertex, a
delete button on the sub-selected vertex, length and angle measurements on every
side and corner, and an insert ("+") button on the one side the user has picked.

Three modules cooperate, and the split is by _who can answer the question_:

| Module                                           | Owns                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/editor/lib/ShapeVertexControls.js`          | the handles, both on-canvas buttons, every gesture, and **which side is revealed** |
| `src/editor/components/elements/ShapeSidebar.js` | the properties panel, and the render of the measurements                           |
| `src/editor/lib/ShapeReadouts.js`                | building measurement chips as CSS2D DOM billboards                                 |
| `src/editor/lib/shapeEditRules.js`               | the pure rules all of the above agree on                                           |

This document holds the rationale that is longer than an inline comment can
carry. Each site it covers keeps a one-line invariant pointing here.

## Naming a side: elements, not indices

A side is named by its two endpoint **elements**, never by its segment index.
Inserting or deleting a vertex anywhere renumbers every segment after it, so a
control keyed on the number would silently move to a neighbour and act on a side
the user never chose, with nothing on screen to say it had.

`segmentForVertexPair(vertexEls, a, b, closed)` in `shapeEditRules.js` is that
rule, in one place because both layers need the identical answer: same two
elements, still adjacent, and that adjacency still a side of the shape as it
now is. Its own docblock covers why all three clauses are needed.

## Who owns the revealed side

`ShapeVertexControls` owns it, in `_revealedA` / `_revealedB`. The ownership
follows the clearing routes: _every_ route that closes the button is local to
that layer — Escape, any click or tap that is not a drag, deselection, and —
derived per frame — the side ceasing to exist or ceasing to be able to take a
point. A second owner would have to be told about all four.

The properties panel owns the other half, resolving a clicked caption back to a
pair of vertex elements, because it is the layer that built the caption.

Three rules keep that split safe:

- **`revealSide()` is the one inbound setter, and it validates.** It refuses a
  pair this layer cannot resolve rather than storing it, so the state can never
  be one the layer would then have to defend — in particular a pair resolved a
  moment ago against a list that has since changed structurally.
- **`getRevealedSide()` is the one outbound read.** A field read from outside
  would turn renaming private state into a silent break of the feature, with no
  error anywhere.
- **The panel resolves against the element array _this_ render's chips were
  stamped against**, held in `lastRenderElsRef`. Pairing a chip's segment index
  with a list read at click time can name a different-but-still-adjacent side
  after a structural edit in between — the exact failure element-pair naming
  exists to prevent, reintroduced at the resolution step.

Everything the panel derives from the reveal — which caption is marked, which
captions are pinned — is computed at render time from that single owner. A value
derived at render cannot go stale, so there is nothing to invalidate, nothing to
publish and nothing to keep in sync.

## Deferred notification

`notifyRevealedSideChanged.js` and its sibling `notifyActiveVertexChanged.js`
emit on a microtask rather than synchronously, and carry **no payload**.

_Deferred_ because the reveal can be cleared from the controls layer's per-frame
hook, which runs from inside `scene.updateMatrixWorld`. A synchronous
notification there re-enters the readout renderer's `clear()`, which removes
CSS2DObjects from and disposes tube geometry under the shape entity's `object3D`
while a traversal of that same scene is in flight.

_No payload_ is what makes deferring safe rather than merely tolerable: a
consumer reads the current state from its single owner, so a late consumer reads
the truth rather than a snapshot taken at emit time.

Each notifier keeps **its own** `queued` flag. A shared flag would coalesce
scheduling but not emission — two event names still reach two subscriptions — so
it would save one microtask and buy an ordering trap where the second event name
is dropped while a notify is already pending. The coalescing that actually pays
lives on the consumer, which is where the cost of a rebuild lands
(`ShapeSidebar`'s `scheduleRender`).

They are modules rather than methods on the controls class because that class
imports the store through a path alias the test runner does not resolve, so
nothing defined in it is reachable from a unit test.

## The measurement chip: an outer/inner pair

Every measurement is two elements, built the same way whether or not it is a
control, so there is one DOM shape to reason about:

- the **outer** is what `CSS2DRenderer` positions. It rewrites
  `style.transform` on it every pass, so nothing of ours may go there.
- the **inner** is the visible chip.

Where a measurement is a control, the hit area is grown on the **outer** only
(`min-height: MIN_TAP_TARGET_PX`), which leaves the visible chip centred on its
anchor exactly as a non-control chip is.

Two consequences worth knowing:

- **The inner's rendered height is depended on elsewhere.**
  `shapeEditRules`' `CAPTION_HALF_PX` is half of it, and is what stands the
  insert button clear of the caption it is anchored to. Changing the font size,
  the line-height or the vertical padding has to be carried across. Nothing
  fails if it is not — the button simply drifts. The outer's taller hit box does
  **not** feed that number.
- **`CSS2DObject` sets `position: absolute` on the outer.** That is what stops a
  `pointer-events: auto` flex outer becoming a full-width band across the
  viewport.

### Why `pointer-events` is inline and `background` is not

`background` lives in the stylesheet because it is the one property with state
variants (hover, revealed, muted), and an inline declaration beats any rule
however specific.

`pointer-events` is written inline, on both branches, for the opposite reason:
it has no state variant — the branch is known at build time — and its failure
mode is the worst in the file. The same renderer draws the live preview while a
shape is being _drawn_, and a chip that took presses there would swallow the
click that places a point and oscillate the preview (the pointer entering the
chip leaves the canvas, firing the canvas `pointerleave` that destroys the chip,
which returns the pointer to the canvas). Written inline it is directly
assertable in a test environment that evaluates no stylesheet at all.

Interactivity is scoped **structurally** rather than by a condition:
`interaction` is a parameter of `renderAll` and of no other method, so the draw
preview's entry point (`renderActive`) has no parameter to pass.

## CSS2D draw order

`READOUT_RENDER_ORDER` in `shapeEditRules.js` is the single home for the three
bands — ordinary caption, revealed caption, on-canvas control — and its docblock
states why each boundary exists. Both layers import it; neither defines a band
of its own.

## Click versus drag

Two independent press baselines, and the distinction is the **scope of
capture**:

- `canvasPressX / canvasPressY` — recorded for presses on the canvas only, and
  read by the "did that click land on empty space" test that clears the
  sub-selection.
- `_windowPress` — recorded for a primary press wherever it lands, because the
  click that closes a revealed button can arrive from anywhere.

A drag is not a click, and the gate on that is required rather than defensive: a
press that becomes a drag _does_ dispatch a DOM click, so without the gate every
orbit would close the insert button — and changing the camera angle is exactly
what a user is told to do when the measurement they want is behind a nearer one.

The threshold itself is asked per pointer type (`clickMoveThreshold`). A
fingertip rolls several pixels during a deliberate tap, so the mouse's 4 px
classifies ordinary taps as drags; on touch the threshold is the handle's own
hit radius, so the rule reads "a press that never left the handle it started on
is a tap".
