#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * validate-vehicle.js
 * ===================
 *
 * Run the wheel detector against a glb on disk and print what it finds.
 *
 * Usage:
 *   npm run validate-vehicle -- path/to/vehicle.glb
 *   node scripts/validate-vehicle.js path/to/vehicle.glb [--verbose]
 *
 * Reuses the pure helpers in src/tested/wheel-detection.js so what we
 * print here is exactly what the runtime detector would see. The glb
 * parsing is done with @gltf-transform/core (already a project
 * dependency, runs in plain node — no headless Three.js needed).
 *
 * Verbose mode (or any zero-wheel result) reports:
 *   - the vehicle's local-frame AABB
 *   - every mesh primitive in the file (path, AABB, qualifies-yes/no)
 *   - which heuristic rejected the not-quite-qualifying primitives
 *     (e.g. "minY 0.08 above vehicle floor 0; epsilon 0.05")
 *
 * Goal: when a contributor sees "wheels don't spin," they run this and
 * find out exactly why in one command.
 */

const path = require('path');
const {
  groundCandidates,
  clusterByXZ,
  classifySide,
  splitIntoComponents,
  wheelLikeAspect,
  NAMED_BONES,
  DEFAULT_GROUND_EPSILON,
  DEFAULT_CLUSTER_RADIUS,
  DEFAULT_ASPECT_RATIO_MAX
} = require('../src/tested/wheel-detection');

function parseArgs(argv) {
  const args = argv.slice(2);
  let verbose = false;
  let file = null;
  let groundEpsilon = DEFAULT_GROUND_EPSILON;
  let clusterRadius = DEFAULT_CLUSTER_RADIUS;
  let aspectRatioMax = DEFAULT_ASPECT_RATIO_MAX;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--verbose' || a === '-v') verbose = true;
    else if (a === '--epsilon') groundEpsilon = parseFloat(args[++i]);
    else if (a === '--cluster-radius') clusterRadius = parseFloat(args[++i]);
    else if (a === '--aspect-max') aspectRatioMax = parseFloat(args[++i]);
    else if (a === '--no-aspect-filter') aspectRatioMax = Infinity;
    else if (a === '--help' || a === '-h') return { help: true };
    else if (!file) file = a;
  }
  return { file, verbose, groundEpsilon, clusterRadius, aspectRatioMax };
}

function printUsage() {
  console.log(`Usage: node scripts/validate-vehicle.js <file.glb> [options]

Options:
  -v, --verbose            Print every primitive and rejection reason
  --epsilon <m>            Ground-floor tolerance (default ${DEFAULT_GROUND_EPSILON})
  --cluster-radius <m>     XZ merge distance for rim+tire (default ${DEFAULT_CLUSTER_RADIUS})
  --aspect-max <ratio>     Max non-axle aspect ratio for a wheel (default ${DEFAULT_ASPECT_RATIO_MAX})
  --no-aspect-filter       Disable the aspect-ratio filter entirely
  -h, --help               Show this help
`);
}

// 4x4 column-major helpers (matches gl-matrix / WebGL convention).
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function multiply(a, b) {
  const out = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}
function transformPoint(m, x, y, z) {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14]
  };
}

function emptyAabb() {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
}
function expandAabb(box, p) {
  if (p.x < box.min.x) box.min.x = p.x;
  if (p.y < box.min.y) box.min.y = p.y;
  if (p.z < box.min.z) box.min.z = p.z;
  if (p.x > box.max.x) box.max.x = p.x;
  if (p.y > box.max.y) box.max.y = p.y;
  if (p.z > box.max.z) box.max.z = p.z;
}
function isEmptyAabb(box) {
  return box.min.x > box.max.x;
}
function unionAabb(a, b) {
  if (a.min.x < b.min.x) b.min.x = a.min.x;
  if (a.min.y < b.min.y) b.min.y = a.min.y;
  if (a.min.z < b.min.z) b.min.z = a.min.z;
  if (a.max.x > b.max.x) b.max.x = a.max.x;
  if (a.max.y > b.max.y) b.max.y = a.max.y;
  if (a.max.z > b.max.z) b.max.z = a.max.z;
}
function fmtBox(b) {
  return `min(${b.min.x.toFixed(3)}, ${b.min.y.toFixed(3)}, ${b.min.z.toFixed(3)}) max(${b.max.x.toFixed(3)}, ${b.max.y.toFixed(3)}, ${b.max.z.toFixed(3)})`;
}

async function loadDocument(file) {
  const { NodeIO } = require('@gltf-transform/core');
  const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  try {
    const draco = require('draco3dgltf');
    io.registerDependencies({
      'draco3d.decoder': await draco.createDecoderModule(),
      'draco3d.encoder': await draco.createEncoderModule()
    });
  } catch (err) {
    // draco3dgltf is a devDependency; only required for draco-compressed glbs.
    // If the file isn't draco, read() will succeed without it.
  }
  return io.read(file);
}

