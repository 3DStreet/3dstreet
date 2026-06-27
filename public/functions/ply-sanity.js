// Sanity check for generated Gaussian-splat .ply files.
//
// vid2scene (and other splat models) always emit a fixed-size .ply even when
// structure-from-motion fails: a failed reconstruction still produces a full
// 500k-gaussian file, but the geometry is garbage — NaN/Inf positions and a
// bounding box that explodes to thousands of units instead of the ~tens of
// units a real scene occupies. That file won't render, yet the pipeline used
// to treat it as a success: charge the user, mark the job succeeded, and save
// a public (unrenderable) asset. See issue #1745.
//
// This module is a pure, dependency-free parser so it can be unit-tested in
// isolation. It inspects only the header plus the first N vertices of the
// binary payload, so the caller can hand it a small range-read of the file
// (a few hundred KB) instead of the whole ~82 MB blob.

// Reject if more than this fraction of sampled vertices have a non-finite
// (NaN/Inf) position. A good reconstruction has ~0; a failed one in the wild
// had ~5.7% in the first 2000 vertices. 1% leaves margin for a stray vertex
// without letting a degenerate file through.
const NAN_RATIO_LIMIT = 0.01;

// Reject if any axis of the bounding box (of finite vertices) spans more than
// this many units. Real scenes are ~tens of units; a failed SfM run spanned
// thousands (e.g. x[-2306, +2327]). 1000 is a generous "this is clearly
// exploded" cap, not a tight fit.
const MAX_EXTENT = 1000;

// How many vertices to sample from the start of the payload. Matches the
// "first 2000 vertices" window used to characterize the failure in the wild.
const SAMPLE_VERTS = 2000;

// Byte sizes of the PLY scalar property types we understand.
const TYPE_SIZES = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8
};

// Locate the end of the ASCII header and return { headerText, dataStart },
// or null if there's no complete header in the buffer.
function findHeader(buf) {
  // Header lines are ASCII and terminated by "end_header" followed by \n
  // (optionally \r\n). Search the leading region only — the binary body that
  // follows must not be scanned as text.
  const scanLen = Math.min(buf.length, 64 * 1024);
  const text = buf.toString('latin1', 0, scanLen);
  const marker = /end_header\r?\n/.exec(text);
  if (!marker) return null;
  return {
    headerText: text.slice(0, marker.index),
    dataStart: marker.index + marker[0].length
  };
}

// Parse the header into { littleEndian, vertexCount, stride, offsets } for the
// vertex element, or null if it isn't a binary PLY we can read (ASCII PLY,
// big-endian, missing x/y/z, etc.). Callers treat null as "can't judge".
function parseHeader(headerText) {
  const lines = headerText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'ply') return null;

  let littleEndian = null;
  let vertexCount = null;
  let inVertexElement = false;
  let stride = 0;
  const offsets = {};

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      if (parts[1] === 'binary_little_endian') littleEndian = true;
      else if (parts[1] === 'binary_big_endian') littleEndian = false;
      else littleEndian = null; // ascii — unsupported here
    } else if (parts[0] === 'element') {
      // Properties belong to the most recent `element`. We only care about the
      // vertex element; once another element starts, stop collecting offsets.
      inVertexElement = parts[1] === 'vertex';
      if (inVertexElement) vertexCount = parseInt(parts[2], 10);
    } else if (parts[0] === 'property' && inVertexElement) {
      // `property <type> <name>` — list properties (`property list ...`) don't
      // appear in vertex data for splats; bail if we somehow see one.
      if (parts[1] === 'list') return null;
      const size = TYPE_SIZES[parts[1]];
      if (!size) return null;
      const name = parts[2];
      if (name === 'x' || name === 'y' || name === 'z') offsets[name] = stride;
      stride += size;
    }
  }

  if (littleEndian !== true) return null; // only little-endian binary supported
  if (!Number.isInteger(vertexCount) || vertexCount <= 0) return null;
  if (offsets.x == null || offsets.y == null || offsets.z == null) return null;

  return { littleEndian, vertexCount, stride, offsets };
}

// Inspect a (prefix of a) binary .ply buffer and report geometry health.
// Returns { ok, reason, stats }. `ok` is true when the sampled geometry looks
// like a real reconstruction; false when it's degenerate. When the buffer
// can't be parsed as a binary little-endian PLY, returns ok:true with
// reason 'unparseable' so the caller fails open (never block a real save on a
// parser quirk — the previous behavior saved everything anyway).
function inspectPlyGeometry(buf) {
  if (!buf || !buf.length) {
    return { ok: true, reason: 'empty-buffer', stats: null };
  }

  const header = findHeader(buf);
  if (!header) return { ok: true, reason: 'no-header', stats: null };

  const parsed = parseHeader(header.headerText);
  if (!parsed) return { ok: true, reason: 'unparseable', stats: null };

  const { vertexCount, stride, offsets, dataStart } = {
    ...parsed,
    dataStart: header.dataStart
  };

  const availableVerts = Math.floor((buf.length - header.dataStart) / stride);
  const sampleCount = Math.min(vertexCount, SAMPLE_VERTS, availableVerts);
  if (sampleCount <= 0) {
    return { ok: true, reason: 'no-vertex-data', stats: { vertexCount } };
  }

  let nonFinite = 0;
  let finite = 0;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (let i = 0; i < sampleCount; i++) {
    const base = dataStart + i * stride;
    const x = buf.readFloatLE(base + offsets.x);
    const y = buf.readFloatLE(base + offsets.y);
    const z = buf.readFloatLE(base + offsets.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      nonFinite++;
      continue;
    }
    finite++;
    if (x < min.x) min.x = x; if (x > max.x) max.x = x;
    if (y < min.y) min.y = y; if (y > max.y) max.y = y;
    if (z < min.z) min.z = z; if (z > max.z) max.z = z;
  }

  const nanRatio = nonFinite / sampleCount;
  const extent = finite > 0
    ? Math.max(max.x - min.x, max.y - min.y, max.z - min.z)
    : Infinity;

  const stats = {
    vertexCount,
    sampleCount,
    nonFinite,
    nanRatio: Number(nanRatio.toFixed(4)),
    extent: Number.isFinite(extent) ? Number(extent.toFixed(2)) : null,
    bounds: finite > 0 ? { min, max } : null
  };

  if (nanRatio > NAN_RATIO_LIMIT) {
    return {
      ok: false,
      reason: `nan-positions (${nonFinite}/${sampleCount} = ${(nanRatio * 100).toFixed(1)}% non-finite)`,
      stats
    };
  }
  if (!(extent <= MAX_EXTENT)) {
    return {
      ok: false,
      reason: `exploded-bounds (extent ${stats.extent} > ${MAX_EXTENT})`,
      stats
    };
  }
  return { ok: true, reason: 'ok', stats };
}

module.exports = {
  inspectPlyGeometry,
  // Exposed for tests / callers that want to size their range-read.
  SAMPLE_VERTS,
  NAN_RATIO_LIMIT,
  MAX_EXTENT
};
