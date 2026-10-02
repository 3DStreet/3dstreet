# Working on plugins (instructions for AI agents)

Read [docs/plugins.md](../../docs/plugins.md) first. `tree-inventory/` is the
reference plugin: copy its structure.

- Stay inside `src/plugins/<id>/` plus `test/plugins/`. The only exception:
  a small helper added to `src/plugins/api.js` when the plugin needs core.
- Never import from `src/editor`, `src/store.js`, `@/…`, `@shared/…` or any
  `../../` path in plugin code. Lint fails on it.
- `manifest.json` `id` must equal the folder name. New plugins are
  `"status": "labs"`.
- Ship `fixture.json`: an entity's components that render with the network
  disabled. Fetched data goes into a component property (a cache keyed by
  the query), never refetched on load.
- Generated child entities get the `autocreated` class and are removed in
  `remove()`.
- Put pure logic (requests, parsing, math) in a module without
  AFRAME/THREE/DOM and unit-test it in `test/plugins/` against recorded
  fixtures.
- Before finishing, run `npm run lint`, `npx vitest run test/plugins` and
  `npx vitest run --config vitest.components.config.js test/components/plugins.test.js`.
