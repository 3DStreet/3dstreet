// assemble.js — the DOM-free assembler. Turns a managed-street JSON blob into a
// THREE.Scene, porting the placement math from the managed-street family:
//   street-align.js                  cross-street (X) + length (Z) alignment
//   street-segment.js                below-box surface slab, TYPES defaults
//   street-generated-clones.js       fixed/random/single/fit model placement
//   street-generated-stencil.js      atlas-cell markings
//   street-generated-striping.js     lane stripes
//   street-generated-pedestrians.js  seeded pedestrian scatter
//   street-generated-rail.js         rail boxes
//   managed-street.js                auto-striping between adjacent lanes,
//                                    boundary variant → generated synthesis
//
// Scope is the managed-street family only (no legacy street/streetmix-loader,
// intersection, geo, or arbitrary user entities).

import { THREE } from './three-node.js';
import { createRNG } from './rng.js';
import { loadModel } from './model-loader.js';
import { loadTexture } from './texture-loader.js';
import {
  COLORS,
  calculateHeight,
  surfaceTexture,
  calculateTextureRepeat,
  buildingWidths,
  buildingDepths,
  BOUNDARY_VARIANTS,
  STENCIL_ATLAS,
  STENCIL_ATLAS_URL,
  STRIPING,
  stripingTextureUrl,
  resolveModel,
  baseRotationFor
} from './catalog-data.js';

const deg2rad = THREE.MathUtils.degToRad;

// Minimal TYPES defaults (color/surface/elevation) for segments whose JSON
// omits them — ported from street-segment.js TYPES.
const TYPE_DEFAULTS = {
  'drive-lane': { color: COLORS.white, surface: 'asphalt', elevation: 0 },
  'bus-lane': { color: COLORS.red, surface: 'asphalt', elevation: 0 },
  'bike-lane': { color: COLORS.green, surface: 'asphalt', elevation: 0 },
  sidewalk: { color: COLORS.white, surface: 'sidewalk', elevation: 0.15 },
  'parking-lane': { color: COLORS.lightGray, surface: 'concrete', elevation: 0 },
  divider: { color: COLORS.white, surface: 'hatched', elevation: 0 },
  grass: { color: COLORS.white, surface: 'grass', elevation: 0 },
  rail: { color: COLORS.white, surface: 'asphalt', elevation: 0 },
  boundary: { color: COLORS.white, surface: 'cracked-asphalt', elevation: 0.15 }
};

// --- auto-striping (managed-street.js getStripingFromSegments) ------------
function getStripingFromSegments(prev, cur) {
  if (!prev || !cur) return null;
  const valid = ['drive-lane', 'bus-lane', 'bike-lane', 'parking-lane'];
  if (!valid.includes(prev.type) || !valid.includes(cur.type)) return null;
  let v = 'solid-stripe';
  if (
    prev.direction !== cur.direction &&
    prev.direction !== 'none' &&
    cur.direction !== 'none'
  ) {
    v = 'solid-doubleyellow';
    if (cur.type === 'bike-lane' && prev.type === 'bike-lane') {
      v = 'short-dashed-stripe-yellow';
    }
  } else if (cur.type === prev.type) {
    v = 'dashed-stripe';
  }
  if (cur.type === 'parking-lane' || prev.type === 'parking-lane') {
    v = 'solid-stripe';
  }
  return v;
}

