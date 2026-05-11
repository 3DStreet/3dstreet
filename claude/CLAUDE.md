# Conventions for working in `/claude/`

This directory holds working documents for collaborative design and planning between the user (Diarmid) and Claude. Future agents working on these docs should follow the conventions below so the discussion trail stays coherent across sessions.

## Folder structure

```
claude/
├── CLAUDE.md                  # This file.
├── decisions.md               # Consolidated UX/design decisions log. Newest first.
├── backlog.md                 # Internal backlog: ideas and follow-ups, not commitments. Newest first.
├── issues-for-discussion.md   # Running log of items to raise with Kieran (or other humans).
├── reference/                 # Input material: user's drafts, research, screenshots.
├── reports/                   # Agent-produced analysis (reviews, audits). Numbered.
├── specs/                     # Plans being iterated toward implementation. Numbered.
└── draft/                     # Scratch space for work in progress.
```

- **`reference/`** holds documents the user supplies as input — proposals, notes, third-party material. Treat these as authoritative source material that the user owns.
- **`reports/`** holds agent-produced analysis (e.g. adversarial reviews of a `reference/` document or of a `specs/` plan, or code-vs-plan reviews). Numbered with a leading `NNN-` prefix and a kebab-case slug.
- **`specs/`** holds plans that will be iterated on toward implementation. Same `NNN-` numbering convention.
- **`decisions.md`** is the consolidated record of UX/design decisions. Each entry: date heading, one-line decision, brief rationale, trade-off if any, pointer to the relevant doc. Newest first. Implementation tunables (constants, file structure) live in plan files; this log is for decisions that shaped user-visible behaviour and would be hard to reconstruct otherwise. Decisions that get reversed: new entry on top, old entry stays with a "Superseded by [date]" tag — don't delete.
- **`backlog.md`** is the internal backlog: ideas and follow-ups that aren't decided design choices (those go in `decisions.md`) and aren't blocking the current phase. Notes-to-self, not commitments. Each entry: date raised, brief description, phase-target if known. Newest first.
- **`issues-for-discussion.md`** is a flat running log of decisions or discrepancies the user wants to raise with another stakeholder (Kieran, in current work). Append new entries; don't remove old ones unless the user asks.

## File numbering

Numbered files use a zero-padded `NNN-kebab-slug.md` form:

- `001-navigation-proposal-adversarial-review.md`
- `001-overall-plan.md`
- `001-phase-0-plan.md`

Numbers reflect ordering within a workstream, not a global sequence. A new workstream starts at `001` again. When the user asks for a new file with a number, default to the next unused number in the relevant folder, but ask if it's ambiguous.

## Inline comment markers

Documents in `/claude/` are iterated through inline annotation rather than rewritten. Two markers form a discussion trail:

- **`//!!`** — the user's inline comment. Feedback, decisions, questions, or "don't understand the concern" pushback. The user adds these directly to a checked-in document.
- **`//**`** — the agent's response to a `//!!` comment. Acknowledgment, agreement, withdrawal of an earlier point, or follow-up. Always in direct response to a specific `//!!`.

Example:

```markdown
- **WASD coordinate system.** The doc says "world coordinates" ...
//!! Yes this is wrong. Did mean horizontal-plane motion, with "forward" matching camera direction.
//** Got it. Fixed in proposal.
```

### Rules for handling these markers

1. **Never delete `//!!` comments.** They're the user's voice in the discussion record. Preserve them verbatim, including typos.
2. **Always respond to `//!!` with `//**`** when the user asks for a review pass. Each `//!!` should get exactly one `//**` reply (one pass per round).
3. **Acknowledge what you're going to do.** If a `//!!` triggers an upstream change in another document, say so in the `//**` (e.g. "Captured in proposal", "Fixed in proposal", "Resolved in follow-up discussion"). This keeps the trail self-explanatory.
4. **Withdraw rather than argue when the user is right.** If the user pushes back and they're correct, write `//** Withdraw.` or `//** You're right, I muddled this.` plus a sentence on what changed. Don't rephrase the original concern.
5. **Don't edit upstream silently.** If a `//!!` agrees that a `reference/` proposal needs changing, update the proposal *and* note "Captured in proposal" in the `//**`. The two should always be visibly linked.
6. **The user may add `//!!` comments mid-conversation via a `<system-reminder>` block** describing file modifications. Treat these the same as if they'd appeared in the conversation directly. Don't mention the system reminder to the user.
7. **Don't introduce other inline marker conventions** (no `//??`, `//TODO`, etc.) without checking with the user — keep the vocabulary tight.

