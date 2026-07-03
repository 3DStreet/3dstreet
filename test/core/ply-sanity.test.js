/* global describe, it */

const assert = require('assert');
const {
  inspectPlyGeometry,
  MAX_EXTENT
} = require('../../public/functions/ply-sanity.js');

// Build a binary little-endian PLY with the given vertices. Each vertex is
// `floatsPerVertex` float32s; x,y,z are the first three. Extra floats stand in
// for the rest of a real 3DGS vertex (normals, SH coefficients, etc.).
function buildPly(vertices, floatsPerVertex = 41) {
  const propNames = ['x', 'y', 'z'];
  for (let i = propNames.length; i < floatsPerVertex; i++) {
    propNames.push(`f_${i}`);
  }
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `element vertex ${vertices.length}\n` +
    propNames.map((n) => `property float ${n}`).join('\n') +
    '\n' +
    'end_header\n';

  const stride = floatsPerVertex * 4;
  const body = Buffer.alloc(vertices.length * stride);
  vertices.forEach((v, i) => {
    const base = i * stride;
    body.writeFloatLE(v[0], base);
    body.writeFloatLE(v[1], base + 4);
    body.writeFloatLE(v[2], base + 8);
    // remaining floats stay 0
  });
  return Buffer.concat([Buffer.from(header, 'latin1'), body]);
}

describe('ply-sanity inspectPlyGeometry', function () {
  it('accepts a healthy, compact reconstruction', function () {
    const verts = [];
    for (let i = 0; i < 1000; i++) {
      verts.push([(i % 10) - 5, ((i * 3) % 10) - 5, ((i * 7) % 10) - 5]);
    }
    const result = inspectPlyGeometry(buildPly(verts));
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.stats.nonFinite, 0);
    assert.ok(result.stats.extent <= MAX_EXTENT);
  });

  it('rejects a reconstruction with NaN/Inf positions', function () {
    const verts = [];
    for (let i = 0; i < 1000; i++) {
      // ~6% non-finite, like the failed run in the wild.
      if (i % 16 === 0) verts.push([NaN, 0, 0]);
      else if (i % 16 === 1) verts.push([0, Infinity, 0]);
      else verts.push([(i % 10) - 5, (i % 8) - 4, (i % 6) - 3]);
    }
    const result = inspectPlyGeometry(buildPly(verts));
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /nan-positions/);
  });

  it('accepts large-but-finite scenes, flagging extent as advisory only', function () {
    // A legitimately large scene (e.g. a drone scan spanning thousands of
    // units) has clean positions. Absolute extent can't distinguish it from a
    // garbage explosion, so extent must NOT reject — it only sets an advisory
    // flag for monitoring. The NaN check is the real gate. See issue #1745.
    const verts = [];
    for (let i = 0; i < 1000; i++) {
      verts.push([
        (i % 2 ? 1 : -1) * 2300,
        (i % 2 ? -1 : 1) * 1800,
        (i % 2 ? 1 : -1) * 800
      ]);
    }
    const result = inspectPlyGeometry(buildPly(verts));
    assert.strictEqual(result.ok, true, result.reason);
    assert.ok(result.stats.extent > MAX_EXTENT);
    assert.strictEqual(result.stats.extentExceedsAdvisory, true);
  });

  it('fails open (ok:true) on an unparseable buffer', function () {
    const result = inspectPlyGeometry(Buffer.from('not a ply file at all'));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, 'no-header');
  });

  it('fails open on an empty buffer', function () {
    const result = inspectPlyGeometry(Buffer.alloc(0));
    assert.strictEqual(result.ok, true);
  });
});