function toModelList(modelsArray) {
  if (Array.isArray(modelsArray)) return modelsArray.map((s) => s.trim()).filter(Boolean);
  if (typeof modelsArray === 'string') {
    return modelsArray.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// --- model placement (street-generated-clones.js createClone) ------------
async function placeModel(group, mixinId, x, y, z, rotationYDeg, scaleOverride) {
  const descriptor = resolveModel(mixinId);
  if (!descriptor) {
    console.warn(`[street-to-glb] unknown model mixin "${mixinId}", skipping`);
    return;
  }
  let obj;
  try {
    obj = await loadModel(descriptor);
  } catch (err) {
    console.warn(`[street-to-glb] failed to load "${mixinId}": ${err.message}`);
    return;
  }
  obj.position.set(x, y, z);
  obj.rotation.set(0, deg2rad(rotationYDeg), 0);
  const s = scaleOverride ?? descriptor.scale;
  if (s) obj.scale.setScalar(s);
  group.add(obj);
}

function cloneRotationY(facing, direction, baseRot) {
  let rotationY = facing + baseRot;
  if (direction === 'inbound') rotationY = 0 + facing + baseRot;
  if (direction === 'outbound') rotationY = 180 - facing + baseRot;
  return rotationY;
}

// --- clones (fixed / random / single / fit) ------------------------------
async function buildClones(entry, seg, group) {
  const data = {
    positionX: 0,
    positionY: 0,
    facing: 0,
    seed: 0,
    randomFacing: false,
    direction: 'none',
    mode: 'fixed',
    spacing: 15,
    cycleOffset: 0.5,
    count: 1,
    justify: 'middle',
    padding: 4,
    justifyWidth: 'center',
    ...entry
  };
  const models = toModelList(data.modelsArray);
  if (!models.length) return;
  const length = seg.length;
  const width = seg.width;

  // placements: { z, mixinId, x, rotationY, scale }
  const placements = [];
  let rng = null;
  if (data.mode === 'random' || data.randomFacing) {
    rng = createRNG(data.seed || 1);
  }

  if (data.mode === 'fixed') {
    const cs = Math.max(1, data.spacing);
    const n = Math.floor(length / cs);
    for (let i = 0; i < n; i++) {
      const z = length / 2 - (i + data.cycleOffset) * cs;
      placements.push({ mixinId: models[0], x: data.positionX, z });
    }
  } else if (data.mode === 'random') {
    const cs = Math.max(1, data.spacing);
    const start = -length / 2 + cs / 2;
    const end = length / 2 - cs / 2;
    const len = Math.floor((end - start) / cs) + 1;
    const positions = Array(len)
      .fill()
      .map((_, idx) => start + idx * cs);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (const z of positions.slice(0, data.count)) {
      const mixinId = models[Math.floor(rng() * models.length)];
      let rotationY;
      if (data.randomFacing) {
        rotationY = rng() * 360 + baseRotationFor(mixinId);
      } else {
        rotationY = cloneRotationY(data.facing, data.direction, baseRotationFor(mixinId));
      }
      placements.push({ mixinId, x: data.positionX, z, rotationY });
    }
  } else if (data.mode === 'single') {
    let z = 0;
    if (data.justify === 'start') z = length / 2 - data.padding;
    else if (data.justify === 'end') z = -length / 2 + data.padding;
    placements.push({ mixinId: models[0], x: data.positionX, z });
  } else if (data.mode === 'fit') {
    let cumulativeZ = length / 2;
    let modelIndex = 0;
    while (cumulativeZ > -length / 2) {
      const mixinId = models[modelIndex % models.length];
      const bw = buildingWidths[mixinId] || 10;
      const bd = buildingDepths[mixinId] || 0;
      if (cumulativeZ - bw < -length / 2) break;
      let x = data.positionX;
      if (data.justifyWidth === 'left') x = data.positionX - width / 2 + bd / 2;
      else if (data.justifyWidth === 'right') x = data.positionX + width / 2 - bd / 2;
      placements.push({ mixinId, x, z: cumulativeZ - bw / 2 });
      cumulativeZ -= bw + data.spacing;
      modelIndex++;
    }
  }

  for (const p of placements) {
    const rotationY =
      p.rotationY ??
      cloneRotationY(data.facing, data.direction, baseRotationFor(p.mixinId));
    await placeModel(group, p.mixinId, p.x, data.positionY, p.z, rotationY);
  }
}

// --- stencil (atlas-cell planes) -----------------------------------------
function setAtlasUVs(geometry, totalRows, totalColumns, row, column) {
  // Standard aframe-atlas-uvs mapping: 1-indexed row (from top), column (left).
  const uMin = (column - 1) / totalColumns;
  const uMax = column / totalColumns;
  const vMin = 1 - row / totalRows;
  const vMax = 1 - (row - 1) / totalRows;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, uMin + u * (uMax - uMin), vMin + v * (vMax - vMin));
  }
  uv.needsUpdate = true;
}

