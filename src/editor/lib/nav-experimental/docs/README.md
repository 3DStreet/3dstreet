# Experimental Navigation — Specification Docs

Specification of the experimental navigation controls
(`?nav=experimental`) as they currently stand. **These docs are not
user-facing** — they are for (a) Kieran and other upstream reviewers
evaluating the contribution, and (b) future maintainers of this code.

**Snapshot:** everything here describes the system as delivered onto the
`navigation` branch as of the merge of **PR #12**, at branch SHA
**`5f43d38d`** (`5f43d38dd40393c823c5e2198d8f54c8a2572b35`, merged
2026-06-06). It is a snapshot of how things work *now*, not a development
history — history appears only where it justifies a decision ("we tried X,
found problem Y"). Anything landing on the branch after this SHA is out of
scope and noted under Open Issues as forthcoming.

For codebase architecture and how `ExperimentalControls` slots into the
editor, see the code in this folder's parent and `viewport.js`; the docs
here cover the *specification*, not the file-by-file structure.

## The six documents

1. **[Overview](01-overview.md)** — the system at a glance: how to turn it
   on, the two-regime mental model, the four pillars (tilt-conditional
   controls, the swoop, presets, double-click), and the
   stay-out-of-solid-geometry invariant. Start here.
2. **[Key Decisions](02-key-decisions.md)** — every decision where a
   reasonable alternative existed and the choice mattered, with rationale
   and worked examples for the spatial/algorithmic mechanics. Decisions
   are identified `KD-NN`.
3. **[Configurable Thresholds](03-configurable-thresholds.md)** — the
   **single source of truth for every numeric value**, each verified
   against `constants.js`, with what it controls, whether it is
   runtime-configurable, and its working range. Thresholds are identified
   `TH-NN`. The four runtime-live knobs are enumerated up front.
4. **[Glossary](04-glossary.md)** — precise meanings of the terms of art,
   with disambiguation of the ones that have actually caused confusion
   (tilt-from-horizontal, AGL vs `camera.y`, collision floor vs travel
   height, Street mode vs at-street-level, grounded vs flying, diorama,
   swoop phases vs project phases…).
5. **[Open Issues](05-open-issues.md)** — deferred work, review gates
   (Kieran/feel-test), and spec-vs-code discrepancies found while writing
   these docs. Items are identified `OI-NN`.
6. **[Changes from the Proposal](06-changes-from-proposal.md)** — how the
   implemented system diverges from
   `reference/3D Street Navigation Proposal.md`. The highest-value doc for
   a reviewer who already knows the proposal.

## The ID scheme

These docs mint **one new global ID namespace** so any decision or
threshold can be cross-referenced unambiguously, with single-source-of-
truth discipline (no value or decision is restated in two places — every
other mention is a reference by ID):

- **`KD-NN`** — a **K**ey **D**ecision. Defined once, in
  `02-key-decisions.md`. Other docs reference decisions by ID, never
  restate the rationale.
- **`TH-NN`** — a **TH**reshold. Defined once, in
  `03-configurable-thresholds.md`, which is the *only* place a canonical
  number lives. Other docs reference thresholds by ID and **range**
  ("T", "the lateral cap `TH-16`"), never the number — so the docs can't
  drift against each other.
- **`OI-NN`** — an **O**pen **I**ssue, in `05-open-issues.md`.

The letters encode the kind (decision / threshold / open issue). This is a
*new* namespace deliberately distinct from the **older, inconsistent,
per-task identifiers** still scattered through the code comments —
`TASK-NNN` references and per-task letter tags (`D2`, `D-LT-3`, `DEC-B`,
`H4`, `LT-1`, `N3`, …). `03-configurable-thresholds.md` records those code
tags alongside each `TH-NN` so the new IDs cross-reference the old ones.
**Migrating the code comments to this namespace is out of scope here** and
is tracked as a standing open issue (`OI-1`).

## Sourcing

The **code is the source of truth** — for threshold values and the
runtime-config surface especially (`constants.js` and
`navTuningComponent.js`, both in this folder's parent). Every numeric value
in `03-configurable-thresholds.md` was verified against `constants.js` at
the snapshot SHA. These docs are the deliverable; they do not reference
external planning material.
