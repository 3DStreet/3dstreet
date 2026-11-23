/**
 * Terrain-grid layer model, format adapters and geometry builders (#2090).
 *
 * The `terrain-grid` layer kind draws one normalized model, whatever format
 * the source ships:
 *
 *   TerrainGrid {
 *     crs, west, north, cellM, cols, rows   regular grid in a projected CRS;
 *                                           cell (c, r) centre is at
 *                                           (west + (c + .5) cell, north - (r + .5) cell),
 *                                           row 0 = north
 *     heights: Float32Array                 orthometric metres per cell
 *     classes: Uint8Array | null            per-cell class id (habitat, land cover)
 *     classTable: [{ id, name, group }]     class id → display group
 *     shade: { cols, rows, stride, data } | null   baked 0..255 light multiplier
 *     waterLevelM                           sea / bay surface, orthometric
 *     waterBodies: [{ id, name, levelM, confidence, rings: [[x, y, ...]] }]
 *     lines: [{ id, name, kind, confidence, points: [x, y, ...] }]
 *     layers: [{ id, source, confidence, attribution }]   provenance per layer
 *   }
 *
 * All vector coordinates are in the grid's CRS, so the builders never need
 * to know which format they came from. A format adapter lists the files it
 * needs and turns their bytes into a TerrainGrid; add one per format.
 *
 * Builders take a `toScene(x, y, orthometricHeight) → [x, y, z]` function
 * (geo-reference.js plus the vertical anchor), so every vertex is reprojected
 * individually.
 *
 * Pure module: no three, no DOM.
 */

// ---------------------------------------------------------------------------
// Format adapters
// ---------------------------------------------------------------------------

/**
 * Yelamu's `viewer/public/assets/real-city/` build (pinned commit in the
 * registry). meta.json describes a UTM grid; heights are uint16 LE scaled
 * linearly over [min_m, max_m]; habitat is uint8 class ids; shade is uint8
 * at a coarser stride; ponds and creeks are JSON in the viewer's local frame
 * (metres from the grid centre, x east, z south).
 */
const yelamuRealCity = {
  manifestFile: 'meta.json',
  /** Files to fetch once meta.json is known: { key: [fileName, 'arraybuffer'|'json'] }. */
  files(meta) {
    const files = { heights: [meta.heights_file, 'arraybuffer'] };
    if (meta.habitat_file) files.classes = [meta.habitat_file, 'arraybuffer'];
    if (meta.shade?.file) files.shade = [meta.shade.file, 'arraybuffer'];
    if (meta.ponds_file) files.ponds = [meta.ponds_file, 'json'];
    if (meta.creeks_file) files.creeks = [meta.creeks_file, 'json'];
    return files;
  },
  parse(meta, files) {
    const cols = meta.width;
    const rows = meta.height;
    const cellM = meta.cell_m;
    if (meta.heights_format !== 'uint16-le') {
      throw new Error(`Unsupported heights_format ${meta.heights_format}`);
    }
    const raw = files.heights;
    if (!raw || raw.byteLength !== cols * rows * 2) {
      throw new Error(
        `Height grid is ${raw?.byteLength} bytes, expected ${cols * rows * 2}`
      );
    }
    const view = new DataView(raw);
    const step = (meta.max_m - meta.min_m) / 65535;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i++) {
      heights[i] = meta.min_m + view.getUint16(i * 2, true) * step;
    }

    let classes = null;
    if (files.classes && files.classes.byteLength === cols * rows) {
      classes = new Uint8Array(files.classes);
    }

    let shade = null;
    const shadeMeta = meta.shade;
    if (
      files.shade &&
      shadeMeta &&
      files.shade.byteLength === shadeMeta.cols * shadeMeta.rows
    ) {
      shade = {
        cols: shadeMeta.cols,
        rows: shadeMeta.rows,
        stride: shadeMeta.stride,
        data: new Uint8Array(files.shade)
      };
    }

    // Local frame → CRS: x = E - centreE, z = centreN - N.
    const centreE = (meta.west + meta.east) / 2;
    const centreN = (meta.south + meta.north) / 2;
    const toCrs = (flat) => {
      const out = new Array(flat.length);
      for (let i = 0; i < flat.length; i += 2) {
        out[i] = centreE + flat[i];
        out[i + 1] = centreN - flat[i + 1];
      }
      return out;
    };

    const waterBodies = (files.ponds?.ponds || []).map((p) => ({
      id: p.id,
      name: p.name || null,
      levelM: p.level_m,
      confidence: p.confidence || null,
      rings: (p.rings || []).map(toCrs)
    }));

    const lines = [];
    for (const [group, kind] of [
      ['mapped', 'creek'],
      ['modelled', 'modelled-stream']
    ]) {
      for (const line of files.creeks?.[group] || []) {
        lines.push({
          id: line.id,
          name: line.name || null,
          kind,
          confidence: line.confidence || null,
          points: toCrs(line.points || [])
        });
      }
    }

    return {
      crs: meta.crs,
      west: meta.west,
      north: meta.north,
      cellM,
      cols,
      rows,
      heights,
      classes,
      classTable: meta.habitat_classes || [],
      shade,
      waterLevelM: Number.isFinite(meta.water_level_m)
        ? meta.water_level_m
        : null,
      waterBodies,
      lines,
      layers: (meta.layers || []).map(
        ({ id, source, confidence, attribution }) => ({
          id,
          source,
          confidence,
          attribution
        })
      )
    };
  }
};

