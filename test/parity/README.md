# Streetmix fixtures

Local snapshots of Streetmix API responses (schemaVersion 33) that together
cover **every** segment type/variant in `src/segments-variants.js`.

These began as the corpus for a legacy-vs-managed import parity harness. The
legacy Streetmix parser has been retired (#1720), so the harness is gone; the
fixtures stay as a hermetic test corpus for the managed-street importer.

## Load one in the editor

With the dev server running (`npm start`), open:

```
http://localhost:3333/#fixture:<slug>
```

The dev server serves `test/parity/fixtures/*.streetmix.json` from the site
root, and the `#fixture:` hash imports it as a managed street, with no
Streetmix server involved.

## Files

| Path                        | What it is                                        |
| --------------------------- | ------------------------------------------------- |
| `generate-fixtures.mjs`     | street specs + coverage check; emits `fixtures/`  |
| `fixtures/*.streetmix.json` | generated test corpus (commit regenerated output) |

## Regenerate

Generation fails if a segment type/variant is missed. After editing street
specs (or when 3DStreet gains new variants):

```bash
npm run test:parity:fixtures   # regenerates fixtures/, then commit the diff
```