async function buildStencil(entry, seg, group) {
  const data = {
    padding: 0,
    spacing: 10,
    positionX: 0,
    positionY: 0.05,
    cycleOffset: 0.5,
    facing: 0,
    stencilHeight: 0,
    direction: 'none',
    ...entry
  };
  let stencils = toModelList(data.modelsArray);
  if (!stencils.length) return;
  if (data.direction === 'inbound') stencils = stencils.slice().reverse();

  const length = seg.length;
  const cs = Math.max(1, data.spacing);
  const numGroups = Math.floor(length / cs);
  const atlas = await loadTexture(STENCIL_ATLAS_URL);
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    transparent: true,
    alphaTest: 0.01,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  let ry = data.facing;
  if (data.direction === 'inbound') ry = 180 + data.facing;
  if (data.direction === 'outbound') ry = 0 - data.facing;

  for (let g = 0; g < numGroups; g++) {
    const groupPosition = length / 2 - (g + data.cycleOffset) * cs;
    stencils.forEach((name, si) => {
      const cell = STENCIL_ATLAS[name];
      if (!cell) return;
      const [sx, sy, rows, cols, row, col] = cell;
      const h = data.stencilHeight > 0 ? sy * data.stencilHeight : sy;
      const geo = new THREE.PlaneGeometry(sx, h);
      setAtlasUVs(geo, rows, cols, row, col);
      const mesh = new THREE.Mesh(geo, material);
      const off = (si - (stencils.length - 1) / 2) * data.padding;
      mesh.position.set(data.positionX, data.positionY, groupPosition + off);
      mesh.rotation.set(-Math.PI / 2, deg2rad(ry), 0);
      group.add(mesh);
    });
  }
}

// --- striping ------------------------------------------------------------
async function buildStriping(entry, seg, group) {
  const data = { striping: undefined, side: 'left', facing: 0, positionY: 0.05, ...entry };
  if (!data.striping || data.striping === 'none') return;
  const spec = STRIPING[data.striping] || ['striping-solid-stripe', 6, '#ffffff', 0.2];
  const [texId, repeatYDiv, color, stripingWidth] = spec;
  const length = seg.length;
  const width = seg.width;
  const repeatY = length / repeatYDiv;

  const baseTex = await loadTexture(stripingTextureUrl(texId));
  const tex = baseTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, repeatY);

  const posX = ((data.side === 'left' ? -1 : 1) * width) / 2;
  const geo = new THREE.PlaneGeometry(stripingWidth, length);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    color: new THREE.Color(color),
    transparent: true,
    alphaTest: 0.01,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(posX, data.positionY, 0);
  mesh.rotation.set(-Math.PI / 2, deg2rad(data.facing), 0);
  group.add(mesh);
}

// --- pedestrians (seeded scatter) ----------------------------------------
async function buildPedestrians(entry, seg, group) {
  const data = { density: 'normal', direction: 'none', positionY: 0, seed: 0, ...entry };
  const factors = { empty: 0, sparse: 0.03, normal: 0.125, dense: 0.25 };
  const length = seg.length;
  const width = seg.width;
  const rng = createRNG(data.seed || 1);
  const xMin = -(0.37 * width);
  const xMax = 0.37 * width;
  const total = Math.floor((factors[data.density] || 0) * length);

  // getZPositions(-length/2, length/2, 1.5) — lattice then Fisher-Yates
  const start = -length / 2;
  const end = length / 2;
  const step = 1.5;
  const zlen = Math.floor((end - start) / step) + 1;
  const zPositions = Array(zlen)
    .fill()
    .map((_, idx) => start + idx * step);
  for (let i = zPositions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [zPositions[i], zPositions[j]] = [zPositions[j], zPositions[i]];
  }

  for (let i = 0; i < total; i++) {
    const x = rng() * (xMax - xMin) + xMin;
    const z = zPositions[i];
    const variant = Math.floor(rng() * 16 + 1); // getRandomIntInclusive(1,16)
    let ry = 0;
    if (data.direction === 'none') {
      if (rng() < 0.5) ry = 180;
    } else if (data.direction === 'outbound') {
      ry = 180;
    }
    await placeModel(group, `char${variant}`, x, data.positionY, z, ry);
  }
}