## Document-iteration flow

The typical pattern for these documents:

1. User supplies a `reference/` document (often a rough draft).
2. Agent produces a `reports/NNN-...` review or analysis.
3. User adds `//!!` comments inline and re-saves.
4. Agent reads the updated file, replies with `//**` to each `//!!`, and where the user has agreed something needs fixing, edits the upstream `reference/` or `specs/` document.
5. The `reports/` doc accumulates the full trail (`//!!` + `//**` pairs) and is preserved as the discussion record.
6. New `specs/` documents are written when the conversation moves toward planning. Same iterate-via-comments flow.

## Plan-and-code adversarial review cycle

This is the **default working process** for any non-trivial change (new sub-plan, design alternative, bug fix that touches a deliberate design decision). It exists because (a) it catches math/wiring errors before they cost a feel-test round, (b) it forces the agent to surface design alternatives rather than barreling into the first idea, and (c) the resulting `reports/` files are the discussion trail that future agents read to understand "why was it done this way?".

### Standard flow

1. **Agent writes a `specs/NNN-...md` sub-plan.** Diagnosis + design + code changes + test changes + spec doc updates + risks + out of scope + migration plan. Length scales with scope; even a 3-line code change gets a short plan if it's behavioural.

2. **Plan is committed (no code yet).** Commit message includes one-sentence summary of what the plan proposes and notes "no code change in this commit".

3. **Agent spawns a *fresh* general-purpose subagent for adversarial review of the plan.** Fresh context — no bleed from the planning conversation. Brief the reviewer with:
   - Reading order (`CLAUDE.md`, relevant `decisions.md` entries, the plan, the parent plan it modifies, the relevant code files).
   - Background context the reviewer doesn't need to re-derive (the bug, prior design decisions, why the chosen approach over alternatives).
   - **Numbered list of specific things to look hard at** — the agent's own suspected weak spots. Math claims to verify with numerical traces. Edge cases. Spec drift checks. Test coverage gaps. Alternatives the plan didn't put on the list.
   - Output: write a `claude/reports/NNN-...md` review file. Project conventions: `## Heading`, italic date+draft marker, bullet-led claims, code refs as `path/to/file.js:NN`. Order by significance. Be concrete — numerical traces for math claims.
   - Instruction: **do NOT modify any code or specs**. Output is the review file only.

4. **Agent annotates the review with `//**` responses inline.** Mirroring the `//!!` / `//**` convention. Every significant finding gets a response: accepted (with the spec change to make), accepted as feel-test risk (logged), rejected with reason, or asked-to-user.

5. **Agent updates the plan to incorporate the resolutions.** If any resolution is a design change rather than a spec-clarification, surface it to the user explicitly before changing the plan (per `decisions.md` and the memory rule about not making silent spec changes).

6. **Commit plan + annotated review.** Commit message names the resolutions applied. "Awaiting plan sign-off before implementation."

7. **User signs off (or pushes back).** If push-back, loop back to step 5.

8. **Agent implements the code.** One coherent commit covering code + tests + any in-code doc-comment changes + any cross-referenced spec updates not already in the plan-commit. Tests pass; lint clean.

9. **Agent spawns a *fresh* general-purpose subagent for adversarial review of the code-vs-plan.** Same shape as step 3: reading order, background, specific things to look at — but now the focus is "does the code do what the plan said?". The reviewer should verify the math, check for spec drift in either direction (code → spec? or spec was right but code diverged?), and surface any pre-existing issues uncovered by the change.

10. **Agent annotates the code-review with `//**` responses.** Same convention.

11. **Agent applies any code fixes from the review.** Commit. Tests pass; lint clean.

