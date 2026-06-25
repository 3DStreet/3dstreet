# TMD → 3DStreet traffic replay

Tooling to turn a **Traffic Monitoring Device (TMD)** SQLite dump into an
**anonymized replay manifest** that 3DStreet plays back as animated street
users (the `street-traffic-replay` A-Frame component).

The dumps come from an open-source roadside sensor: a Frigate-style camera doing
on-device object detection, an OmniPreSense radar for speed, and an optional
air-quality sensor. The sample referenced below
(`tmdb-rvc-waterleaf-2025-10-11.sqlite`, ~70 MB, **not committed**) is a
~25-day capture at lat `45.464152`, lon `-122.66961` (SW Portland, OR), camera
bearing west.

---

## 1. What's in the dump

| table                                | rows (sample) | what it is                                                 |
| ------------------------------------ | ------------: | ---------------------------------------------------------- |
| **`events`**                         |    **19,729** | **one row per detected street user** — the table we replay |
| `deployment`                         |             2 | sensor placement (lat/lon/bearing, camera + radar)         |
| `radar_dov`                          |        43,533 | raw radar direction-of-velocity samples                    |
| `radar_raw_speed_magnitude(_single)` |         ~291k | raw per-frame radar speed/magnitude                        |
| `radar_timed_speed_counts`           |        14,274 | radar speed counts binned over time                        |
| `radar_oc_payload`                   |             0 | object-classified radar payload (empty here)               |
| `airquality`                         |             0 | environmental sensor (empty here)                          |
| `comments`                           |             0 | human annotations                                          |

The **`events`** table is the canonical source for replay. Each row is one
object the camera tracked crossing its field of view, corroborated by radar:

| column                                                                                                                     | meaning                                                      | used for replay?         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| `label`                                                                                                                    | mode: `person`, `bicycle`, `car`, `motorcycle`, `bus`, `dog` | ✅ → which model         |
| `direction_calc`                                                                                                           | `inbound` / `outbound` along the street                      | ✅ → travel direction    |
| `speed_calc`                                                                                                               | signed radar speed, **mph** (`+`=inbound, `−`=outbound)      | ✅ → speed (abs)         |
| `start_time` / `end_time`                                                                                                  | unix seconds, entered / left detection zone                  | ✅ → schedule + duration |
| `id`, `camera`, `frame_time`                                                                                               | identifiers / capture detail                                 | ❌ dropped (see §4)      |
| `top_score`, `score`, `area`, `ratio`, `entered_zones`, `attributes`, `provenance`, `motionless_count`, `position_changes` | detector internals                                           | ❌ dropped               |

Sample profile (25-day capture): **person 10,008 · bicycle 7,458 · car 2,106 ·
motorcycle 134 · bus 20 · dog 3**. Mean speeds (mph): car 16.7, bus 13.8,
motorcycle 11.8, person 10.3, bicycle 9.6. Flow peaks afternoon/evening local
time and goes quiet overnight — a realistic diurnal curve.

> `speed_calc` sign and `direction_calc` agree 100% of the time, so direction is
> recoverable even on the ~5% of rows where `direction_calc` is null.

---

## 2. Inspect a dump

```bash
node scripts/tmd-replay/introspect.mjs path/to/tmdb-*.sqlite
```

Prints schema, row counts, deployment, and an `events` profile (mode mix,
time span, speed-by-mode, hourly histogram). Read-only; needs **Node ≥ 22.5**
(built-in `node:sqlite`, no `npm install`).

---

## 3. Convert to a replay manifest

```bash
# default: the single busiest hour, anonymized, pretty-printed
node scripts/tmd-replay/tmd-to-replay.mjs path/to/tmdb-*.sqlite \
  --window busiest-hour --pretty --out scripts/tmd-replay/sample-waterleaf-busiest-hour.json
```

Options:

| flag                | default        | meaning                                                   |
| ------------------- | -------------- | --------------------------------------------------------- |
| `--out <path>`      | stdout         | where to write the JSON                                   |
| `--window <spec>`   | `busiest-hour` | `busiest-hour` \| `busiest-day` \| `all`                  |
| `--duration <sec>`  | `3600`         | window length searched for `busiest-*`                    |
| `--start` / `--end` | —              | explicit window (`unix` sec or ISO); overrides `--window` |
| `--round <sec>`     | `0.1`          | rounding precision for the relative `t`                   |
| `--pretty`          | off            | pretty-print                                              |

`sample-waterleaf-busiest-hour.json` (committed) is the default output for the
sample dump: **261 agents** over one hour (person 179 · bicycle 58 · car 21 ·
motorcycle 3), peak ~25 on screen at once.

### Manifest format

```jsonc
{
  "meta": {
    "schemaVersion": 1,
    "source": "tmdb-rvc-waterleaf-2025-10-11.sqlite",
    "deployment": { "lat": 45.464152, "lon": -122.66961, "bearing": "w" },
    "speedUnit": "mph",
    "window": {
      "label": "busiest-hour",
      "startUtc": "...",
      "endUtc": "...",
      "durationSec": 3600
    },
    "agentCount": 261,
    "countsByMode": { "person": 179, "bicycle": 58, "car": 21, "motorcycle": 3 }
  },
  "agents": [
    { "t": 0, "mode": "person", "dir": "inbound", "speed": 15, "dur": 6.74 },
    {
      "t": 42.3,
      "mode": "bicycle",
      "dir": "outbound",
      "speed": 6,
      "dur": 10.01
    }
    // ... sorted by t
  ]
}
```