/**
 * Walk the scene tree, returning one entry per mesh primitive with:
 *   - nodePath: '/' joined node names from scene root (for logging)
 *   - aabb: AABB in scene-root (vehicle) local frame
 *
 * Primitives without POSITION (e.g. point clouds) are skipped silently.
 */
function gatherPrimitives(scene) {
  const out = [];
  const visit = (node, parentMatrix, parentPath) => {
    const localMatrix = node.getMatrix();
    const worldMatrix = multiply(parentMatrix, Array.from(localMatrix));
    const name = node.getName() || '<unnamed>';
    const nodePath = parentPath + '/' + name;
    const mesh = node.getMesh();
    if (mesh) {
      let primIdx = 0;
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        if (!position) continue;
        const positions = position.getArray();
        const indicesAttr = prim.getIndices();
        const indices = indicesAttr ? indicesAttr.getArray() : null;

        // Vertex-level connected components — splits exporter-merged
        // primitives (Draco/gltfpack) into wheel-vs-chassis pieces.
        const comps = splitIntoComponents(positions, indices);
        const multi = comps.length > 1;
        comps.forEach((comp, ci) => {
          const aabb = emptyAabb();
          for (const vi of comp.vertexIndices) {
            const p = transformPoint(
              worldMatrix,
              positions[vi * 3],
              positions[vi * 3 + 1],
              positions[vi * 3 + 2]
            );
            expandAabb(aabb, p);
          }
          if (isEmptyAabb(aabb)) return;
          const centroid = {
            x: (aabb.min.x + aabb.max.x) / 2,
            y: (aabb.min.y + aabb.max.y) / 2,
            z: (aabb.min.z + aabb.max.z) / 2
          };
          const label = multi
            ? `${nodePath}#prim${primIdx}cc${ci}`
            : `${nodePath}#prim${primIdx}`;
          out.push({
            nodePath: label,
            name,
            aabb,
            centroid,
            vertexCount: comp.vertexIndices.length,
            componentOf: multi ? nodePath : null
          });
        });
        primIdx++;
      }
    }
    for (const child of node.listChildren()) {
      visit(child, worldMatrix, nodePath);
    }
  };
  for (const child of scene.listChildren()) {
    visit(child, identity(), '');
  }
  return out;
}

function reportNamed(primitives) {
  // Mirror detectNamed(): are the named-bone leaves present anywhere
  // in the node tree? Note: gltf-transform reports node names, so
  // matching is by path component.
  const matches = [];
  for (const name of NAMED_BONES) {
    const found = primitives.find((p) => p.nodePath.split('/').includes(name));
    if (found) matches.push({ name, primitive: found });
  }
  return matches;
}