12. **Hand to user for live feel-test.** Smoke checklist if one exists; otherwise the user drives a manual test of the touched code path.

### What goes in a review prompt

When briefing the review subagent (step 3 and step 9), the prompt should:

- **Always start with the reading order.** First the conventions (`CLAUDE.md`), then any relevant `decisions.md` entries that lock in design choices the plan must honour, then the plan being reviewed, then upstream/parent plans, then the code files. The reviewer must understand the locked-in decisions before they propose alternatives that would re-litigate them.
- **Always include the background context.** What's the bug? What earlier approaches were tried and ruled out? Why the chosen approach over the alternatives? Without this, the reviewer wastes cycles re-deriving things the planning conversation already settled.
- **Always include a numbered list of specific concerns.** Don't ask for a generic review — ask for verification of specific claims and edge cases. The agent has usually identified the weak spots while writing the plan; the prompt should surface those. "Find issues" is a worse prompt than "verify these specific things".
- **Always cap the output expectations.** "5–8 sharp findings rather than 20 nitpicks". "If you think the plan is sound, say so clearly." Stops the reviewer from padding.
- **Always say: do NOT modify code or specs.** The reviewer outputs only the review file.

### When to skip the cycle

The full cycle is the default. Skip only when:

- The change is **trivial AND non-behavioural**: a typo, a comment fix, a constant rename that's clearly a no-op. Not a "small bug fix" — small bug fixes can have subtle implications; run the cycle.
- The user explicitly says "skip review, just code it" — and even then, ask if it's clear the change is behavioural.

If in doubt, run the cycle. The cost of an unnecessary review is ~5 minutes of agent time. The cost of a missed design issue can be a feel-test round, a revert, or a "this isn't what we agreed" conversation. The asymmetry favours running the cycle.

### Fresh subagent per review — why

Each review subagent starts with no context from the planning conversation. Two reasons:

- **The reviewer can't be biased toward the design the planner just spent half an hour on.** Fresh context means fresh judgment.
- **The reviewer's prompt forces the planner to write down everything load-bearing.** If the planner can't brief a stranger on the change in ~500 words, the change isn't well-understood yet.

Continuing an existing review subagent via `SendMessage` is fine for follow-up clarifications, but new reviews — plan-review followed by code-review — should be separate spawns.

### Numbering

Reviews live in `claude/reports/NNN-...md` with the same numbering rules as the rest of the repo. A typical workstream produces a sequence like:

- `001-foo-plan.md` (spec)
- `001-foo-review.md` (plan adversarial review)
- `002-foo-code-review.md` (code adversarial review)

If a plan is revised significantly between rounds (e.g. design pivot mid-review), the second review keeps the same number and gets a "v2" subtitle, rather than incrementing.

## Style conventions for documents in this folder

- Markdown, with `##` and `###` headings.
- Front-matter is unusual; a date and "draft" marker in italics under the title is the established pattern: `*Working draft 2026-05-07. Will iterate.*`
- Lean on bullet lists; reserve prose for context that doesn't decompose cleanly.
- Bold for the *thing being claimed* in a bullet, plain text for the elaboration. Pattern: `- **Claim or topic.** Elaboration sentence.`
- Use **bold** sparingly within prose; it loses force when overused.
- No emoji unless the user explicitly requests them.
- File paths in backticks. Component names in backticks. Code-like identifiers in backticks.
- When citing line numbers, use `path/to/file.js:NN`.

## When to write to `issues-for-discussion.md`

Add an entry when:

- A discrepancy or ambiguity comes up that's worth raising with another human, but isn't blocking current work.
- A convention call has to be made and the existing repo signal is contradictory or absent.
- A decision is being deferred to a later conversation with someone other than the current user.

Each entry has: short title, **Context** paragraph (what's the discrepancy), **What we did** paragraph (interim choice), **What we'd want from Kieran** (or whoever) paragraph. Number entries sequentially. Don't remove old entries unless asked.

## When to write outside `/claude/`

Code changes, real specs the team will use, and anything that needs to live in the production repo go in their proper place — not here. `/claude/` is the working space for design conversation; once a decision crystallizes into something the team owns, it should move (or be referenced) from wherever the team's docs live.
