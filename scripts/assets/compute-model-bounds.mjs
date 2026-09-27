#!/usr/bin/env node
/**
 * Precompute model bounding boxes for the placeholder ghost boxes (#2009).
 *
 * The scene shows a translucent box where a 3D model will appear until its
 * GLB has downloaded (src/aframe-components/model-placeholder.js). That needs
 * each model's bounds BEFORE the file is fetched, so this script computes
 * them offline and writes src/model-bounds.json, keyed by the asset path
 * relative to the assets CDN root:
 *
 *   "sets/vehicles-rig/gltf-exports/draco/bus-rig.glb"        → [minX, minY, minZ, maxX, maxY, maxZ]
 *   "sets/street-props/gltf-exports/draco/street-props.glb#palmtree" → same, for one gltf-part
 *
 * Sources of model references:
 *   - src/catalog.json          (`src` of every item → whole-model bounds)
 *   - src/assets.js             (legacy mixins: gltf-model url(...), gltf-model
 *                                "#asset-item", and gltf-part "src: #item; part: name")
 *
 * Bounds are in glTF model space (meters, Y-up), i.e. the space the model
 * occupies under its entity before the entity's own position/rotation/scale —
 * exactly what the placeholder needs. A gltf-part's bounds emulate what the
 * component renders: three.js picks the first Mesh in the named node's
 * subtree and clones it with its own local transform (a multi-primitive node
 * yields only its first primitive at identity), so we do the same.
 *
 * Usage:
 *   npm run assets:bounds                 # writes src/model-bounds.json
 *   npm run assets:bounds:check           # exits 1 if the file is stale (CI)
 *   node scripts/assets/compute-model-bounds.mjs --base https://assets.3dstreet.app/ --cache .cache/model-bounds
 *
 * Downloads are cached (default .cache/model-bounds, gitignored). Re-run
 * whenever a model in the assets repo changes shape or a catalog entry is
 * added; a model with no entry simply shows no placeholder. The model-bounds
 * workflow runs --check on pull requests that touch the catalog, assets.js,
 * this script or the table, so a new reference cannot land without its
 * bounds. Behind a proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch
 * honors HTTPS_PROXY.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const CATALOG_PATH = join(ROOT, 'src/catalog.json');
const ASSETS_JS_PATH = join(ROOT, 'src/assets.js');
const OUT_PATH = join(ROOT, 'src/model-bounds.json');

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argValue('--base', 'https://assets.3dstreet.app/');
const CACHE_DIR = argValue('--cache', join(ROOT, '.cache/model-bounds'));
const CHECK = args.includes('--check');

// --- collect references ----------------------------------------------------

/** @returns {{ models: Set<string>, parts: Map<string, Set<string>> }} */
function collectReferences() {
  const models = new Set();
  const parts = new Map();

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  for (const item of catalog) {
    if (item.src && !/^https?:/i.test(item.src)) models.add(item.src);
  }

  // Only the live template, not the "Unused assets" comment block at the end.
  const assetsJs = readFileSync(ASSETS_JS_PATH, 'utf8').split(
    '/*\nUnused assets kept commented here'
  )[0];
  const assetItems = new Map();
  for (const m of assetsJs.matchAll(
    /<a-asset-item id="([^"]+)" src="\$\{assetUrl\}([^"]+)"/g
  )) {
    assetItems.set(m[1], m[2]);
  }
  for (const m of assetsJs.matchAll(
    /gltf-model="url\(\$\{assetUrl\}([^)]+)\)"/g
  )) {
    models.add(m[1]);
  }
  for (const m of assetsJs.matchAll(/gltf-model="#([^"]+)"/g)) {
    const path = assetItems.get(m[1]);
    if (path) models.add(path);
    else console.warn(`[bounds] gltf-model="#${m[1]}" has no <a-asset-item>`);
  }
  for (const m of assetsJs.matchAll(
    /gltf-part="src:\s*#([^;"]+);\s*part:\s*([^";]+?)\s*;?\s*"/g
  )) {
    const path = assetItems.get(m[1].trim());
    if (!path) {
      console.warn(`[bounds] gltf-part src #${m[1]} has no <a-asset-item>`);
      continue;
    }
    if (!parts.has(path)) parts.set(path, new Set());
    parts.get(path).add(m[2].trim());
  }
  return { models, parts };
}

// --- fetch ------------------------------------------------------------------

async function fetchModel(path) {
  const cached = join(CACHE_DIR, path);
  if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
  const url = BASE + path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}

// --- bounds -----------------------------------------------------------------

const round = (v) => Math.round(v * 1000) / 1000;
const pack = (b) =>
  b && Number.isFinite(b.min[0])
    ? [...b.min.map(round), ...b.max.map(round)]
    : null;

function emptyBox() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
}

function unionPoint(box, p) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < box.min[i]) box.min[i] = p[i];
    if (p[i] > box.max[i]) box.max[i] = p[i];
  }
}