export const TERRAIN_GRID_FORMATS = {
  'yelamu-real-city@1': yelamuRealCity
};

export function getTerrainGridFormat(format) {
  const adapter = TERRAIN_GRID_FORMATS[format];
  if (!adapter) throw new Error(`Unknown terrain-grid format "${format}"`);
  return adapter;
}

// ---------------------------------------------------------------------------
// Sampling and windows
// ---------------------------------------------------------------------------

/** Fractional cell coordinates (c, r) of a CRS point, cell centres at integers. */
export function crsToCell(grid, x, y) {
  return [
    (x - grid.west) / grid.cellM - 0.5,
    (grid.north - y) / grid.cellM - 0.5
  ];
}

/** CRS coordinates of cell (c, r)'s centre. */
export function cellToCrs(grid, c, r) {
  return [
    grid.west + (c + 0.5) * grid.cellM,
    grid.north - (r + 0.5) * grid.cellM
  ];
}

/** Bilinear orthometric height at a CRS point, clamped to the grid edge. */
export function sampleHeight(grid, x, y) {
  let [c, r] = crsToCell(grid, x, y);
  c = Math.min(Math.max(c, 0), grid.cols - 1);
  r = Math.min(Math.max(r, 0), grid.rows - 1);
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const c1 = Math.min(c0 + 1, grid.cols - 1);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const fc = c - c0;
  const fr = r - r0;
  const h = grid.heights;
  const top = h[r0 * grid.cols + c0] * (1 - fc) + h[r0 * grid.cols + c1] * fc;
  const bottom =
    h[r1 * grid.cols + c0] * (1 - fc) + h[r1 * grid.cols + c1] * fc;
  return top * (1 - fr) + bottom * fr;
}

/** True when the CRS point lies inside the grid's extent. */
export function gridContains(grid, x, y) {
  const [c, r] = crsToCell(grid, x, y);
  return c >= -0.5 && r >= -0.5 && c <= grid.cols - 0.5 && r <= grid.rows - 0.5;
}

/**
 * The square window of cells within `radiusM` of a CRS point, clamped to the
 * grid: `{ c0, r0, c1, r1 }` inclusive, or null when it misses the grid.
 */
export function gridWindow(grid, x, y, radiusM) {
  const [c, r] = crsToCell(grid, x, y);
  const span = radiusM / grid.cellM;
  const c0 = Math.max(0, Math.floor(c - span));
  const r0 = Math.max(0, Math.floor(r - span));
  const c1 = Math.min(grid.cols - 1, Math.ceil(c + span));
  const r1 = Math.min(grid.rows - 1, Math.ceil(r + span));
  if (c0 >= c1 || r0 >= r1) return null;
  return { c0, r0, c1, r1 };
}

/**
 * Vertex stride so a window has at most `maxVertsPerSide` vertices along its
 * longer side (the texture keeps full resolution either way).
 */
export function strideForWindow(win, maxVertsPerSide) {
  const span = Math.max(win.c1 - win.c0, win.r1 - win.r0) + 1;
  return Math.max(1, Math.ceil(span / Math.max(2, maxVertsPerSide)));
}

/** Window sample positions from lo to hi with `stride`, always ending at hi. */
function samples(lo, hi, stride) {
  const out = [];
  for (let i = lo; i < hi; i += stride) out.push(i);
  out.push(hi);
  return out;
}

