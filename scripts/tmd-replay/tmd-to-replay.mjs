#!/usr/bin/env node
/**
 * tmd-to-replay.mjs — convert a TMD SQLite dump into an anonymized replay
 * manifest that 3DStreet can "play back" as animated street users.
 *
 * What it reads:
 *   The `events` table — one row per object the roadside sensor detected
 *   crossing its field of view (a person, bicycle, car, ...). Each row has a
 *   mode (`label`), a direction (`direction_calc`), a radar speed
 *   (`speed_calc`, signed mph), and timing (`start_time`/`end_time`, unix sec).
 *
 * What it writes (the manifest):
 *   {
 *     meta:   { ...aggregate info, no per-person data... },
 *     agents: [ { t, mode, dir, speed, dur }, ... ]   // sorted by t
 *   }
 *
 *   t     seconds since the window started (relative — NOT a wall-clock time)
 *   mode  person | bicycle | car | motorcycle | bus | dog
 *   dir   'inbound' | 'outbound'  (travel direction along the street)
 *   speed |radar speed| in mph, or null when the camera saw it but radar didn't
 *   dur   seconds the user was in the detection zone (fallback for null speed)
 *
 * Anonymization (this is the point — see README):
 *   - Re-bases every timestamp to a relative offset from the window start, so
 *     no individual's wall-clock crossing time is shipped to the client.
 *   - Keeps ONLY mode/dir/speed/dur. Drops the event id (which embeds a precise
 *     timestamp + random suffix and could be joined back to raw device logs or
 *     video), detection scores, bounding-box area/ratio, entered_zones, camera
 *     name, frame_time, provenance, and attributes.
 *   - The result describes aggregate flow, not identifiable individuals.
 *
 * Usage:
 *   node scripts/tmd-replay/tmd-to-replay.mjs <db.sqlite> [options]
 *     --out <path>        write JSON here (default: stdout)
 *     --window <spec>     busiest-minute | busiest-hour | busiest-day | all   (default busiest-hour)
 *     --duration <sec>    window length to search for --window busiest-* (default 3600)
 *     --start <iso|unix>  explicit window start  (overrides --window)
 *     --end   <iso|unix>  explicit window end
 *     --round <sec>       round relative `t` to this precision (default 0.1)
 *     --pretty            pretty-print the JSON
 *
 * Requires Node >= 22.5 (built-in `node:sqlite`). Read-only on the database.
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { argv, stdout, exit } from 'node:process';

// ---- tiny arg parser ---------------------------------------------------------
function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'pretty') out.pretty = true;
      else out[key] = args[++i];
    } else out._.push(a);
  }
  return out;
}
const opts = parseArgs(argv.slice(2));
const dbPath = opts._[0];
if (!dbPath) {
  console.error(
    'usage: node scripts/tmd-replay/tmd-to-replay.mjs <db.sqlite> [--out f] [--window busiest-hour|busiest-day|all] [--start t --end t] [--pretty]'
  );
  exit(1);
}

const toUnix = (v) => {
  if (v == null) return null;
  if (/^\d+(\.\d+)?$/.test(String(v))) return Number(v); // already unix seconds
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new Error(`unparseable time: ${v}`);
  return ms / 1000;
};
const roundTo = (x, step) => {
  const decimals = (String(step).split('.')[1] || '').length;
  return Number((Math.round(x / step) * step).toFixed(decimals));
};

const db = new DatabaseSync(dbPath, { readOnly: true });

// Pull only the columns we keep, already filtered to rows that have usable
// timing. ORDER BY start_time so the sweep below is a simple linear scan.
const rows = db
  .prepare(
    `SELECT label, direction_calc, speed_calc, start_time, end_time
       FROM events
      WHERE start_time IS NOT NULL AND end_time IS NOT NULL
      ORDER BY start_time`
  )
  .all();

if (rows.length === 0) {
  console.error('no usable rows in events table');
  exit(1);
}

// ---- choose the time window --------------------------------------------------
const duration = Number(opts.duration ?? 3600);
let winStart;
let winEnd;
let windowLabel;

if (opts.start || opts.end) {
  winStart = toUnix(opts.start) ?? rows[0].start_time;
  winEnd = toUnix(opts.end) ?? rows[rows.length - 1].end_time;
  windowLabel = 'explicit';
} else {
  const window = opts.window ?? 'busiest-hour';
  if (window === 'all') {
    winStart = rows[0].start_time;
    winEnd = rows[rows.length - 1].end_time;
    windowLabel = 'all';
  } else {
    // busiest-minute / busiest-hour / busiest-day: slide a fixed-width window
    // over the sorted start times and keep the start that maximizes the count.
    const width =
      window === 'busiest-minute'
        ? 60
        : window === 'busiest-day'
          ? 86400
          : duration;
    let bestStart = rows[0].start_time;
    let bestCount = 0;
    let lo = 0;
    for (let hi = 0; hi < rows.length; hi++) {
      const t0 = rows[hi].start_time;
      while (rows[lo].start_time < t0 - width) lo++;
      const count = hi - lo + 1;
      if (count > bestCount) {
        bestCount = count;
        bestStart = rows[lo].start_time;
      }
    }
    winStart = bestStart;
    winEnd = bestStart + width;
    windowLabel = window;
  }
}

// ---- build anonymized agents -------------------------------------------------
const roundStep = Number(opts.round ?? 0.1);
const counts = {};
const agents = [];
for (const r of rows) {
  if (r.start_time < winStart || r.start_time >= winEnd) continue;

  // direction: prefer the camera's calc, else infer from radar speed sign
  // (inbound = +, outbound = -), else default inbound.
  let dir = r.direction_calc;
  if (dir !== 'inbound' && dir !== 'outbound') {
    if (typeof r.speed_calc === 'number') {
      dir = r.speed_calc >= 0 ? 'inbound' : 'outbound';
    } else dir = 'inbound';
  }

  const speed =
    typeof r.speed_calc === 'number'
      ? Math.round(Math.abs(r.speed_calc) * 10) / 10
      : null;
  const dur =
    Math.round(Math.min(Math.max(r.end_time - r.start_time, 0.3), 60) * 100) /
    100;

  agents.push({
    t: roundTo(r.start_time - winStart, roundStep),
    mode: r.label,
    dir,
    speed,
    dur
  });
  counts[r.label] = (counts[r.label] || 0) + 1;
}
agents.sort((a, b) => a.t - b.t);

// ---- deployment context (placement only — not personal) ----------------------
let deployment = null;
try {
  const d = db
    .prepare(
      "SELECT lat, lon, bearing FROM deployment WHERE sensorType='cameras' LIMIT 1"
    )
    .get();
  if (d) deployment = { lat: d.lat, lon: d.lon, bearing: d.bearing };
} catch {
  /* deployment table may be absent in some dumps */
}
db.close();

const manifest = {
  meta: {
    schemaVersion: 1,
    source: dbPath.split('/').pop(),
    description:
      'Anonymized street-user replay manifest. Each agent carries only mode, ' +
      'direction, speed and duration, and timestamps are relative to the ' +
      'window start. No identifiers, images, scores, or absolute per-user times.',
    deployment,
    speedUnit: 'mph',
    window: {
      label: windowLabel,
      // Aggregate window bounds (UTC) are kept for provenance/reproducibility;
      // individual agents only ever carry a relative `t`.
      startUtc: new Date(winStart * 1000).toISOString(),
      endUtc: new Date(winEnd * 1000).toISOString(),
      durationSec: Math.round(winEnd - winStart)
    },
    agentCount: agents.length,
    countsByMode: counts
  },
  agents
};

const json = opts.pretty
  ? JSON.stringify(manifest, null, 2)
  : JSON.stringify(manifest);
if (opts.out) {
  writeFileSync(opts.out, json);
  console.error(
    `wrote ${agents.length} agents (${windowLabel}) -> ${opts.out}  [${Object.entries(
      counts
    )
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}]`
  );
} else {
  stdout.write(json + '\n');
}