// Column-major 4x4 (gltf-transform / glTF convention) applied to a point.
function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Union a primitive's POSITION box, transformed by `matrix`, into `box`. */
function unionPrimitive(box, prim, matrix) {
  const position = prim.getAttribute('POSITION');
  if (!position) return;
  const min = position.getMin([]);
  const max = position.getMax([]);
  for (let i = 0; i < 8; i++) {
    const corner = [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2]
    ];
    unionPoint(box, transformPoint(matrix, corner));
  }
}

function unionSubtree(box, node, matrix) {
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) unionPrimitive(box, prim, matrix);
  }
  for (const child of node.listChildren()) {
    unionSubtree(box, child, multiply(matrix, child.getMatrix()));
  }
}

// three.js PropertyBinding.sanitizeNodeName, which GLTFLoader applies to
// every node name — gltf-part's `part` values are these sanitized names.
const sanitizeNodeName = (name) =>
  name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

/**
 * Bounds of what gltf-part renders for `partName`: three.js finds the first
 * Mesh in the named node's subtree (DFS, self first) and clones it with its
 * own local transform and children. A node whose mesh has several
 * primitives becomes a Group with one Mesh per primitive at identity, so the
 * first primitive alone is what gets cloned.
 */
function partBounds(document, partName) {
  const nodes = document.getRoot().listNodes();
  const named = nodes.filter((n) => sanitizeNodeName(n.getName()) === partName);
  if (!named.length) return null;
  const firstMeshBounds = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const prims = mesh.listPrimitives();
      const box = emptyBox();
      if (prims.length > 1) {
        unionPrimitive(box, prims[0], IDENTITY);
      } else {
        unionSubtree(box, node, node.getMatrix());
      }
      return box.min[0] === Infinity ? null : box;
    }
    for (const child of node.listChildren()) {
      const found = firstMeshBounds(child);
      if (found) return found;
    }
    return null;
  };
  return firstMeshBounds(named[0]);
}

function modelBounds(document) {
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (!scene) return null;
  const b = getBounds(scene);
  return Number.isFinite(b.min[0]) ? b : null;
}

// --- main -------------------------------------------------------------------

async function main() {
  const { models, parts } = collectReferences();
  const paths = new Set([...models, ...parts.keys()]);
  console.log(
    `[bounds] ${models.size} models, ${[...parts.values()].reduce((a, s) => a + s.size, 0)} parts across ${paths.size} files`
  );

  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'meshopt.decoder': MeshoptDecoder
    });

  const out = {};
  const misses = [];
  let done = 0;
  for (const path of [...paths].sort()) {
    let document;
    try {
      document = await io.readBinary(await fetchModel(path));
    } catch (err) {
      misses.push(`${path}: ${err.message}`);
      continue;
    }
    if (models.has(path)) {
      const packed = pack(modelBounds(document));
      if (packed) out[path] = packed;
      else misses.push(`${path}: no geometry`);
    }
    for (const part of parts.get(path) || []) {
      const packed = pack(partBounds(document, part));
      if (packed) out[`${path}#${part}`] = packed;
      else misses.push(`${path}#${part}: part not found`);
    }
    done++;
    if (done % 20 === 0) console.log(`[bounds] ${done}/${paths.size} files`);
  }

  const sorted = Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
  );
  if (misses.length) {
    console.warn(`[bounds] ${misses.length} miss(es):`);
    for (const m of misses) console.warn('  ' + m);
  }
  if (CHECK) {
    const drift = diffAgainstExisting(sorted);
    if (drift.length) {
      console.error(
        `[bounds] ${OUT_PATH} is out of date (${drift.length} difference(s)):`
      );
      for (const line of drift.slice(0, 40)) console.error('  ' + line);
      if (drift.length > 40) console.error(`  … ${drift.length - 40} more`);
      console.error(
        '[bounds] run `npm run assets:bounds` and commit the result'
      );
      process.exit(1);
    }
    console.log(
      `[bounds] ${OUT_PATH} is up to date (${Object.keys(sorted).length} entries)`
    );
    return;
  }
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedBy: 'scripts/assets/compute-model-bounds.mjs',
        base: BASE,
        units:
          'meters, glTF model space (Y up); [minX, minY, minZ, maxX, maxY, maxZ]',
        bounds: sorted
      },
      null,
      1
    ) + '\n'
  );
  console.log(
    `[bounds] wrote ${Object.keys(sorted).length} entries to ${OUT_PATH}`
  );
}

/** Lines describing how `computed` differs from the committed table. */
function diffAgainstExisting(computed) {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(OUT_PATH, 'utf8')).bounds || {};
  } catch {
    return [`${OUT_PATH} is missing or unreadable`];
  }
  const lines = [];
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  for (const key of Object.keys(computed)) {
    if (!(key in existing)) lines.push(`missing: ${key}`);
    else if (!same(existing[key], computed[key])) lines.push(`changed: ${key}`);
  }
  for (const key of Object.keys(existing)) {
    if (!(key in computed)) lines.push(`stale: ${key}`);
  }
  return lines;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