// ---------------------------------------------------------------------------
// Vertical anchoring
// ---------------------------------------------------------------------------

/**
 * Decide how the layer's orthometric heights map onto scene y.
 *
 * - `geo`: street-geo is activated (it has an ellipsoidal height for the
 *   origin). The frame sits at that height and each height becomes
 *   ellipsoidal with the origin's geoid undulation, so the layer meets Google
 *   3D Tiles wherever the ground is unchanged.
 * - `self`: no elevation yet. The layer anchors itself: its own ground at
 *   the origin goes to y = 0, like a scene's flat ground plane.
 *
 * @returns {{ mode, frameEllipsoidalHeight, geoidHeight }}
 */
export function resolveVerticalAnchor(geo, originGridHeight) {
  const ellipsoidal = geo?.ellipsoidalHeight;
  if (Number.isFinite(ellipsoidal)) {
    let geoid = geo.geoidHeight;
    if (!Number.isFinite(geoid) && Number.isFinite(geo.orthometricHeight)) {
      geoid = ellipsoidal - geo.orthometricHeight;
    }
    return {
      mode: 'geo',
      frameEllipsoidalHeight: ellipsoidal,
      geoidHeight: Number.isFinite(geoid) ? geoid : 0
    };
  }
  return {
    mode: 'self',
    frameEllipsoidalHeight: Number.isFinite(originGridHeight)
      ? originGridHeight
      : 0,
    geoidHeight: 0
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A grid-shaped surface over a window. `heightAt(c, r)` gives the orthometric
 * height of each vertex (defaults to the grid's own heights, so a constant
 * function draws a water surface over the same footprint). Vertices sit on
 * cell centres; UVs map the window's cells onto a texture whose row 0 is the
 * window's north row.
 *
 * Winding is counter-clockwise seen from above (+Y), so computed normals
 * point up.
 */
export function buildGridSurface(grid, win, toScene, options = {}) {
  const stride = options.stride || 1;
  const heightAt =
    options.heightAt || ((c, r) => grid.heights[r * grid.cols + c]);
  const cs = samples(win.c0, win.c1, stride);
  const rs = samples(win.r0, win.r1, stride);
  const w = win.c1 - win.c0 + 1;
  const h = win.r1 - win.r0 + 1;
  const positions = new Float32Array(cs.length * rs.length * 3);
  const uvs = new Float32Array(cs.length * rs.length * 2);
  let p = 0;
  let t = 0;
  for (const r of rs) {
    for (const c of cs) {
      const [x, y] = cellToCrs(grid, c, r);
      const v = toScene(x, y, heightAt(c, r));
      positions[p++] = v[0];
      positions[p++] = v[1];
      positions[p++] = v[2];
      uvs[t++] = (c - win.c0 + 0.5) / w;
      uvs[t++] = (r - win.r0 + 0.5) / h;
    }
  }
  const nc = cs.length;
  const indices = new Uint32Array((nc - 1) * (rs.length - 1) * 6);
  let i = 0;
  for (let ri = 0; ri < rs.length - 1; ri++) {
    for (let ci = 0; ci < nc - 1; ci++) {
      const a = ri * nc + ci; // north-west
      const b = a + nc; // south-west
      const c = a + 1; // north-east
      const d = b + 1; // south-east
      indices[i++] = a;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = d;
    }
  }
  return { positions, uvs, indices, cols: nc, rows: rs.length };
}

/**
 * Terrain-following ribbons for linear features (creeks). Each polyline is a
 * strip `widthM` wide whose vertices sit `liftM` above the sampled terrain,
 * reprojected per vertex. Lines are clipped to the window's CRS bounds by
 * dropping points outside it (splitting the line there).
 */
export function buildLineRibbons(grid, win, lines, toScene, options = {}) {
  const widthM = options.widthM ?? 3;
  const liftM = options.liftM ?? 0.3;
  const [minX, maxY] = cellToCrs(grid, win.c0 - 0.5, win.r0 - 0.5);
  const [maxX, minY] = cellToCrs(grid, win.c1 + 0.5, win.r1 + 0.5);
  const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const positions = [];
  const indices = [];

  const emitRun = (run) => {
    if (run.length < 2) return;
    const pts = run.map(([x, y]) =>
      toScene(x, y, sampleHeight(grid, x, y) + liftM)
    );
    const base = positions.length / 3;
    for (let k = 0; k < pts.length; k++) {
      const prev = pts[Math.max(0, k - 1)];
      const next = pts[Math.min(pts.length - 1, k + 1)];
      // Scene ground plane is x (north) / z (east); side = up × tangent.
      let tx = next[0] - prev[0];
      let tz = next[2] - prev[2];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const sx = -tz * (widthM / 2);
      const sz = tx * (widthM / 2);
      const [x, y, z] = pts[k];
      positions.push(x + sx, y, z + sz, x - sx, y, z - sz);
    }
    for (let k = 0; k < pts.length - 1; k++) {
      const l0 = base + k * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      // Counter-clockwise from above for this side convention.
      indices.push(l0, l1, r0, r0, l1, r1);
    }
  };

  for (const line of lines) {
    let run = [];
    for (let i = 0; i < line.points.length; i += 2) {
      const x = line.points[i];
      const y = line.points[i + 1];
      if (inside(x, y)) {
        run.push([x, y]);
      } else {
        emitRun(run);
        run = [];
      }
    }
    emitRun(run);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices)
  };
}

/** Water bodies with at least one ring vertex inside the window. */
export function waterBodiesInWindow(grid, win, waterBodies) {
  const [minX, maxY] = cellToCrs(grid, win.c0 - 0.5, win.r0 - 0.5);
  const [maxX, minY] = cellToCrs(grid, win.c1 + 0.5, win.r1 + 0.5);
  return waterBodies.filter((body) =>
    body.rings.some((ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i];
        const y = ring[i + 1];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
      }
      return false;
    })
  );
}