- `t` — seconds since the window started (**relative**, not a wall-clock time)
- `mode` — drives model selection
- `dir` — `inbound` (+Z) / `outbound` (−Z) in segment-local coordinates
- `speed` — `|radar speed|` in mph, or `null` (component falls back to a per-mode default)
- `dur` — seconds in the detection zone (kept as an anonymized fallback signal)

---

## 4. Anonymization

The user-facing intent is to show **aggregate flow by mode**, never an
individual. The converter enforces that:

- **Re-bases time.** Every timestamp becomes a relative offset (`t`) from the
  window start. No individual's wall-clock crossing time is shipped.
- **Drops identifiers.** The event `id` (a precise timestamp + random suffix
  that could be joined back to raw device logs or video clips), `camera`,
  `frame_time`, all detector scores, bounding-box geometry, `entered_zones`,
  `provenance`, and `attributes` are discarded.
- **Keeps only mode/dir/speed/dur.** The richest thing a viewer can read off a
  replayed agent is _which mode it is_ — exactly the intended disclosure.

The aggregate `meta.window` bounds (UTC) are retained for provenance only; they
describe the capture window, not any person. Drop `meta.window` if you want a
fully time-stripped artifact.

> This particular sensor stores **no PII** to begin with — no plates, no faces,
> no images land in the SQLite. The steps above are defense-in-depth so the
> manifest stays safe to embed in a public scene.

---

## 5. Replay it in 3DStreet

### As a user (Add Layer card)

In the editor: **Add Layer → "(Beta) Traffic Replay from Sensor Data"** → pick a
manifest `.json` (e.g. `sample-waterleaf-busiest-hour.json`). It attaches a
`street-traffic-replay` component to your Managed Street (or, if you don't have
one, creates a default cross-section that carries it) and marks the street
`playable`. A toast confirms the agent/mode counts. Press **Play** and the real,
anonymized street users animate by mode.

The manifest is stored inline (`manifestData`) on the street, so it **persists
with the saved scene** — exactly like a Managed Street's `json-blob` source. No
external hosting required.

### Quick demo (no clicks)

Run the app with `?replay=sample` to auto-build a street carrying the committed
sample manifest, then press Play:

```
npm start            # then open
http://localhost:3333/?replay=sample
```

`?replay=<url-to-manifest.json>` works too. (This is dev-only scaffolding in
`replay-demo.js`; the product path is the Add Layer card above.)

### The component

`street-traffic-replay` lives **on a `[managed-street]` entity** and animates
onto that street's own lanes during play mode (registered in `src/index.js`).

| property                   | default | meaning                                                                     |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| `manifestData`             | `''`    | inline manifest JSON (stringified) — the persistable source                 |
| `manifestUrl`              | `''`    | alternative: fetch the manifest from a URL (also persists; not `src`)       |
| `timeScale`                | `1`     | sim-seconds → manifest-seconds. `1` = real time, `60` = a minute per second |
| `loop`                     | `true`  | rewind to `t=0` when the window ends                                        |
| `suppressSyntheticTraffic` | `true`  | the synthetic `street-traffic` skips a street that has an active replay     |

> Why not `src`? The scene serializer strips any `src` property on save, so the
> manifest is kept in `manifestData`/`manifestUrl` to survive save/load.

**How it animates** (mirrors `street-traffic.js`):

- Driven by `scene-timer.simulationTime` → deterministic, frame-rate
  independent, cross-machine consistent at the same sim-time.
- Each agent spawns at the near end of the lane matching its mode
  (`car`→drive-lane, `bicycle`→bike-lane, `person`→sidewalk, …), travels the
  street at its clamped per-mode speed, then despawns at the far end.
- Radar speed outliers are clamped to plausible per-mode ranges (a `person`
  radar-tagged at 25 mph is a co-incident vehicle reading → capped to a brisk
  walk). The manifest stays faithful; clamping happens at render time only.

**Live analytics.** Every ~200 ms the component emits a
`street-traffic-replay-stats` event on the scene with running tallies — wire a
UI overlay to it:

```js
document
  .querySelector('a-scene')
  .addEventListener('street-traffic-replay-stats', (e) => {
    // e.detail = { manifestTime, active, total, cumulative: { person, bicycle, ... } }
  });
```

### Status / verification

- **Data layer** (`introspect.mjs`, `tmd-to-replay.mjs`, the manifest): verified
  end-to-end against the sample dump.
- **Replay math** (spawn/move/despawn/loop): validated by a standalone
  simulation — peak concurrency (25) and exit behavior match the raw data, and
  results are identical across frame rates (deterministic).
- **Build**: the full app (`webpack`) compiles with all of the above plus the
  Add Layer card and the `?replay=sample` demo.
- **Not yet done**: a live in-browser smoke test in play mode (confirming lane
  selection and model placement on a rendered scene). It could not be run in the
  build sandbox because the network policy blocks the A-Frame CDN the app loads
  from; run `?replay=sample` locally to confirm visually.
