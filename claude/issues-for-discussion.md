# Issues for Discussion with Kieran

Running log of discrepancies, ambiguities, and decisions worth raising with Kieran rather than resolving silently. Each entry: short title, context, what we did in the meantime, what we'd want from Kieran.

---

## 1. Test-file location: README "best practice" vs actual repo behavior

**Context.** `test/README.md` lists "Co-locate when possible: Consider `__tests__/` dirs in source" under Best Practices. But no test in the repo actually does this — every existing test sits under `test/<app>/<mirrored source path>` (e.g. `test/generator/...`, `test/shared/...`, `test/core/...`). The `test/editor/` directory is anticipated by the README ("🔜 Editor needs tests") but doesn't exist yet, so we're the first to populate it.

**What we did.** Followed the dominant pattern: Phase 0 nav tests will live under `test/editor/lib/nav-experimental/`, mirroring source structure. This is the path of least surprise for anyone reading existing tests, and Vitest picks them up with no config change.

**What we'd want from Kieran.** A view on whether the README's "co-locate" line reflects an intent that hasn't been actioned (in which case maybe we should be the ones to start it) or is stale advice that should be removed. Either way, worth aligning the README with reality so future contributors aren't pulled in two directions.

---

## 2. Ortho-camera behavior under the experimental nav scheme

**Context.** The editor toolbar has top / front / side / back / bottom / left ortho-camera buttons that trigger `controls.setCamera(orthoCamera)` at `viewport.js:407-412`. The navigation proposal (`/claude/reference/3D Street Navigation Proposal.md`) is silent on ortho — none of the proposed mechanics (cursor-anchored swoop zoom, bounds-based rotation, 30° tilt mode-switch) really apply to a parallel projection. `EditorControls` handles ortho today by flipping `isOrthographic = true` and disabling rotation, allowing pan + zoom only.

**What we did.** Phase 0 ships `ExperimentalControls` with ortho mode effectively disabled — when handed an `OrthographicCamera`, controls flip an internal `disabled` flag, log at `console.info` level, and stop responding to input. Switching back to perspective re-enables. This keeps the prototype focused on perspective-mode navigation (the load-bearing case for the proposal) without spending design effort on a path that's rarely used in nav workflows.

**What we'd want from Kieran.** Two questions:

1. How important is ortho-mode usability in editor workflows? Is it used regularly, or is it primarily a "set up a screenshot" feature where camera responsiveness matters less?
2. If ortho needs to remain navigable in the experimental scheme, what's the desired feel? Pan-and-zoom-only (current `EditorControls` behavior) is the obvious answer, but the cursor-anchored zoom from the proposal could also apply naturally to ortho. Worth Kieran's view before we spend effort.

Until this is resolved, we accept the Phase 0 limitation and revisit if it turns out to matter during Phase 1+ feel-testing.

---

## 3. Vitest 4 / rolldown native binding missing on Windows

**Context.** Vitest 4 uses rolldown as its bundler. Rolldown ships its native binding via per-platform optional npm packages (e.g. `@rolldown/binding-win32-x64-msvc`). On at least some Windows installs of this repo, `npm install` fails to install the optional binding — `node_modules/@rolldown/` ends up containing only `pluginutils/`, and any `vitest` invocation crashes at startup with `Cannot find native binding ... Cannot find module '@rolldown/binding-win32-x64-msvc'`. Reinstalling node_modules and trying multiple Node versions (18/20/22) did not fix it; the optional dep just doesn't get pulled in. This is a known npm bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) that surfaces with native-binding optional deps.

**What we did.** Worked around by installing the binding directly: `npm i --no-save @rolldown/binding-win32-x64-msvc@1.0.0-rc.15`. After that, all 320 tests run and pass. The `--no-save` keeps `package.json` clean — the binding is supposed to be pulled in by rolldown's own optional-deps declaration.

**What we'd want from Kieran.** Two questions:

1. Has anyone else hit this on Windows? It's a pretty severe DX issue — clone the repo, run `npm install`, run `npm test`, and tests don't start.
2. Worth pinning Vitest to v3.x until rolldown / the npm optional-dep story stabilizes? Vitest 3 used Vite directly (esbuild) and did not have this problem. Cost is losing Vitest 4 features (mostly faster startup); benefit is a clean install on Windows.

If neither, at least worth a note in `test/README.md` pointing Windows users at the workaround, so they don't spend an hour bouncing between Node versions.

---

## 4. `.husky/pre-commit` changed locally to `npx lint-staged`

**Context.** On at least some Windows installs of this repo, the bare `lint-staged` invocation in `.husky/pre-commit` fails: the bash shim at `node_modules/.bin/lint-staged` detects a MINGW-like shell, tries to call `cygpath`, and crashes when `cygpath` isn't on PATH. The error then resolves a malformed module path (`C:\lint-staged\bin\lint-staged.js`) and `husky - pre-commit script failed (code 1)`. Net effect: commits cannot be created without `--no-verify`.

**What we did.** Changed `.husky/pre-commit` from `lint-staged` to `npx lint-staged`. `npx` invokes the JS entry via Node's resolver and bypasses the bash shim entirely. This is a strict improvement for Windows and a no-op for Mac/Linux, but it is a change to shared developer tooling.

**What we'd want from Kieran.** Confirmation that the change is acceptable to land before this branch is PR'd. Worth pairing with issue #3 (Vitest 4 / rolldown native binding) — both are recent Windows-DX papercuts that future Windows contributors will hit. If we're not going to PR this branch (still an open question), revert this back to `lint-staged` before close-out so the change doesn't accidentally ship via some other route.
