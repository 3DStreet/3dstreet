#!/usr/bin/env node
// pipeline.mjs — end-to-end local driver: managed-street JSON -> GLB -> Blender
// PNG -> Pillow-labeled beauty shot. Mirrors what the Cloud Function does, for
// local testing / the golden bake-off.
//
//   node render/pipeline.mjs <street.json> <out-basename> [--env day] [--samples 12]
//
// Produces <out-basename>.glb and <out-basename>.png. Requires a Blender binary
// (env BLENDER_BIN, default `blender`) and python3 with Pillow.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { streetToGlbWithMeta } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLENDER_BIN = process.env.BLENDER_BIN || 'blender';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const CACHE_DIR = join(HERE, '..', '.cache');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const [, , streetPath, outBase] = process.argv;
if (!streetPath || !outBase) {
  console.error('usage: node render/pipeline.mjs <street.json> <out-basename> [--env day] [--samples 12]');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(streetPath, 'utf8'));
const options = payload.options || {};
const glbPath = resolve(`${outBase}.glb`);
const rawPng = join(mkdtempSync(join(tmpdir(), 'street-render-')), 'raw.png');
const finalPng = resolve(`${outBase}.png`);

// 1) JSON -> GLB
const t0 = Date.now();
const { buffer, meta } = await streetToGlbWithMeta(payload);
writeFileSync(glbPath, buffer);
const tGlb = Date.now();
console.error(`[pipeline] GLB ${glbPath} (${buffer.length} bytes, ${((tGlb - t0) / 1000).toFixed(1)}s)`);

// 2) GLB -> Blender PNG
const params = {
  glb: glbPath,
  out: rawPng,
  cache_dir: CACHE_DIR,
  environment: arg('env', options.environment || 'day'),
  background_color: options.backgroundColor,
  width: Number(arg('width', options.width || 1280)),
  height: Number(arg('height', options.height || 800)),
  fov: Number(arg('fov', options.fov ?? 20)),
  azimuth: Number(arg('azimuth', options.azimuth ?? 20)),
  elevation: Number(arg('elevation', options.elevation ?? 30)),
  margin: Number(options.margin ?? 1.12),
  ground: options.ground !== false,
  samples: Number(arg('samples', 12))
};
const paramsPath = join(dirname(rawPng), 'params.json');
writeFileSync(paramsPath, JSON.stringify(params));

const blender = spawnSync(
  BLENDER_BIN,
  ['-b', '-P', join(HERE, 'render_blender.py'), '--', '--params', paramsPath],
  { stdio: ['ignore', 'inherit', 'inherit'] }
);
if (blender.status !== 0) {
  console.error('[pipeline] Blender failed');
  process.exit(1);
}
const tRender = Date.now();

// 3) PNG -> Pillow labeled beauty shot
const py = spawnSync(
  PYTHON_BIN,
  [
    join(HERE, 'composite_labels.py'),
    '--render', rawPng,
    '--street', resolve(streetPath),
    '--out', finalPng,
    '--units', options.units || 'metric',
    ...(options.title !== undefined ? ['--title', String(options.title)] : []),
    ...(options.branding === false ? ['--no-branding'] : [])
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] }
);
if (py.status !== 0) {
  console.error('[pipeline] composite failed');
  process.exit(1);
}
const tDone = Date.now();

console.error(
  `[pipeline] done: ${finalPng}\n` +
  `  glb ${((tGlb - t0) / 1000).toFixed(1)}s · render ${((tRender - tGlb) / 1000).toFixed(1)}s · ` +
  `composite ${((tDone - tRender) / 1000).toFixed(1)}s · total ${((tDone - t0) / 1000).toFixed(1)}s`
);
console.error(`  meta: ${JSON.stringify(meta)}`);
