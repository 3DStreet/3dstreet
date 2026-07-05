# Managed Street Buildings — WIP / Continuation Notes

Branch: `managed-street-buildings`
Last updated: 2026-06-24

This is a session-handoff doc. It captures the state of the buildings work so it
can resume with fresh context. The **angled parking stripe fix** that was
developed alongside this has been split out to its own branch (see below) so it
is not blocked by the buildings work.

## Goal of this branch

Import Streetmix "boundary" buildings into `managed-street` (new in commit
`d244288a` "mvp building import from streetmix"), and make the Streetmix import
**parity test** (`npm run test:parity`) able to compare the travelled way with a
unified buildings toggle across both the legacy and managed import paths.

We are **not ready to render buildings in the managed parity comparison yet** —
the immediate aim is parity of the travelled way (buildings off on both sides),
then later flip the toggle on to test building parity.

## What is already split OUT of this branch (do not redo)

The **angled parking stripe fix** lives on its own branch off `main`:

- Branch: `fix/angled-parking-striping` (pushed)
- One-line behavior change in `src/aframe-components/managed-street.js`: sideways/
  angled parking stripes now use `stencilDirection = 'none'` (absolute facing,
  matching the parked cars `carDirection: 'none'`) instead of
  `stencilDirection = direction`. The `direction` (= `'outbound'` for angled
  lanes) path made `street-generated-stencil` negate the angle
  (`rotationY = 0 - facing`), flipping the stripe to the opposite angle from the
  car beside it.
- Verified against the `marina-parking-street` fixture: stripes now match
  legacy's herringbone. This fix is **also present** in this branch's working
  tree (it is harmless duplication; it will reconcile when the parking PR merges
  to `main` and this branch rebases).

## Buildings work — current state (in this branch)

### Design decision (agreed)

`showBuildings` is an **import-time conversion argument**, NOT a `managed-street`
schema property. A schema prop that only takes effect at import (and silently
no-ops at runtime) is a broken A-Frame contract. Buildings are decided once,
during the Streetmix → managed conversion; once imported they are ordinary
`street-segment` children (saved/loaded via json-blob, individually editable and
deletable). A live per-scene buildings toggle is a **separate future feature**
(decide hide-vs-delete, add a UI control + undo/redo command).

### Code changes present in the working tree

`src/aframe-components/managed-street.js`
- `loadAndParseStreetmixURL(streetmixURL, showBuildings = true)` — new
  `showBuildings` conversion argument; defaults `true` so the app keeps
  buildings. `refreshFromSource()` calls it with the default.
- The building-creation block gates `createStreetmixBuildingElement` for left/
  right boundaries on that argument.

`test/parity/compare-imports.mjs`
- `SHOW_BUILDINGS = false` constant applied to BOTH paths:
  - legacy: passed as `streetmix-loader.showBuildings`.
  - managed: the trigger drops `synchronize: true`, waits for the component to
    exist, then calls `loadAndParseStreetmixURL(url, SHOW_BUILDINGS)` directly so
    it can pass the conversion argument.
- Flip `SHOW_BUILDINGS` to `true` later to test building parity once both paths
  render buildings the same way.

## KNOWN ISSUES — start here next session

### 1. Elevated pageerrors in the full parity run (regression from the new managed trigger)

Running the full `npm run test:parity` produces errors on several fixtures:

```
[pageerror] Cannot read properties of undefined (reading '724fd06c-53d3-4854-8090-be4ef717cc25')
```

- The uuid recurs across different fixtures (`724fd06c…` on bikeway-demonstration,
  downtown-main, protected-bikeway-couplet; `738833c9…` on landscaped-median).
  The harness **seeds `Math.random`**, so these uuids are deterministic and
  repeat — the error is an **ordering/race**, not data corruption.
- Root cause hypothesis: the new managed trigger calls
  `loadAndParseStreetmixURL()` as soon as `el.components['managed-street']`
  *exists*, which is **before the entity's `street-align`/`street-ground`
  components have loaded**. The conversion runs against a half-initialized
  entity. The old `synchronize: true` path drove the import through the normal
  component `update()` lifecycle, which sequenced this correctly.
- In **isolation** (`npm run test:parity -- --filter=marina`) the managed render
  is correctly building-free and matches (~16.9%); the race only bites under the
  full sequential run.

### 2. Buildings still appear in managed during the full run

Same root cause as #1 — under the full-run race the conversion argument path does
not reliably take effect (or a partially-initialized import path runs), so
buildings leak into the managed render and marina climbs back to ~18%.

### Recommended fix for next session

Make the managed trigger wait for the **entity `loaded` event** (or the
`street-align`/`street-ground` components to be ready) before calling
`loadAndParseStreetmixURL`, instead of just waiting for the component to exist.
Keep the `showBuildings` conversion argument (the design is right) — only the
*timing* of the call needs hardening. Alternatively, restore a lifecycle-driven
trigger that still threads the conversion argument (e.g. a transient instance
field set immediately before a `synchronize`-driven refresh, then cleared).

After fixing, re-run the full `npm run test:parity` and confirm: zero pageerrors,
no buildings in any managed render, and marina back to ~16–17% (residual is
random car placement, which is inherent test noise).

## How to run

```bash
npm start                                   # dev server on :3333 (required)
npm run test:parity                         # all fixtures
npm run test:parity -- --filter=marina      # angled-parking fixture (isolation)
```

Output images + report land in `test/parity/output/` (gitignored):
`<slug>-{legacy,managed,diff}.png`.

The `marina-parking-street` fixture covers all 8 angled-parking variants; it is
the one to watch for the parking stripe fix and for buildings leakage.
