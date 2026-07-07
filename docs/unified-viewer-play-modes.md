# Unified View / Play / Drive / Simulation — design proposal

Status: proposal for discussion. Reconciles three in-flight efforts:

- **Read-only "View" experience** for scenes you don't own
  (relates to #1267 access control, #1289 public usernames, #1325 remix-to-edit)
- **Play mode with vehicle physics + traffic** — PR #1627 (`physics-play-mode`)
- **Traffic replay from sensor data** — branch `claude/magical-faraday-on70it`

## TL;DR — the one core concept

> **There is exactly one non-editing presentation of a scene: the Viewer.
> Inside it, one Play/Pause lifecycle drives one simulation clock, and
> scene content decides which capabilities light up. Who you are only
> changes the buttons in the top bar — never the mode.**

The author pressing **Play** in the editor and a visitor opening a shared
link land in the **same state**. There is no separate "view mode",
"play mode", "drive mode", or "simulation mode" as far as the user-facing
model is concerned — those are all the Viewer, with different scene
content and different permissions.

For the 99.99% of scenes that are static, the Viewer is simply: the scene
rendered from the author's saved vantage, with walk/fly controls, under a
top bar showing title + author. No play controls appear because nothing
subscribes to the clock. A scene with a driveable vehicle, animated lanes,
or a sensor replay gets a Play/Pause control in the same top bar — nothing
else changes.

## Why this is one concept and not four

The features listed in the brief look different but decompose into five
small orthogonal axes. Three of them already exist in code or in-flight
branches; this proposal mostly *names* them and stops conflating them.
(This extends the "editor is not a mode" analysis in PR #1627's
`docs/play-mode-notes.md`, and matches axis D "Presentation" in #1267 —
which explicitly says Presentation must stay out of the access dialog.)

| Axis | Values | Where it lives |
| --- | --- | --- |
| **Presentation** | `editor` \| `viewer` | Exists today: `isInspectorEnabled` in `src/store.js` (inverted). The Viewer *is* "inspector closed", upgraded from an afterthought to a first-class surface. |
| **Permission** | can-edit \| view-only (later: #1267's full Access/Permission axes) | Exists minimally: `metadata.authorId` vs `currentUser.uid` (`SceneUtils.js` already forces save-as for non-authors). |
| **Play state** | `stopped` \| `playing` \| `paused` | PR #1627: `play-mode` system, `isPlaying`/`isPlayPaused` in store, `scene-timer.simulationTime` as the canonical deterministic clock. |
| **Capabilities** | drive, synthetic traffic, sensor replay, locomotion, XR/AR, (future: recorded playback, camera paths) | PR #1627's `mode-manager` registry + play-mode event subscribers. Derived from scene content, never a saved "mode" flag. |
| **Vantage** | saved start camera pose | Exists today: `memory.cameraState` + `memory.snapshots[].isDefault` + `?camera=` deep link — currently only feeds the *editor* fly-in. |

Every user story in the brief is a coordinate in this space:

| Story | Presentation | Permission | Play | Capabilities |
| --- | --- | --- | --- | --- |
| Visitor opens someone else's (static) scene | viewer | view-only | n/a (no subscribers) | locomotion |
| Author presses Play on a physics/race scene | viewer | can-edit | playing | drive (+ traffic) |
| Author disables editing, sets a start view | viewer (forced for others) | view-only | n/a | locomotion, vantage |
| Visitor moves around like the editor + WASD | viewer | either | any | locomotion |
| Author plays animated managed-street lanes | viewer | can-edit | playing | traffic, from current vantage |
| Sensor-data replay (magical-faraday branch) | viewer | either | playing | replay |

The two-way doors: **Play button = "switch Presentation to viewer and
start the clock."** **Stop / Edit button = "switch Presentation to editor"**
(which pauses the clock — PR #1627 already wires
`setIsInspectorEnabled(true)` → `play-mode.stop()`). A visitor without
edit permission simply has no Edit button — they get **Remix** (#1325)
instead. Same state machine, one button swapped.

## What exists today (verified against code)

**On `main`:**

- The editor/viewer toggle exists (`isInspectorEnabled`,
  `src/store.js:237`), but the only ways into viewer are `?viewer=true`
  (`src/editor/index.jsx:24`) and there is **no Play/View button** in the
  UI. `Toolbar.jsx` renders a lone "Edit" button *only while in viewer*.
- The legacy `viewer-mode` component (`src/aframe-components/viewer-mode.js`)
  carries three presets (locomotion / camera-path / ar-webxr). Its UI was
  removed in panels-v2 (PR #1566); camera-path is the default but never
  moves because `scene-timer` has `autoStart: false`. It is kept only so
  old scenes load.
- **No read-only gating**: any visitor gets the full editor for any scene.
  Ownership only affects save (non-authors are silently forced into
  save-as — the implicit "remix").
- **Saved vantage exists but isn't used for viewers**: on load,
  `set-loader-from-hash` resolves `memory.cameraState` → default snapshot →
  `?camera=` param, but the result only animates the *editor* camera
  fly-in (`viewport.js:429`). A plain viewer keeps `#camera` at `0 1.6 0`.

**On PR #1627 (`physics-play-mode`):**

- Adds exactly the right lifecycle: `play-mode` system
  (`start()`/`stop()`/`togglePause()`, `play-mode-start`/`-stop` scene
  events), `scene-timer.simulationTime` (deterministic, physics-stepped),
  `mode-manager` (registered enter/exit hooks per capability), and
  subscriber-style features (`drive-mode`, `street-traffic`) that don't
  know about each other.
- The Play button appears only when the scene has something playable
  (`useHasPlayable`) — correct instinct, generalized below.
- **Deletes** `viewer-mode.js`, the `#viewer-mode-ui` DOM, locomotion
  controls, and the AR/XR entry — currently leaving *nothing* for the
  plain-viewing case. This is the main thing to reconcile: the deletion
  is fine, but its replacement should be the Viewer described here, not
  just the drive-mode toolbar.

**On `claude/magical-faraday-on70it`:**

- `street-traffic-replay` proves the subscriber architecture generalizes:
  a self-contained layer that animates real sensor data off the same
  `simulationTime` clock, deterministic across machines, interchangeable
  with synthetic `street-traffic`. No changes needed to the play
  lifecycle to accommodate it. Future "recorded object movement" playback
  is the same shape.

## The Viewer, concretely

### Top bar (the marquee)

One React component, always present in viewer presentation, replacing both
the deleted `#viewer-mode-ui` and PR #1627's play toolbar
(`scenegraph/Toolbar.jsx` is its natural seed — it already renders only
when the inspector is closed):

```
┌────────────────────────────────────────────────────────────────────────┐
│ [logo]  Scene Title · by @username        [⏱ 00:12 ▶/⏸]   [ Edit ]    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Title + author username** — satisfies #1289. Requires the public
  username lookup from #1288/#1289 (scene JSON stores only the author
  uid today).
- **Play/Pause + sim clock** — rendered *only if* the scene has ≥1
  registered playable capability (generalized `useHasPlayable`). PR
  #1627's SIM readout/pause pill slots here unchanged. Static scenes never
  see it.
- **Primary action by permission**:
  - can-edit → **Edit** (→ editor presentation; pauses the clock)
  - view-only → **Remix** (#1325 — today's behavior of forced save-as,
    made explicit) or just **Sign in to remix**
- Optional secondary: fullscreen/present, share, XR entry (capability).
- A subtle "View only" affordance for non-editors, per the brief.

### Camera

- **Start pose**: reuse the exact resolution chain that already exists for
  the editor fly-in (`defaultSnapshot.cameraState` → `memory.cameraState` →
  `?camera=` override) and apply it to the **runtime camera rig** on
  viewer entry. This directly delivers "users see the camera view I last
  saved OR one I explicitly set": the screenshot modal already writes
  snapshots with `cameraState` and an `isDefault` flag — "set viewer start
  view" is just surfacing that flag in the screenshot modal and future
  scene settings. No new persistence format.
- **Controls**: resurrect the *locomotion* preset from deleted
  `viewer-mode` as the Viewer's default capability — `movement-controls`
  (WASD/arrows, fly) + `look-controls` click-drag, matching editor feel.
  Pointer lock is a later enhancement, not v1 (click-drag matches the
  editor and doesn't need an escape affordance).
- **Capabilities may borrow the camera** (drive's chase/fpv cams). On
  stop/exit they return it to locomotion at the pre-capture pose —
  `mode-manager` enter/exit hooks are exactly where this belongs.

### Play semantics

- `play-mode.start()` fires `play-mode-start`; every capability present in
  the scene responds independently (drive spawns the chassis + physics,
  `street-traffic` animates lanes, `street-traffic-replay` streams agents,
  future recording-playback plays its track). This is already PR #1627's
  architecture; the Viewer just makes it reachable by non-editors.
- Playing requires **no permission** — it mutates nothing persistent.
  Simulation state is never saved into the scene.
- Auto-play on viewer entry: **yes for ambient capabilities** (traffic,
  replay — a shared "living street" link should just move), **no for
  drive** (requires an explicit interaction/click so the visitor isn't
  dumped into a vehicle they didn't ask for). Per-capability flag in the
  registry, not a new mode.

### Entry rules

| How you arrive | Result |
| --- | --- |
| Owner/editor loads `#/scenes/UUID` | editor (unchanged today; a per-scene "open in viewer" preference can come later) |
| Non-editor loads `#/scenes/UUID` | **viewer** (new — today they get the full editor) |
| Editor presses Play (or `P`) | viewer + `playState=playing` |
| Viewer presses Edit | editor (pauses clock) — or Remix flow if view-only |
| `?viewer=true` / share/present link | viewer, regardless of permission |

Note this needs **no access-control backend**: "non-editor sees viewer"
is pure Presentation, decided client-side from `authorId !==
currentUser.uid`, exactly the check save-as uses today. When #1267 lands
its Access/Permission axes, the same entry rule reads the real permission
instead — nothing else changes. (This is why #1267 insists Presentation
stays out of the access dialog: it composes.)

## Phasing

Each phase is independently shippable; 1–3 have no dependency on #1267.

**Phase 0 — land the lifecycle (PR #1627, minus the viewer gap).**
Keep `play-mode`, `mode-manager`, `simulationTime`, drive, traffic.
Treat its play toolbar as the seed of the Viewer top bar rather than a
drive-specific UI. Also adopt its parked "editor is not a mode" fix:
capabilities enter/exit on scene content changes, `play-mode` only
starts/pauses the clock, the inspector toggle is purely Presentation.

**Phase 1 — Viewer MVP (static scenes).**
Viewer top bar (title, author username, Edit button); locomotion camera
controls; start pose applied from the existing snapshot/cameraState chain;
"set as viewer start view" surfaced in the screenshot modal. Delete the
legacy `viewer-mode` component + its json-utils round-trip wiring (PR
#1627 already removes the component; the wiring note in its header says
to keep it *until this lands* — this is that landing).

**Phase 2 — viewer-first for non-editors.**
Non-owners land in the Viewer; Edit becomes Remix (#1325's flow, i.e.
today's forced save-as made visible). Requires public usernames (#1288/
#1289) for the byline; ship with uid-derived fallback if usernames slip.

**Phase 3 — play controls in the Viewer.**
Generalize `useHasPlayable` into the capability registry
(`mode-manager.hasPlayable()`); Play/Pause + sim clock appear in the top
bar for editors *and* visitors; ambient auto-play flags; drive's
click-to-enter. The magical-faraday replay layer plugs in with zero
lifecycle changes.

**Phase 4 — access control & polish (tracks #1267).**
`Only me` / link scopes gate who can *load* the scene at all; Presentation
is already orthogonal so nothing here changes. Later: pointer lock,
XR/AR as a registered capability (restoring what #1627 deleted, behind
the same registry), per-scene "open in viewer" owner preference, viewer
URL/embed ("Open in Viewer mode" button from #1267's share modal sketch).

## Open questions

1. **Owner default**: should owners *also* land in the Viewer (view-first
   like docs tools)? Recommend no for now — 3DStreet sessions are
   overwhelmingly editing sessions — but the entry rule makes it a
   one-line preference later.
2. **Does Play exist in editor presentation at all?** PR #1627 says no
   (Play closes the inspector). Keep that: previewing simulation *is*
   viewing. Revisit only if "tweak-while-simulating" becomes a real need
   (the parked chassis-persistence work heads that way).
3. **Username availability** (#1288): what's the fallback byline before
   public usernames ship — display name, "a 3DStreet creator", or hide?
4. **Naming** — resolved: the button is **"Start"**. "View" collides with
   the View app menu; "Play" only reads well in English and localized into
   the media-player sense (es "Reproducir", pt-BR "Reproduzir", fr "Lecture"),
   which misdescribes what the button does. "Start" pairs with the
   Stop/Reset/Pause shuttle, reads for a lay (non-gamer) audience, and
   translates unambiguously (Iniciar / Démarrer). On static scenes Start
   simply presents the scene read-only; the simulation clock only starts when
   a playable capability is registered. A future per-capability label (say
   "Drive" on a driving scene) can specialize it — the capability registry
   already knows which case applies.

## Implementation status — PR #1812

Landed on this branch (supersedes #1627; magical-faraday fully absorbed):

- **Phase 0** ✅ lifecycle: `play-mode` system, `scene-timer.simulationTime`,
  `mode-manager` with registered control modes (editor / locomotion / drive)
  and the playable-capability registry that gates all Play UI.
- **Phase 1** ✅ Viewer MVP: viewer top bar reusing the editor's hidden-panels
  chrome; locomotion camera; saved-vantage resolution chain; legacy
  `viewer-mode` component + its json-utils round-trip removed.
- **Phase 2** ✅ viewer-first for non-editors: non-owners land in the Viewer;
  Edit → Remix (unauthed, sign-in at save). Byline shows only for signed-in
  visitors (Firestore `socialProfile` rule; anonymous fallback is title +
  VIEW ONLY, pending #1288/#1289).
- **Phase 3** ◐ play controls in the Viewer: Start/Pause/Reset/Stop + sim
  clock appear for **any** viewer of a scene with a registered playable
  capability (owner or visitor) — playing is permissionless. The ms sim clock
  shows only in drive mode. Capabilities shipped: physics **drive** (Rapier,
  code-split WASM/JS chunk, lazy-loaded on first Start) and **traffic-sensor
  replay**, plus synthetic `street-traffic`. **Deferred:** per-capability
  *ambient auto-play* (a traffic/replay link starting to move on entry without
  a click) — needs an `ambient` flag on the registry; drive would stay
  click-to-enter. Today a visitor presses Start to bring an ambient scene to
  life.
- **Phase 4** ⏳ access control & XR-as-capability: unchanged, tracks #1267.
