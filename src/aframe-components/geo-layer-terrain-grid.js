/* global AFRAME */
/**
 * `terrain-grid` layer kind for `geo-layer` (#2090): loads a source through
 * its format adapter (src/tested/terrain-grid.js) and draws a window of it
 * around the street-geo origin, reprojected vertex by vertex into the scene
 * frame (src/tested/geo-reference.js).
 *
 * Draws:
 * - the terrain surface, textured one pixel per grid cell with the class
 *   raster (habitat, land cover) times the baked shade; unlit (the shade is
 *   already baked in) but shadow-receiving via `flat-shadow`, like 3D Tiles;
 * - the sea / bay surface at the source's water level;
 * - water bodies (ponds) at their own levels;
 * - linear features (creeks) as terrain-following ribbons.
 */
import { getProjection, createSceneFrame } from '../tested/geo-reference.js';
import {
  getTerrainGridFormat,
  gridContains,
  gridWindow,
  strideForWindow,
  sampleHeight,
  resolveVerticalAnchor,
  buildGridSurface,
  buildLineRibbons,
  waterBodiesInWindow,
  buildClassTexture,
  CLASS_GROUP_COLORS
} from '../tested/terrain-grid.js';
import { receiveShadowsOnUnlit } from './flat-shadow.js';

const THREE = AFRAME.THREE;

// Terrain vertices per window side. The texture keeps one pixel per cell
// regardless, so habitat edges stay crisp when the mesh is decimated.
const MAX_TERRAIN_VERTS_PER_SIDE = 256;
// The water surface is flat apart from earth curvature: a coarse grid is
// enough to follow it.
const MAX_WATER_VERTS_PER_SIDE = 32;
const CREEK_COLOR = '#3f7fae';
const MODELLED_STREAM_COLOR = '#6f9fc0';

// One fetch per source version, shared by every layer instance and rebuild.
const modelCache = new Map();

async function fetchFile(baseUrl, name, type, signal) {
  const response = await fetch(new URL(name, baseUrl), { signal });
  if (!response.ok) {
    throw new Error(`${name}: HTTP ${response.status}`);
  }
  return type === 'json' ? response.json() : response.arrayBuffer();
}

async function fetchModel(source) {
  const adapter = getTerrainGridFormat(source.format);
  const manifest = await fetchFile(
    source.baseUrl,
    adapter.manifestFile,
    'json'
  );
  const entries = Object.entries(adapter.files(manifest));
  const loaded = await Promise.all(
    entries.map(([, [name, type]]) => fetchFile(source.baseUrl, name, type))
  );
  const files = {};
  entries.forEach(([key], i) => {
    files[key] = loaded[i];
  });
  return adapter.parse(manifest, files);
}

export function loadTerrainGrid(source) {
  const key = `${source.id}@${source.version}`;
  if (!modelCache.has(key)) {
    const promise = fetchModel(source).catch((err) => {
      // Let a later rebuild retry instead of caching the failure.
      modelCache.delete(key);
      throw err;
    });
    modelCache.set(key, promise);
  }
  return modelCache.get(key);
}

function meshFromArrays({ positions, uvs, indices }, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, material);
}

function waterMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    // Shorelines sit where terrain meets the water surface; let the terrain
    // win the depth test there instead of flickering.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
}

function buildWaterBodies(grid, win, toScene, material) {
  const positions = [];
  const indices = [];
  for (const body of waterBodiesInWindow(grid, win, grid.waterBodies)) {
    const [outer, ...holes] = body.rings.map((ring) => {
      const pts = [];
      for (let i = 0; i < ring.length; i += 2) {
        pts.push(toScene(ring[i], ring[i + 1], body.levelM));
      }
      return pts;
    });
    if (!outer || outer.length < 3) continue;
    const contour = outer.map((p) => new THREE.Vector2(p[0], p[2]));
    const holeContours = holes.map((h) =>
      h.map((p) => new THREE.Vector2(p[0], p[2]))
    );
    const faces = THREE.ShapeUtils.triangulateShape(contour, holeContours);
    const base = positions.length / 3;
    for (const p of [outer, ...holes].flat()) positions.push(p[0], p[1], p[2]);
    for (const face of faces) {
      indices.push(base + face[0], base + face[1], base + face[2]);
    }
  }
  if (!indices.length) return null;
  return meshFromArrays(
    {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices)
    },
    material
  );
}

/**
 * Build the layer's meshes for one street-geo origin.
 *
 * @returns {{ object: THREE.Group, info: object } | { object: null, info: object }}
 *   `info.status` is 'ok' or 'outside' (the origin is not on the grid).
 */
export function buildTerrainGrid(grid, geo, options) {
  const projection = getProjection(grid.crs);
  const [ox, oy] = projection.fromLonLat(geo.longitude, geo.latitude);
  if (!gridContains(grid, ox, oy)) {
    return { object: null, info: { status: 'outside' } };
  }
  const win = gridWindow(grid, ox, oy, options.radius);
  if (!win) return { object: null, info: { status: 'outside' } };

  const anchor = resolveVerticalAnchor(geo, sampleHeight(grid, ox, oy));
  const frame = createSceneFrame({
    longitude: geo.longitude,
    latitude: geo.latitude,
    ellipsoidalHeight: anchor.frameEllipsoidalHeight
  });
  const toScene = (x, y, orthometric) => {
    const [lon, lat] = projection.toLonLat(x, y);
    return frame.toScene(lon, lat, orthometric + anchor.geoidHeight);
  };

  const group = new THREE.Group();
  group.name = 'geo-layer terrain-grid';

  // Terrain.
  const tex = buildClassTexture(grid, win);
  const texture = new THREE.DataTexture(
    tex.data,
    tex.width,
    tex.height,
    THREE.RGBAFormat
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const terrain = meshFromArrays(
    buildGridSurface(grid, win, toScene, {
      stride: strideForWindow(win, MAX_TERRAIN_VERTS_PER_SIDE)
    }),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  terrain.name = 'terrain';
  group.add(terrain);

  if (options.water) {
    const water = waterMaterial(CLASS_GROUP_COLORS.water);
    if (Number.isFinite(grid.waterLevelM)) {
      const level = grid.waterLevelM;
      const sea = meshFromArrays(
        buildGridSurface(grid, win, toScene, {
          stride: strideForWindow(win, MAX_WATER_VERTS_PER_SIDE),
          heightAt: () => level
        }),
        water
      );
      sea.name = 'water level';
      group.add(sea);
    }
    const ponds = buildWaterBodies(grid, win, toScene, water);
    if (ponds) {
      ponds.name = 'water bodies';
      group.add(ponds);
    }
  }

  if (options.creeks) {
    for (const [kind, color, widthM] of [
      ['creek', CREEK_COLOR, 4],
      ['modelled-stream', MODELLED_STREAM_COLOR, 2]
    ]) {
      const lines = grid.lines.filter((l) => l.kind === kind);
      const ribbons = buildLineRibbons(grid, win, lines, toScene, {
        widthM,
        liftM: 0.3
      });
      if (!ribbons.indices.length) continue;
      const mesh = meshFromArrays(
        ribbons,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          side: THREE.DoubleSide
        })
      );
      mesh.name = kind;
      group.add(mesh);
    }
  }

  receiveShadowsOnUnlit(group);
  return {
    object: group,
    info: {
      status: 'ok',
      anchor: anchor.mode,
      cells: (win.c1 - win.c0 + 1) * (win.r1 - win.r0 + 1)
    }
  };
}

export const terrainGridKind = {
  load: loadTerrainGrid,
  build: buildTerrainGrid
};
