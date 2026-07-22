// Golden + determinism tests for the street-to-glb assembler.
//   node --test test/golden.test.mjs      (or: npm test)
//
// Validates: deterministic byte-stable output for a fixed seed, valid GLB
// magic, expected content shape for the two golden streets (JSON -> GLB).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { streetToGlb } from '../index.js';
import { assembleStreet } from '../src/assemble.js';
import { THREE } from '../src/three-node.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = (name) =>
  JSON.parse(readFileSync(join(HERE, '..', 'golden', name), 'utf8'));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function countMeshes(scene) {
  let meshes = 0;
  scene.traverse((n) => {
    if (n.isMesh) meshes++;
  });
  return meshes;
}

test('suburban-arterial: valid, deterministic GLB', async () => {
  const payload = golden('suburban-arterial.json');
  const a = await streetToGlb(payload);
  const b = await streetToGlb(payload);
  assert.equal(a.toString('ascii', 0, 4), 'glTF', 'GLB magic');
  assert.equal(sha(a), sha(b), 'byte-stable for fixed seed');
  assert.ok(a.length > 100000, 'GLB is non-trivial');
});

test('avenue-with-boundaries: deterministic + boundaries on both sides', async () => {
  const payload = golden('avenue-with-boundaries.json');
  const a = await streetToGlb(payload);
  const b = await streetToGlb(payload);
  assert.equal(sha(a), sha(b), 'byte-stable for fixed seed');

  // Assemble the scene to inspect placement: brownstones should tile both the
  // left (negative X) and right (positive X) edges.
  const { scene, meta } = await assembleStreet(payload);
  assert.equal(meta.segments, 7);
  const box = new THREE.Box3().setFromObject(scene);
  assert.ok(box.min.x < -12, `left boundary present (min.x=${box.min.x.toFixed(1)})`);
  assert.ok(box.max.x > 12, `right boundary present (max.x=${box.max.x.toFixed(1)})`);
  assert.ok(box.max.y > 8, `buildings have height (max.y=${box.max.y.toFixed(1)})`);
  assert.ok(countMeshes(scene) > 30, 'scene populated with models');
});

test('seed changes change output; same seed reproduces', async () => {
  const base = golden('suburban-arterial.json');
  const bumped = structuredClone(base);
  bumped.street.segments[1].generated.clones[0].seed = 999;
  const original = await streetToGlb(base);
  const changed = await streetToGlb(bumped);
  assert.notEqual(sha(original), sha(changed), 'different seed -> different GLB');
  const again = await streetToGlb(base);
  assert.equal(sha(original), sha(again), 'same seed reproduces');
});