// --- rail ----------------------------------------------------------------
function buildRail(entry, seg, group) {
  const gauge = entry.gauge ?? 1435;
  const wrapper = new THREE.Group();
  wrapper.position.set(0, -0.2, 0);
  const railsPosX = gauge / 2 / 1000;
  for (const px of [railsPosX, -railsPosX]) {
    const geo = new THREE.BoxGeometry(0.1, 0.2, seg.length);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8f8f8f'),
      metalness: 0.8,
      roughness: 0.1,
      emissive: new THREE.Color('#828282'),
      emissiveIntensity: 0.2
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, 0.2, 0);
    wrapper.add(mesh);
  }
  group.add(wrapper);
}

// --- surface slab (street-segment.js below-box) --------------------------
async function buildSlab(seg, group) {
  const { textureUrl, visible } = surfaceTexture(seg.surface);
  if (!visible) return; // surface 'none'
  const height = seg.height;
  const geo = new THREE.BoxGeometry(seg.width, height, seg.length);
  geo.translate(0, -height / 2, 0); // top face at local y=0

  let mat;
  if (seg.surface === 'water') {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8ab39f'),
      metalness: 1,
      roughness: 0.2,
      transparent: true,
      opacity: 0.8
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(seg.color),
      roughness: 0.8
    });
    if (textureUrl) {
      const tex = (await loadTexture(textureUrl)).clone();
      tex.needsUpdate = true;
      const [rx, ry] = calculateTextureRepeat(seg.length, seg.width, seg.surface);
      tex.repeat.set(rx, ry);
      mat.map = tex;
    }
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// --- boundary generated synthesis (managed-street variant path) ----------
function boundaryGenerated(seg) {
  const variant = seg.variant || 'custom';
  const vc = BOUNDARY_VARIANTS[variant];
  if (!vc || !vc.modelsArray) return { clones: [] };
  const clone = { mode: 'fit', spacing: 0 }; // TYPES.boundary.generated.clones[0]
  clone.modelsArray = vc.modelsArray;
  if (vc.spacing !== undefined) clone.spacing = vc.spacing;
  if (vc.mode !== undefined) clone.mode = vc.mode;
  if (vc.positionY !== undefined) clone.positionY = vc.positionY;
  clone.facing = seg.side === 'left' ? 90 : 270;
  clone.direction = seg.direction ?? 'outbound';
  if (clone.mode === 'fit' && clone.justifyWidth === undefined) {
    clone.justifyWidth = seg.side === 'right' ? 'left' : 'right';
  }
  return { clones: [clone] };
}

// --- per-segment build ---------------------------------------------------
async function buildSegment(seg, generated, group) {
  await buildSlab(seg, group);
  for (const entry of generated.clones || []) await buildClones(entry, seg, group);
  for (const entry of generated.stencil || []) await buildStencil(entry, seg, group);
  for (const entry of generated.striping || []) await buildStriping(entry, seg, group);
  for (const entry of generated.pedestrians || [])
    await buildPedestrians(entry, seg, group);
  for (const entry of generated.rail || []) buildRail(entry, seg, group);
}

