# Viewer / Play UI — open questions and direction

Working notes from reviewing the unified Viewer/Play UI (PR #1812). Captures
the design tensions surfaced in testing and the direction we're converging on.
None of this blocked the PR; these are refinements layered on what shipped.

Tracking: [#1824](https://github.com/3DStreet/3dstreet/issues/1824) (Q1–Q4 +
Remix edge cases), [#1825](https://github.com/3DStreet/3dstreet/issues/1825)
(creator byline for unauthenticated viewers).

## Framing: three classes of control, not one

The viewer chrome mixes controls that behave differently. Separating them
resolves most of the tension:

- **Mode** — Edit vs View. A persistent state (which chrome + permissions).
- **Transport** — Start / Stop / Pause / Reset. Controls a *time-based
  simulation* that only exists inside View, and only when there is animated
  content to run.
- **Navigation** — walk / orbit. Always available in View; not "transport."

The mechanism that ties this together already exists: the `mode-manager`
**playable-capability registry** (`registerPlayableCheck`). That is the
"provider" concept. Everything below leans on it.

Entry model we're adopting (revised during #1824 implementation): **entering
View lands idle; Start is always explicit.** Autoplay-on-entry was prototyped
and pulled back — a drive provider hijacks the camera on play-start, so
autoplay had to special-case drive scenes anyway; making every viewer entry
idle-first is simpler and treats all providers the same. A per-scene
`memory.autoplay` opt-in can be revisited later if wanted (the machinery is in
git history).

## Q1 — Stop vs Edit

Depth stack: `Edit ⊃ View ⊃ Playing`. Escape pops one level (already true).
Stop pops the *simulation*; Edit pops the *mode*. They are different
transitions, so not literally one button — but the two-step is redundant for an
owner who entered Play from the editor.

**Direction:** make Stop **entry-aware**. Entered Play from the editor → Stop
returns to the editor. Visitor (no editor origin) → Stop returns to View-idle.
Same control, context-aware destination. With that, keeping a separate Edit
affordance is fine.

**Shipped:** `play-mode.start({ origin })` stamps the entry origin into the
store; every stop affordance (viewer Stop button, Escape, gamepad Back) routes
through `store.stopPlaying()`, which picks the destination. View entry lands
idle — Start is always an explicit action (see the entry-model note above).

## Q2 — Snapshot in View

A blocking modal mid-flow pulls the user out; pause-then-resume is jarring and
corrupts a drive run.

**Direction:**
- **View mode:** the current capture button/icon is **capture-only** — instant
  capture, non-blocking toast + thumbnail, saved to the user's shots/assets. No
  modal, no pause. AI rendering happens later from the gallery (async), which
  also batches the funnel better than one-off interrupts.
- **Editor:** the richer action can be labeled to signal intent, e.g.
  **"Capture & Render"** (distinct action) or **"Capture…"** (ellipsis = opens
  the modal).

**Shipped:** viewer right dock has a capture-only camera button
(`ViewerSnapshot.jsx`): instant screentock capture, thumbnail toast
(click-to-download), background save to the signed-in user's gallery
(`source: 'viewer-snapshot'`); no modal, no pause. The editor toolbar button
is relabeled **Capture & Render**.

## Q3 — Enter/exit asymmetry, mode as a toggle

Root cause: two control *kinds* placed by two conventions. Start follows the
media convention (center); Edit/Remix follows the app convention (corner). So
"enter" reads as transport and "exit" reads as mode-switch.

With Q1 (Stop → editor) the redundancy is mostly gone, and keeping Edit to
return is fine. Remaining question: **as an editor user with no provider (no
center Start), do we also want a dedicated "View" button in the corner?**

**Emerging model (see Q4):** the single center button already answers most of
this — it reads **"View"** when there's no provider and **"Start"** when there
is. Still open: whether to add a consistent-location mode toggle (Edit ⇄ View
in the same corner both directions) and give **Remix** extra prominence for
visitors (it is the conversion moment), while Edit stays a quiet corner utility
for owners.

## Q4 — "Start" with nothing to animate

The concept the user reached for ("a provider that provides animation") is the
`mode-manager` registry. The current model conflated "there's a timed
simulation" with "you can move the camera."

**Direction:**
- Gate transport (Start/Stop + clock) on a **simulation provider** (traffic,
  replay, drive). No provider → no transport.
- **Navigation** (walk/orbit) becomes its own always-available affordance, never
  behind Start.
- Make the label **provider-declared**: graduate `registerPlayableCheck` from a
  boolean to a descriptor `{ label, hasTimeline, kind }` so the button can read
  "Drive" / "Play traffic" / "Play recording" and the clock shows only when
  `hasTimeline`.
- Shader ambiance (grass sway, ocean) is always-on, not a provider, and
  correctly does not trigger Start.

**Shipped as a first step:** the editor's center button was hardcoded "Start"
even with no provider. It now reads **"View"** (faEye) when `!hasPlayable` and
**"Start"** (faPlay) when playable, so "Start" = View + Play and "View" = enter
the read-only presentation. (`PrimaryToolbar.jsx`, commit on branch.)

## Loose end — Remix flow edge cases

For a local, unauthenticated, unsaved scene with edits, the viewer shows
**"Remix"** (should be Edit — the user is effectively the author of their own
draft), and making changes doesn't prompt login/save. The Remix/Edit label and
the save/login prompting need to account for: unsaved local drafts, unauthed
users, and edits made after entering the editor from a non-authored scene.

**Shipped (v1):** the action is always **"Edit"** — Remix is gone as
vocabulary. A signed-out visitor on a cloud scene gets **"Sign in to Edit"**
(button and Escape both open the sign-in modal). A signed-in non-author who
enters the editor gets a warning toast — "This is an unsaved copy. Click Save
to make your own copy." — and saving forks via the existing save-as-fork flow.
Local drafts (no authorId) keep Edit with no auth requirement.

## Loose end — creator byline for unauthenticated viewers

`socialProfile` reads require auth (`firestore.rules`), so signed-out visitors
get no "by {creator}" byline. Fix by denormalizing the creator's public
username onto the scene doc at save time, or making public-profile reads
unauthenticated (aligns with per-user public profile URLs on the roadmap).
Tracked separately.
