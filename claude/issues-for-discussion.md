# Issues for Discussion with Kieran

Running log of discrepancies, ambiguities, and decisions worth raising with Kieran rather than resolving silently. Each entry: short title, context, what we did in the meantime, what we'd want from Kieran.

---

## 1. Test-file location: README "best practice" vs actual repo behavior

**Context.** `test/README.md` lists "Co-locate when possible: Consider `__tests__/` dirs in source" under Best Practices. But no test in the repo actually does this — every existing test sits under `test/<app>/<mirrored source path>` (e.g. `test/generator/...`, `test/shared/...`, `test/core/...`). The `test/editor/` directory is anticipated by the README ("🔜 Editor needs tests") but doesn't exist yet, so we're the first to populate it.

**What we did.** Followed the dominant pattern: Phase 0 nav tests will live under `test/editor/lib/nav-experimental/`, mirroring source structure. This is the path of least surprise for anyone reading existing tests, and Vitest picks them up with no config change.

**What we'd want from Kieran.** A view on whether the README's "co-locate" line reflects an intent that hasn't been actioned (in which case maybe we should be the ones to start it) or is stale advice that should be removed. Either way, worth aligning the README with reality so future contributors aren't pulled in two directions.