// Normalize a raw JSON segment: apply type defaults + boundary variant surface.
function normalizeSegment(raw, streetLength) {
  const type = raw.type === 'building' ? 'boundary' : raw.type;
  const defaults = TYPE_DEFAULTS[type] || {};
  let surface = raw.surface || defaults.surface || 'asphalt';
  // Boundary surface follows the variant (updateSurfaceFromType).
  if (type === 'boundary') {
    const vc = BOUNDARY_VARIANTS[raw.variant];
    surface = vc?.surface || defaults.surface || 'cracked-asphalt';
  }
  const elevation = raw.elevation ?? defaults.elevation ?? 0;
  return {
    name: raw.name || type,
    type,
    width: raw.width,
    elevation,
    height: calculateHeight(elevation),
    direction: raw.direction || 'none',
    color: raw.color || defaults.color || COLORS.white,
    surface,
    variant: raw.variant,
    side: raw.side,
    generated: raw.generated
  };
}

/**
 * Assemble a managed-street payload into a THREE.Scene (Y-up, glTF convention).
 * @param {object} payload - bare {name,length,segments} or {street, options}.
 * @param {object} [opts]  - { boundaries, vehicles, striping } toggles.
 * @returns {Promise<{scene: THREE.Scene, meta: object}>}
 */
export async function assembleStreet(payload, opts = {}) {
  const street = payload.street || payload;
  const options = { boundaries: true, vehicles: true, striping: true, ...(payload.options || {}), ...opts };
  const length = street.length ?? 27;

  if (!Array.isArray(street.segments) || street.segments.length === 0) {
    throw new Error('payload must be a managed-street JSON with a segments array');
  }

  const segments = street.segments.map((s) => {
    const seg = normalizeSegment(s, length);
    seg.length = length;
    return seg;
  });

  const travelled = segments.filter((s) => s.type !== 'boundary');
  const totalWidth = travelled.reduce((sum, s) => sum + (s.width || 0), 0);

  // X alignment (street-align width:center): walk cumulative widths.
  let xCursor = -totalWidth / 2;
  for (const seg of travelled) {
    xCursor += seg.width / 2;
    seg.x = xCursor;
    xCursor += seg.width / 2;
  }
  const leftEdge = -totalWidth / 2;
  const rightEdge = totalWidth / 2;

  // Boundaries positioned off the travelled-way edges, stacking outward.
  const leftBoundaries = segments.filter((s) => s.type === 'boundary' && s.side === 'left');
  const rightBoundaries = segments.filter((s) => s.type === 'boundary' && s.side === 'right');
  let leftOffset = 0;
  for (const seg of leftBoundaries) {
    leftOffset += seg.width;
    seg.x = leftEdge - leftOffset + seg.width / 2;
  }
  let rightOffset = 0;
  for (const seg of rightBoundaries) {
    seg.x = rightEdge + rightOffset + seg.width / 2;
    rightOffset += seg.width;
  }

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'managed-street';
  scene.add(root);

  // Auto-striping is keyed off adjacency in the full segment list.
  const buildTasks = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.x === undefined) continue; // unplaced (e.g. boundary with no side)
    if (seg.type === 'boundary' && !options.boundaries) continue;

    let generated;
    if (seg.type === 'boundary') {
      generated = boundaryGenerated(seg);
    } else {
      generated = {
        clones: seg.generated?.clones ? [...seg.generated.clones] : [],
        stencil: seg.generated?.stencil || [],
        striping: seg.generated?.striping ? [...seg.generated.striping] : [],
        pedestrians: seg.generated?.pedestrians || [],
        rail: seg.generated?.rail || []
      };
      // managed-street auto-adds a stripe between adjacent lanes when the
      // segment carries none.
      if (!seg.generated?.striping) {
        const variant = getStripingFromSegments(segments[i - 1], seg);
        if (variant) generated.striping = [{ striping: variant }];
      }
    }
    if (!options.vehicles) generated.clones = [];
    if (!options.striping) generated.striping = [];

    const group = new THREE.Group();
    group.name = `segment:${seg.name}`;
    group.position.set(seg.x, seg.height, 0);
    root.add(group);
    buildTasks.push(buildSegment(seg, generated, group));
  }

  await Promise.all(buildTasks);

  const meta = {
    name: street.name || 'Untitled Street',
    length,
    width: totalWidth,
    segments: street.segments.length
  };
  return { scene, meta };
}