function detectGeometricCli(primitives, opts) {
  if (primitives.length === 0) return { wheels: [], rejections: [] };
  // Vehicle AABB = union of all primitive AABBs.
  const vehicleBox = emptyAabb();
  for (const p of primitives) unionAabb(p.aabb, vehicleBox);
  const candidates = groundCandidates(
    primitives,
    vehicleBox.min.y,
    opts.groundEpsilon
  );

  // Rejection diagnostics: which non-candidate primitives almost
  // qualified? Define "almost" = within 2× epsilon of the floor.
  const widerWindow = opts.groundEpsilon * 2;
  const wider = groundCandidates(primitives, vehicleBox.min.y, widerWindow);
  const almostSet = new Set(wider.filter((p) => !candidates.includes(p)));

  const clusters = clusterByXZ(candidates, opts.clusterRadius);

  const centerXZ = {
    x: (vehicleBox.min.x + vehicleBox.max.x) / 2,
    z: (vehicleBox.min.z + vehicleBox.max.z) / 2
  };
  const wheels = [];
  const aspectRejections = [];
  clusters.forEach((c, i) => {
    const cb = emptyAabb();
    for (const p of c) unionAabb(p.aabb, cb);
    const pivot = {
      x: (cb.min.x + cb.max.x) / 2,
      y: (cb.min.y + cb.max.y) / 2,
      z: (cb.min.z + cb.max.z) / 2
    };
    const record = {
      index: i,
      members: c.map((m) => m.nodePath),
      memberDetails: c.map((m) => ({ nodePath: m.nodePath, aabb: m.aabb })),
      bounds: cb,
      pivot,
      radius: (cb.max.y - cb.min.y) / 2,
      side: classifySide({ x: pivot.x - centerXZ.x, z: pivot.z - centerXZ.z })
    };
    if (!wheelLikeAspect(cb, opts.aspectRatioMax)) {
      aspectRejections.push(record);
    } else {
      wheels.push(record);
    }
  });

  const rejections = [];
  for (const p of primitives) {
    if (candidates.includes(p)) continue;
    const gap = p.aabb.min.y - vehicleBox.min.y;
    rejections.push({
      nodePath: p.nodePath,
      reason: almostSet.has(p)
        ? `near-miss: minY ${p.aabb.min.y.toFixed(3)} is ${gap.toFixed(3)}m above vehicle floor ${vehicleBox.min.y.toFixed(3)} (epsilon ${opts.groundEpsilon}m)`
        : `not on ground: minY ${p.aabb.min.y.toFixed(3)} is ${gap.toFixed(3)}m above vehicle floor ${vehicleBox.min.y.toFixed(3)}`,
      almost: almostSet.has(p)
    });
  }
  return { wheels, rejections, vehicleBox, aspectRejections };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.file) {
    printUsage();
    process.exit(opts.help ? 0 : 1);
  }
  const file = path.resolve(opts.file);
  console.log(`[validate-vehicle] ${file}`);

  let doc;
  try {
    doc = await loadDocument(file);
  } catch (err) {
    console.error(`error: failed to load glb: ${err.message}`);
    process.exit(2);
  }

  const root = doc.getRoot();
  const scenes = root.listScenes();
  if (scenes.length === 0) {
    console.error('error: glb contains no scenes');
    process.exit(2);
  }
  // Use the default scene if set, otherwise the first.
  const scene = root.getDefaultScene() || scenes[0];
  const primitives = gatherPrimitives(scene);
  console.log(`  primitives: ${primitives.length}`);

  // Named-bone fast path.
  const namedMatches = reportNamed(primitives);
  if (namedMatches.length > 0) {
    console.log(
      `  named-bone rig: ${namedMatches.length} wheels (${namedMatches.map((m) => m.name).join(', ')})`
    );
    for (const m of namedMatches) {
      console.log(`    ${m.name}  ${m.primitive.nodePath}`);
    }
    if (!opts.verbose) return;
    console.log('  (geometric pass shown below because --verbose)');
  }

  const geom = detectGeometricCli(primitives, opts);
  if (geom.vehicleBox) {
    console.log(`  vehicle AABB: ${fmtBox(geom.vehicleBox)}`);
  }
  console.log(`  geometric wheels: ${geom.wheels.length}`);
  for (const w of geom.wheels) {
    const dx = (w.bounds.max.x - w.bounds.min.x).toFixed(3);
    const dy = (w.bounds.max.y - w.bounds.min.y).toFixed(3);
    const dz = (w.bounds.max.z - w.bounds.min.z).toFixed(3);
    console.log(
      `    [${w.index}] side ${w.side.x}${w.side.z}  pivot(${w.pivot.x.toFixed(3)}, ${w.pivot.y.toFixed(3)}, ${w.pivot.z.toFixed(3)})  r=${w.radius.toFixed(3)}m  extent(${dx}, ${dy}, ${dz})  yz-aspect=${(Math.max(dy, dz) / Math.min(dy, dz)).toFixed(2)}`
    );
    for (const m of w.memberDetails) {
      console.log(`      ${m.nodePath}  ${fmtBox(m.aabb)}`);
    }
  }

  if (geom.aspectRejections && geom.aspectRejections.length > 0) {
    console.log(
      `  aspect-filtered (${geom.aspectRejections.length}, --aspect-max=${opts.aspectRatioMax}):`
    );
    for (const w of geom.aspectRejections) {
      const dx = (w.bounds.max.x - w.bounds.min.x).toFixed(3);
      const dy = (w.bounds.max.y - w.bounds.min.y).toFixed(3);
      const dz = (w.bounds.max.z - w.bounds.min.z).toFixed(3);
      console.log(
        `    side ${w.side.x}${w.side.z}  pivot(${w.pivot.x.toFixed(3)}, ${w.pivot.y.toFixed(3)}, ${w.pivot.z.toFixed(3)})  extent(${dx}, ${dy}, ${dz})  ${w.members.join(', ')}`
      );
    }
  }

  const showRejections =
    opts.verbose || (namedMatches.length === 0 && geom.wheels.length === 0);
  if (showRejections && geom.rejections.length > 0) {
    console.log(`  rejected primitives:`);
    const sorted = geom.rejections.slice().sort((a, b) => {
      if (a.almost !== b.almost) return a.almost ? -1 : 1;
      return a.nodePath.localeCompare(b.nodePath);
    });
    for (const r of sorted) {
      console.log(`    ${r.nodePath}  ${r.reason}`);
    }
  }

  if (namedMatches.length === 0 && geom.wheels.length === 0) {
    console.error('\nNo wheels detected. Common causes:');
    console.error(
      '  - Vehicle is not ground-centered (chassis floor not near y=0).'
    );
    console.error(
      '  - Wheels are part of a single shared mesh primitive (vertex-level CC needed).'
    );
    console.error(
      '  - All primitives sit above ground plane; try --epsilon 0.1.'
    );
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
