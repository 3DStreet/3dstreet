# Plugins

A plugin adds a feature to 3DStreet from one folder, without editing core
files. It is the way to build on 3DStreet if you are new to the codebase,
three.js or React, and the unit a hackathon team ships.

The working example is **Tree Inventory** (`src/plugins/tree-inventory/`):
it places real street trees from OpenStreetMap, the San Francisco Street
Tree List or NYC's forestry tree points around a location, inside a circle
radius or a box.

## Try it

```bash
npm install
npm start            # http://localhost:3333
```

Open `http://localhost:3333/?plugins=tree-inventory`, set a scene location
(Geospatial tab), then **Add Layer → ⚙️ Custom → Tree Inventory**. Change
the radius, source or shape in the properties panel and the trees refetch.
An AI agent can do the same with the `importTrees` tool.

Plugins with `"status": "labs"` are off unless enabled:

- `?plugins=tree-inventory,other-plugin` or `?plugins=all` on the URL, or
- `localStorage.setItem('3dstreet.plugins', 'tree-inventory')` to persist.

`"status": "stable"` plugins are on for everyone. A maintainer flips that.

## Anatomy

```
src/plugins/<id>/
  manifest.json      id (= folder name), name, description, authors,
                     status ("labs" | "stable"), components, network hosts
  index.js           calls registerPlugin(manifest, { ... })
  fixture.json       a saved entity that must render offline (see Tests)
  *.js               your component and pure helpers
```

The loader (`src/plugins/index.js`) imports every `src/plugins/*/index.js`
at startup, so adding the folder is all the wiring there is.

`registerPlugin(manifest, parts)` from `src/plugins/api.js` takes:

| part         | what it adds                                                                     | gated by flag |
| ------------ | -------------------------------------------------------------------------------- | ------------- |
| `components` | A-Frame components (`{ name: definition }`)                                      | no, always    |
| `layerCards` | Add Layer cards under ⚙️ Custom: `{ id, name, description, create(position) }`   | yes           |
| `tools`      | AI chat + WebMCP tools: `{ name, description, inputSchema, handler(args) }`      | yes           |
| `featured`   | show a component's schema in the properties panel: `{ name: { hiddenProps } }`   | yes           |

Components always register so that a scene saved with a plugin still loads
and re-saves without losing data when the plugin is switched off.

The API also provides helpers: `getSceneGeoOrigin()`, `geo.latLonToLocal()`
(scene axes are **+x north, +z east**, meters), `geo.fetchOverpass()`,
`createEntity()` (undoable in the editor) and `notify.*` toasts.

## Rules

1. **Import core only through `src/plugins/api.js`.** Lint enforces it.
   If you need something from core, add a small helper to `api.js` in the
   same PR. This keeps plugins working when core changes underneath them.
2. **Saved scenes must load offline.** Store fetched data in a component
   property (Tree Inventory keeps its trees in `cache`, keyed by the query)
   and only refetch when the query changes.
3. **Generated children carry the `autocreated` class.** They are rebuilt
   from the component's data on load and never saved. Remove them in the
   component's `remove()`.
4. **Visibility uses `setAttribute('visible', …)`** and positions use
   entity attributes, as everywhere in 3DStreet (mesh batching).
5. **Keep data logic pure** (no `AFRAME`/`THREE`/DOM) in its own module so
   it can be unit-tested, like `tree-sources.js`.

## Tests

- **Contract test, automatic:** `test/components/plugins.test.js` runs every
  plugin in real Chromium. It checks the manifest, that components register,
  and that `fixture.json` renders **with the network disabled** and without
  console errors. It also checks that a save → reload round trip rebuilds the
  same children, and that removing the component removes them. The fixture's
  `expect` block can pin the child count and mixins.
- **Your unit tests:** `test/plugins/<id>*.test.js` (Vitest, jsdom). Record
  small real API responses into `test/plugins/fixtures/`.

```bash
npm run lint
npx vitest run test/plugins
npx vitest run --config vitest.components.config.js test/components/plugins.test.js
```

A PR that only touches `src/plugins/<id>/` and its tests and passes CI
cannot change behavior for anyone who hasn't enabled the plugin.

## Ideas

A new tree or open-data source (add an entry to `SOURCES` in
`tree-sources.js`), bike racks or street lights from OSM, a crossing-distance
or space-per-mode analysis panel, a new play-mode vehicle, an AI tool such as
"add a protected intersection".
