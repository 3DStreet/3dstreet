# Shape vertex editing — the on-canvas layer

A selected `shape` gets an editing overlay: a draggable handle per vertex, a
delete button on the sub-selected vertex, and length and angle measurements on
every side and corner. How a side takes a new vertex depends on the input:
**under a hovering pointer the side's own measurement becomes the "+"**, and on
an input with no hover a separate insert ("+") button appears above the
measurement that was tapped. The next section says why the two differ.

Six modules cooperate, and the split is by _who can answer the question_:

| Module                                           | Owns                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/editor/lib/ShapeVertexControls.js`          | the handles, both on-canvas buttons, every gesture, and **which side is revealed** |
| `src/editor/components/elements/ShapeSidebar.js` | the properties panel, and the render of the measurements                           |
| `src/editor/lib/ShapeReadouts.js`                | building measurement chips as CSS2D DOM billboards                                 |
| `src/editor/lib/shapeEditRules.js`               | the pure rules all of the above agree on                                           |
| `src/editor/lib/forwardWheelToCanvas.js`         | handing the wheel back to the camera from every control that took the pointer      |
| `src/editor/style/index.scss`                    | the chips' and buttons' state variants — including the hover morph itself          |

## Why mouse and touch differ

The morph is given to a hovering pointer and withheld from a finger, and the
reason is **dismissal**, not capability.

On a hovering pointer there is nothing to dismiss: move away and the chip is a
number again. Hover is not state — it is a condition the browser tracks, which
is also why owning it here in JS would be a mistake.

Touch has no such gesture. A "+" opened by a tap clears only when you tap
something else, and that tap does whatever tapping that thing does. Under the
two-step model that is tolerable, because the stray artefact is a small button
and **the measurement is still there and still readable**. Under a morph it
would not be: a mis-tap would replace the number with a "+" and leave it
replaced until you tapped elsewhere — costing the readout the panel exists to
show, on the input type where mis-taps are likeliest. And "tap it again" cannot
be the escape, because that is the insert.

So the two inputs look different because they _are_ different. The cost is that
`activateSide` branches, and the branch must agree with the stylesheet: see
below.

### One predicate, read from one place

The stylesheet morphs inside `@media (hover: hover)` and on nothing else.
`activateSide` reads that same query back through `matchMedia` rather than
asserting a second, independent answer, and additionally requires the recorded
press to be a `mouse` or a `pen`. Both terms are load-bearing, and each is
there for a real device:

- **Drop the media query** and a mouse on a touch-primary tablet inserts a
  vertex having never been shown a "+".
- **Drop the pointer-type test** — or write it as a blacklist on `'touch'` —
  and a hovering stylus, or a click this layer saw no press for at all, takes
  the destructive branch.

### The dwell survives a rebuild, and that is not obvious

The 200 ms dwell is a `transition-delay`, so it belongs to the chip element —
and chips are destroyed and rebuilt on every geometry change. The obvious worry
is that a rebuild under a stationary pointer restarts the delay, or drops the
hover entirely, so the "+" flickers back to a number while the user is aiming at
it.

It does not. Verified on the branch: with the pointer resting on a morphed chip
and never moved, an undo, a redo and a second undo each destroy and rebuild every
chip, and the "+" stays throughout. The browser re-runs hit-testing after the
mutation and the replacement element is `:hover` immediately, with the delay
already elapsed.

Worth stating because the alternative — owning the dwell in JavaScript, keyed to
the side rather than the element — is the design this one was chosen over, and
the whole argument for it was this hazard.

`@media (hover: hover)` is _not_ a touch-only exclusion: a touch-only Windows
tablet reports `hover: hover`, because Windows always exposes a virtual mouse.
The pointer-type test is what actually keeps a finger out.

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

**On a hovering pointer this state is never entered** — the chip itself is the
button, so there is nothing to reveal and nothing to close. Everything below
describes the path an input without hover takes, and the path a hovering pointer
still reaches when a button left open by a finger has to be closed.

`ShapeVertexControls` owns it, in `_revealedA` / `_revealedB`. The ownership
follows the clearing routes: _every_ route that closes the button is local to
that layer — Escape, any click or tap that is not a drag, deselection, and —
derived per frame — the side ceasing to exist or ceasing to be able to take a
point. A second owner would have to be told about all four.

The properties panel owns the other half, resolving a clicked caption back to a
pair of vertex elements, because it is the layer that built the caption.

Three rules keep that split safe:

- **Both setters validate.** `activateSide()` is the one inbound entry — what a
  press on a measurement actually calls — and it decides from the press record
  whether that press reveals or inserts; `revealSide()` is the internal
  reveal-only entry it delegates to. Each refuses a
  pair this layer cannot resolve rather than storing it, so the state can never
  be one the layer would then have to defend — in particular a pair resolved a
  moment ago against a list that has since changed structurally. The branch
  lives in this layer rather than in the panel because **this** is where the
  press record lives, so there is one press baseline rather than two agreeing
  by luck.
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

They are modules rather than methods on the controls class for a reason that has
since expired: that class imports the store through a path alias the test runner
did not resolve, so nothing defined in it was reachable from a unit test. The
alias is now in `vitest.config.js` and the class is directly testable. The split
is kept because the deferral logic is worth reading on its own and nothing is
gained by folding it back in — but it is no longer a constraint, and a new
method does not have to be exiled to reach a test.

## The measurement chip: an outer/inner pair

Every measurement is two elements:

- the **outer** is what `CSS2DRenderer` positions. It rewrites
  `style.transform` on it every pass, so nothing of ours may go there.
- the **inner** is the visible chip.

Where a measurement is a control, the hit area is grown on the **outer** only
(`min-height: MIN_TAP_TARGET_PX`), which leaves the visible chip centred on its
anchor exactly as a non-control chip is.

What the inner **contains** is where the two branches part, and it is the one
place the DOM shape is not uniform:

- an ordinary caption is a single text node;
- an insertable one holds two spans — `.shape-readout-value`, carrying the
  number, and `.shape-readout-plus`, carrying the glyph that replaces it under a
  hovering pointer.

That is the **footprint lock**, and it is a mechanism constraint rather than
styling. A chip is content-sized, so swapping "4.20 m" for "+" would shrink it,
which can drop the cursor outside the box, which un-hovers it, which reverts it,
which puts the cursor back inside — a flicker loop, and one a dwell makes slower
rather than fixes. Only the value span occupies layout (the plus is absolutely
positioned), so the box is **always** the number's box, pinned by construction
rather than by an explicit width a later reader would tidy away. The swap is
`visibility`; `display: none` would collapse the box and bring the loop back.

Two further consequences worth knowing:

- **The inner's rendered height is depended on elsewhere.**
  `shapeEditRules`' `CAPTION_HALF_PX` is half of it, and is what stands the
  insert button clear of the caption it is anchored to. Changing the font size,
  the line-height or the vertical padding has to be carried across. Nothing
  fails if it is not — the button simply drifts. The outer's taller hit box does
  **not** feed that number, and neither does the plus span: it is out of flow, so
  the constant stays true of both chip constructions.
- **`CSS2DObject` sets `position: absolute` on the outer.** That is what stops a
  `pointer-events: auto` flex outer becoming a full-width band across the
  viewport.

### Why `pointer-events` is inline and `background` is not

`background` lives in the stylesheet because it has state variants (hover,
revealed, muted), and an inline declaration beats any rule however specific. So
does the `visibility` of the two spans, whose variant _is_ the morph; so does the
delete button's `background`, now that it has a hover and a pressed state. Its
`color` deliberately stays inline: it has no variant, and the icon is
`stroke="currentColor"`, so a class that failed to match would leave a black icon
on a dark scene — invisible, and undetectable by a suite that evaluates no
stylesheet.

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

The CSS2D layer has an ordering of its own, unrelated to the scene's: the
renderer sorts by `renderOrder` first and camera distance second, and writes
`element.style.zIndex` itself on every pass — so a CSS `z-index` set anywhere
else is erased each frame and `renderOrder` is the only control that works.
These numbers share a property name with the scene's `renderOrder` and nothing
else: the CSS2D sort sees only `CSS2DObject`s, so a mesh's `renderOrder` is
invisible to it.

`READOUT_RENDER_ORDER` in `shapeEditRules.js` is the single home for the four
bands. Both layers import it; neither defines a band of its own.

Each boundary earns its place. `control` on top is what keeps a caption from
being drawn over a button, which is the one thing accepting overlap depends on.
`revealedCaption` below it keeps a neighbouring caption from covering the number
the user has to click and keep sight of while reaching for the button beside it.
`insertableCaption` lifts a side length that _is_ a control clear of one that is
not, so an ordinary caption cannot cover the affordance a hovering pointer
summons in place of the number.

What `insertableCaption` does **not** fix, said plainly because the band is not
free: two insertable chips against each other. On the overwhelmingly common
shape every side can take a vertex, so chip-on-chip crowding is largely outside
what this boundary reaches.

And what it **costs**, which crosses a feature boundary. An insertable length
chip now draws over an angle caption and a muted caption regardless of camera
distance, where the three were previously distance-sorted against each other.
Beyond this feature: the shape's own area label and every measure-line label are
`CSS2DObject`s with no `renderOrder` at all — band 0 — so a length chip draws
over those too, and the area label is anchored at the centroid, the most crowded
spot on a small shape. Accepted: a control the user is reaching for beats a
caption they are not.

## Why the on-canvas controls forward the wheel

Every control this layer draws — an insertable chip, the insert button, the
delete button — must be `pointer-events: auto` to be hovered or pressed at all.
That also makes it take the **wheel**, and the camera's zoom handlers are bound
on the canvas, which is _not_ one of their ancestors: the CSS2D container is a
sibling of it under `document.body`. So without forwarding, scroll-zoom silently
stops working wherever one of these is drawn, and resting the pointer on a
measurement is this feature's main gesture.

`forwardWheelToCanvas` re-dispatches at the canvas — never at `document`, where
the clone's inherited `bubbles: true` would let a listener bound higher see its
own event come back. It is bound per element rather than once on `document`
because `{ passive: false }` there would opt the whole app out of the compositor
scroll fast path for the life of every shape selection.

## Click versus drag

Two independent press baselines, and the distinction is the **scope of
capture**:

- `canvasPressX / canvasPressY` — recorded for presses on the canvas only, and
  read by the "did that click land on empty space" test that clears the
  sub-selection.
- `_windowPress` — recorded for a primary press wherever it lands, because the
  click that closes a revealed button can arrive from anywhere. It is cleared by
  `detach()`, so a click with no preceding `pointerdown` — a synthetic
  `el.click()`, an automation — cannot be judged against a previous gesture's
  verdict.

A drag is not a click, and the gate on that is required rather than defensive: a
press that becomes a drag _does_ dispatch a DOM click, so without the gate every
orbit would close the insert button — and changing the camera angle is exactly
what a user is told to do when the measurement they want is behind a nearer one.

**One route through this gate now commits a history command**, which raises what
being wrong costs. A press on a measurement that a hovering pointer took the
insert branch on inserts a vertex; ungated, a failed orbit that started on a chip
would commit one, and the natural response to a camera that did not move is to
try again — committing another. That gate lives on `activateSide`'s inserting
branch specifically, and **not** on the panel's click handler: a tap that drifts
a few pixels within one chip is still a tap on it, and on the non-hovering path
it only opens a button, so gating at the panel would swallow an ordinary sloppy
tap for nothing.

The threshold itself is asked per pointer type (`clickMoveThreshold`), and the
**mouse is the exception rather than touch the special case**. The tight
`CLICK_MOVE_THRESHOLD` is only safe where the input can be aimed to the pixel; a
fingertip rolls several pixels during a deliberate tap and a stylus wobbles about
as much, so both — and an unknown pointer type — get
`TOUCH_CLICK_MOVE_THRESHOLD`, which is the handle's own hit radius. The rule then
reads "a press that never left the handle it started on is a tap".

Widening that answer beyond touch moves one unrelated behaviour with it: the
release-on-bare-canvas test that clears the sub-selection asks the same
question, so a pen press on empty canvas that wobbles 5–10 px now clears the
active vertex where before it was judged a drag and left it alone. That is the
same direction touch already took, and it is what "a press that never left the
handle it started on is a tap" says for every imprecise pointer — consistency
with the rule rather than a carve-out for one route.