// ---------------------------------------------------------------------------
// Class texture
// ---------------------------------------------------------------------------

/**
 * Display colour per class group. Groups (not individual classes) keep the
 * palette short and readable at street scale; the classTable still names
 * each class for the legend and picking.
 */
export const CLASS_GROUP_COLORS = {
  water: '#5b8fb0',
  marsh: '#7f9a6a',
  wetland: '#6f9a74',
  mudflat: '#a39478',
  beach: '#e2d3a8',
  dune: '#dcc99a',
  grassland: '#bdbd7c',
  scrub: '#8f9a5c',
  woodland: '#5d7a45',
  rock: '#9a958c',
  unmapped: '#b0a890'
};

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * RGBA pixels for the window at full grid resolution (one pixel per cell,
 * row 0 = north): class colour times the shade multiplier. Without a class
 * raster, cells are tinted by height (green low to tan high).
 */
export function buildClassTexture(grid, win, groupColors = CLASS_GROUP_COLORS) {
  const width = win.c1 - win.c0 + 1;
  const height = win.r1 - win.r0 + 1;
  const data = new Uint8Array(width * height * 4);
  const fallback = hexToRgb(
    groupColors.unmapped || CLASS_GROUP_COLORS.unmapped
  );
  const classColor = new Map();
  for (const cls of grid.classTable) {
    classColor.set(
      cls.id,
      groupColors[cls.group] ? hexToRgb(groupColors[cls.group]) : fallback
    );
  }
  let low;
  let high;
  let lo = Infinity;
  let hi = -Infinity;
  if (!grid.classes) {
    low = hexToRgb(groupColors.grassland || CLASS_GROUP_COLORS.grassland);
    high = hexToRgb(groupColors.dune || CLASS_GROUP_COLORS.dune);
    for (let r = win.r0; r <= win.r1; r++) {
      for (let c = win.c0; c <= win.c1; c++) {
        const v = grid.heights[r * grid.cols + c];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  const shade = grid.shade;
  let p = 0;
  for (let r = win.r0; r <= win.r1; r++) {
    for (let c = win.c0; c <= win.c1; c++) {
      const i = r * grid.cols + c;
      let rgb;
      if (grid.classes) {
        rgb = classColor.get(grid.classes[i]) || fallback;
      } else {
        const t = hi > lo ? (grid.heights[i] - lo) / (hi - lo) : 0;
        rgb = low.map((v, k) => v + (high[k] - v) * t);
      }
      let m = 1;
      if (shade) {
        const sc = Math.min(shade.cols - 1, Math.floor(c / shade.stride));
        const sr = Math.min(shade.rows - 1, Math.floor(r / shade.stride));
        m = shade.data[sr * shade.cols + sc] / 255;
      }
      data[p++] = Math.round(rgb[0] * m);
      data[p++] = Math.round(rgb[1] * m);
      data[p++] = Math.round(rgb[2] * m);
      data[p++] = 255;
    }
  }
  return { width, height, data };
}
