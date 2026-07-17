#!/usr/bin/env node
/**
 * introspect.mjs — inspect a Traffic Monitoring Device (TMD) SQLite dump.
 *
 * These dumps come from an open-source roadside traffic sensor (a Frigate-style
 * camera doing object detection + an OmniPreSense radar + optional air-quality
 * sensor). This script prints the schema, row counts, and a profile of the
 * `events` table (the per-street-user detections we care about for replay) so
 * you can sanity-check a new dump before converting it.
 *
 * Usage:
 *   node scripts/tmd-replay/introspect.mjs <path-to.sqlite>
 *
 * Requires Node >= 22.5 (built-in `node:sqlite`, no npm install needed).
 * Read-only: opens the database in readonly mode and never writes to it.
 */
import { DatabaseSync } from 'node:sqlite';
import { argv, exit } from 'node:process';

const dbPath = argv[2];
if (!dbPath) {
  console.error(
    'usage: node scripts/tmd-replay/introspect.mjs <path-to.sqlite>'
  );
  exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const fmt = (n) => n.toLocaleString('en-US');
const ts = (sec) =>
  sec == null
    ? 'n/a'
    : new Date(sec * 1000).toISOString().replace('.000Z', 'Z');

function bar(value, max, width = 40) {
  return '#'.repeat(Math.round((width * value) / (max || 1)));
}

// ---- tables & counts ---------------------------------------------------------
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all()
  .map((r) => r.name);

console.log('\n=== TABLES & ROW COUNTS ===');
for (const t of tables) {
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
  console.log(`  ${t.padEnd(38)} ${fmt(c).padStart(12)}`);
}

// ---- deployment metadata -----------------------------------------------------
if (tables.includes('deployment')) {
  console.log('\n=== DEPLOYMENT (sensor placement) ===');
  for (const row of db.prepare('SELECT * FROM deployment').all()) {
    console.log(
      `  ${row.sensorType}/${row.sensorName}  lat=${row.lat} lon=${row.lon} bearing=${row.bearing}`
    );
  }
}

// ---- events profile (the replay-relevant table) ------------------------------
if (tables.includes('events')) {
  const ev = (sql) => db.prepare(sql).all();
  const one = (sql) => db.prepare(sql).get();

  console.log('\n=== EVENTS: mode (label) distribution ===');
  for (const r of ev(
    'SELECT label, COUNT(*) c FROM events GROUP BY label ORDER BY c DESC'
  )) {
    console.log(`  ${String(r.label).padEnd(14)} ${fmt(r.c).padStart(8)}`);
  }

  console.log('\n=== EVENTS: direction_calc ===');
  for (const r of ev(
    'SELECT direction_calc d, COUNT(*) c FROM events GROUP BY d ORDER BY c DESC'
  )) {
    console.log(`  ${String(r.d).padEnd(14)} ${fmt(r.c).padStart(8)}`);
  }

  const span = one('SELECT MIN(start_time) mn, MAX(end_time) mx FROM events');
  console.log('\n=== EVENTS: time span ===');
  console.log(`  first: ${ts(span.mn)}`);
  console.log(`  last : ${ts(span.mx)}`);
  console.log(`  span : ${((span.mx - span.mn) / 3600).toFixed(1)} hours`);

  const sp = one(
    'SELECT COUNT(*) c, MIN(ABS(speed_calc)) mn, AVG(ABS(speed_calc)) av, MAX(ABS(speed_calc)) mx FROM events WHERE speed_calc IS NOT NULL'
  );
  console.log('\n=== EVENTS: |speed_calc| (mph, radar) ===');
  console.log(
    `  n=${fmt(sp.c)}  min=${sp.mn}  avg=${sp.av.toFixed(1)}  max=${sp.mx}`
  );

  console.log('\n=== EVENTS: |speed| by mode (mph) ===');
  for (const r of ev(
    'SELECT label, COUNT(*) n, ROUND(AVG(ABS(speed_calc)),1) av, ROUND(MAX(ABS(speed_calc)),1) mx FROM events WHERE speed_calc IS NOT NULL AND speed_calc<>0 GROUP BY label ORDER BY n DESC'
  )) {
    console.log(
      `  ${String(r.label).padEnd(12)} n=${fmt(r.n).padStart(6)}  avg=${String(r.av).padStart(5)}  max=${r.mx}`
    );
  }

  console.log('\n=== EVENTS: detections per hour-of-day (UTC) ===');
  const hours = ev(
    "SELECT CAST(strftime('%H', datetime(start_time,'unixepoch')) AS INT) h, COUNT(*) c FROM events GROUP BY h ORDER BY h"
  );
  const hmax = Math.max(...hours.map((r) => r.c));
  for (const r of hours) {
    console.log(
      `  ${String(r.h).padStart(2, '0')}h ${fmt(r.c).padStart(6)} ${bar(r.c, hmax)}`
    );
  }
}

db.close();
console.log('');
