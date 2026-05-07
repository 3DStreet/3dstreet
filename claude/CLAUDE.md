# Conventions for working in `/claude/`

This directory holds working documents for collaborative design and planning between the user (Diarmid) and Claude. Future agents working on these docs should follow the conventions below so the discussion trail stays coherent across sessions.

## Folder structure

```
claude/
├── CLAUDE.md                  # This file.
├── issues-for-discussion.md   # Running log of items to raise with Kieran (or other humans).
├── reference/                 # Input material: user's drafts, research, screenshots.
├── reports/                   # Agent-produced analysis (reviews, audits). Numbered.
├── specs/                     # Plans being iterated toward implementation. Numbered.
└── draft/                     # Scratch space for work in progress.
```

- **`reference/`** holds documents the user supplies as input — proposals, notes, third-party material. Treat these as authoritative source material that the user owns.
- **`reports/`** holds agent-produced analysis (e.g. adversarial reviews of a `reference/` document). Numbered with a leading `NNN-` prefix and a kebab-case slug.
- **`specs/`** holds plans that will be iterated on toward implementation. Same `NNN-` numbering convention.
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
