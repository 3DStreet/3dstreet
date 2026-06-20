# Streetmix Import Parity

Compares the two Streetmix import paths — legacy (`street` + `streetmix-loader`)
vs managed (`managed-street`) — by rendering the same street through each in
headless Chrome and diffing the screenshots.

## Run

```bash
npm run test:parity:setup   # one-time: installs puppeteer (Chromium) + sharp
npm start                   # dev server must be running on :3333
npm run test:parity         # all fixture streets
```

`puppeteer` and `sharp` are intentionally **not** in `package.json` — puppeteer
pulls a ~150 MB Chromium download that we keep out of CI and normal installs.
`test:parity:setup` installs them with `--no-save`, so they never touch
`package.json` or the lockfile. If you run `test:parity` without them, the script
prints this setup command and exits.

Results land in `output/` (gitignored): `<slug>-legacy.png`, `<slug>-managed.png`,
a red-highlight `<slug>-diff.png`, and `report.json` with mismatch ratios.

Useful flags (see `compare-imports.mjs` header for all):

```bash
npm run test:parity -- --filter=bikeway     # one street
npm run test:parity -- --threshold=0.05     # exit 1 if any street exceeds 5%
npm run test:parity -- --headful            # watch the browser
```

## Files

| Path | Committed? | What it is |
| --- | --- | --- |
| `compare-imports.mjs` | yes | the parity check script |
| `generate-fixtures.mjs` | yes | street specs + coverage check; emits `fixtures/` |
| `fixtures/*.streetmix.json` | yes | generated test corpus (commit regenerated output) |
| `output/` | no (gitignored) | screenshots + report from each run |

## Fixtures

Each fixture mimics a Streetmix API response (schemaVersion 33). The script
intercepts `streetmix.net/api/v1/streets` requests in the browser and answers
from these files, so runs are hermetic — no Streetmix server involved.

Together the 16 streets cover **every** segment type/variant in
`src/segments-variants.js`; generation fails if one is missed. After editing
street specs (or when 3DStreet gains new variants):

```bash
npm run test:parity:fixtures   # regenerates fixtures/, then commit the diff
```
