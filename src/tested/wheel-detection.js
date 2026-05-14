/* global THREE */

/**
 * wheel-detection.js
 * ==================
 *
 * Locate the wheels of a loaded vehicle glTF so the `wheel` component
 * (and, eventually, the physics-mode drive controller) can spin them
 * without depending on a hand-rigged named-bone convention.
 *
 * Why this exists:
 *   - Not every catalog vehicle is rigged with `wheel_F_L` / `wheel_F_R`
 *     / `wheel_B_L` / `wheel_B_R` named nodes.
 *   - Draco compression, gltfpack, and other CDN optimizers routinely
 *     strip node names, so the named-bone path silently breaks even on
 *     models that originally complied.
 *   - AI mesh generators (Rodin, Tripo, Hunyuan3D, etc.) produce
 *     ground-centered vehicles with separated wheel geometry but
 *     arbitrary names like `mesh_0`.
 *
 * Detection strategy (matches the heuristic Cities: Skylines uses):
 *   1. If the named-bone rig is present, use it directly (fast path).
 *   2. Otherwise, walk all mesh primitives under the vehicle, compute
 *      each one's AABB in the vehicle's local frame, and tag any
 *      primitive whose AABB minY sits within `groundEpsilon` of the
 *      vehicle's minY as a wheel candidate.
 *   3. Cluster candidates by XZ proximity (rim + tire often = two
 *      primitives that should be treated as one wheel).
 *   4. Per cluster:
 *        pivot  = centroid
 *        radius = (cluster.maxY − cluster.minY) / 2
 *        side   = { x: 'L'|'R', z: 'F'|'B' }  from XZ vs vehicle center
 *
 * The result is cached on `rootObject3D.userData.wheels` so repeat
 * calls are O(1).
 *
 * The pure helpers (clustering, side classification, candidate filter)
 * are exported separately so they can be unit-tested without Three.js.
 */

const NAMED_BONES = [
  'wheel_F_L',
  'wheel_F_R',
  'wheel_B_L',
  'wheel_B_R',
  // Truck extras — kept optional.
  'wheel_B_L_2',
  'wheel_B_R_2'
];

const DEFAULT_GROUND_EPSILON = 0.05; // 5 cm — Cities: Skylines convention.
// Two wheel primitives count as the same wheel if their XZ centroids
// are within ~half a typical wheel diameter (small car ≈ 0.6 m). This
// lets rim + tire pairs merge while keeping front/back/left/right
// wheels apart even on a compact-car wheelbase.
const DEFAULT_CLUSTER_RADIUS = 0.3;
// A wheel is a circle viewed from its axle: the two non-axle extents
// of its AABB are equal. Real-world variance + AABB inflation pushes
// that close-to-1 ratio up to ~1.5 in practice. Anything beyond ~2 is
// flat enough to be a mud flap, fender skirt, or running-board lip
// rather than a wheel. Set to Infinity in opts to disable the filter.
const DEFAULT_ASPECT_RATIO_MAX = 2.0;

// ---------------------------------------------------------------------
// Pure helpers (no Three.js — unit-testable in plain node).
// ---------------------------------------------------------------------

/**
 * Filter primitives whose AABB sits on the ground plane of the vehicle.
 *
 * @param {Array<{aabb: {min:{x,y,z}, max:{x,y,z}}}>} primitives
 * @param {number} vehicleMinY
 * @param {number} epsilon
 * @returns {Array} subset of `primitives` that qualify as wheel candidates
 */
function groundCandidates(primitives, vehicleMinY, epsilon) {
  const eps = epsilon == null ? DEFAULT_GROUND_EPSILON : epsilon;
  const out = [];
  for (const p of primitives) {
    if (!p.aabb) continue;
    if (p.aabb.min.y - vehicleMinY <= eps) out.push(p);
  }
  return out;
}

/**
 * Greedy single-linkage clustering by XZ proximity. Each candidate
 * joins the first existing cluster whose centroid is within
 * `clusterRadius`; otherwise it starts a new cluster.
 *
 * Order-dependent but deterministic for a given input — fine for our
 * use case (4-to-6 wheel primitives at most).
 *
 * @param {Array<{centroid:{x,y,z}}>} items
 * @param {number} clusterRadius
 * @returns {Array<Array>} clusters, each an array of items
 */
function clusterByXZ(items, clusterRadius) {
  const r = clusterRadius == null ? DEFAULT_CLUSTER_RADIUS : clusterRadius;
  const r2 = r * r;
  const clusters = [];
  const centroids = []; // running XZ centroid per cluster
  for (const item of items) {
    let joined = false;
    for (let i = 0; i < clusters.length; i++) {
      const c = centroids[i];
      const dx = item.centroid.x - c.x;
      const dz = item.centroid.z - c.z;
      if (dx * dx + dz * dz <= r2) {
        clusters[i].push(item);
        // Update running centroid.
        const n = clusters[i].length;
        c.x += (item.centroid.x - c.x) / n;
        c.z += (item.centroid.z - c.z) / n;
        joined = true;
        break;
      }
    }
    if (!joined) {
      clusters.push([item]);
      centroids.push({ x: item.centroid.x, z: item.centroid.z });
    }
  }
  return clusters;
}

/**
 * Split a mesh primitive's vertices into connected components.
 *
 * Two vertices are considered connected if they share a triangle. To
 * handle duplicated vertices at UV/normal seams (where two distinct
 * vertex indices sit at the same 3D position), positions are snapped to
 * a grid of size `positionTolerance` and treated as the same canonical
 * point during union-find.
 *
 * This is the input filter that lets the rest of the wheel detector
 * work on exporter-merged glbs (Draco/gltfpack often collapse multiple
 * sub-objects into a single primitive). Run it first; pretend each
 * returned component is its own "primitive" downstream.
 *
 * @param {Float32Array|number[]} positions - length 3N
 * @param {Uint32Array|Uint16Array|number[]|null} indices - length 3M, or
 *   null for non-indexed primitives (every 3 consecutive vertices = a tri)
 * @param {object} [opts]
 * @param {number} [opts.positionTolerance=1e-4] grid size for merging
 *   coincident vertices during connectivity analysis (meters)
 * @returns {Array<{vertexIndices: number[], aabb: {min, max}}>}
 */
function splitIntoComponents(positions, indices, opts = {}) {
  const tol = opts.positionTolerance != null ? opts.positionTolerance : 1e-4;
  const n = Math.floor(positions.length / 3);
  if (n === 0) return [];

  // Canonicalize: positions within `tol` of each other share an ID.
  const keyToCanon = new Map();
  const canon = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.round(positions[i * 3] / tol);
    const y = Math.round(positions[i * 3 + 1] / tol);
    const z = Math.round(positions[i * 3 + 2] / tol);
    const key = x + '|' + y + '|' + z;
    let c = keyToCanon.get(key);
    if (c === undefined) {
      c = keyToCanon.size;
      keyToCanon.set(key, c);
    }
    canon[i] = c;
  }

  // Union-find over canonical IDs.
  const m = keyToCanon.size;
  const parent = new Int32Array(m);
  for (let i = 0; i < m; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  if (indices && indices.length >= 3) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = canon[indices[t]];
      const b = canon[indices[t + 1]];
      const c = canon[indices[t + 2]];
      union(a, b);
      union(b, c);
    }
  } else {
    for (let t = 0; t + 2 < n; t += 3) {
      union(canon[t], canon[t + 1]);
      union(canon[t + 1], canon[t + 2]);
    }
  }

  // Group original vertex indices by root, accumulating AABBs.
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(canon[i]);
    let g = groups.get(root);
    if (!g) {
      g = {
        vertexIndices: [],
        aabb: {
          min: { x: Infinity, y: Infinity, z: Infinity },
          max: { x: -Infinity, y: -Infinity, z: -Infinity }
        }
      };
      groups.set(root, g);
    }
    g.vertexIndices.push(i);
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < g.aabb.min.x) g.aabb.min.x = x;
    if (y < g.aabb.min.y) g.aabb.min.y = y;
    if (z < g.aabb.min.z) g.aabb.min.z = z;
    if (x > g.aabb.max.x) g.aabb.max.x = x;
    if (y > g.aabb.max.y) g.aabb.max.y = y;
    if (z > g.aabb.max.z) g.aabb.max.z = z;
  }
  return Array.from(groups.values());
}

/**
 * Wheel-likeness test based on AABB aspect ratio.
 *
 * A wheel viewed end-on (looking down its axle) is a circle, so its
 * two non-axle extents are equal. The axle is the shortest axis of
 * the AABB. We compare the remaining two axes; if their ratio exceeds
 * `maxRatio`, the cluster is too flat / too elongated to be a wheel
 * (mud flap, skirt, running-board edge).
 *
 * @param {{min:{x,y,z}, max:{x,y,z}}} bounds
 * @param {number} [maxRatio=DEFAULT_ASPECT_RATIO_MAX]
 * @returns {boolean}
 */
function wheelLikeAspect(bounds, maxRatio) {
  const limit = maxRatio == null ? DEFAULT_ASPECT_RATIO_MAX : maxRatio;
  if (!isFinite(limit)) return true; // off switch
  const dx = bounds.max.x - bounds.min.x;
  const dy = bounds.max.y - bounds.min.y;
  const dz = bounds.max.z - bounds.min.z;
  if (dx <= 0 || dy <= 0 || dz <= 0) return false;
  // Vehicle local frame: axle is along X (forward = -Z, up = Y). A
  // wheel viewed down its axle is a circle, so its YZ side-profile is
  // square: dy ≈ dz. Mud flaps and fender skirts are very flat in one
  // of those axes and fail this test.
  const yzRatio = dy >= dz ? dy / dz : dz / dy;
  if (yzRatio > limit) return false;
  // Axle width (X) must not exceed the wheel diameter — rules out long
  // running-board / sill strips that happen to be square in YZ.
  if (dx > dy * limit) return false;
  return true;
}

/**
 * Classify a wheel cluster by which side of the vehicle it sits on.
 * Sign conventions follow A-Frame defaults (forward = -Z, right = +X).
 *
 * @param {{x:number, z:number}} pivotXZ
 * @returns {{x:'L'|'R', z:'F'|'B'}}
 */
function classifySide(pivotXZ) {
  return {
    x: pivotXZ.x < 0 ? 'L' : 'R',
    z: pivotXZ.z < 0 ? 'F' : 'B'
  };
}

/**
 * Build a sub-mesh index buffer that keeps only triangles whose three
 * vertices are all in `vertexIndices`, with each kept vertex remapped
 * to its position in `vertexIndices` (so the sub-mesh's attribute
 * arrays can be packed densely into `vertexIndices.length` slots).
 *
 * Used by the surgery path to extract a wheel sub-geometry from a
 * Draco/gltfpack-merged primitive without disturbing the chassis.
 *
 * @param {Uint32Array|Uint16Array|number[]|null} indices source index
 *   buffer; `null` means triangle soup (every 3 positions = a triangle).
 * @param {number[]} vertexIndices vertices to keep, in the order they
 *   should appear in the new sub-mesh.
 * @param {number} vertexCount total vertex count in the source geometry
 *   (only consulted in soup mode for the triangle-count bound).
 * @returns {{ newIndices: number[], oldToNew: Map<number, number> }}
 */
function buildSubmeshIndices(indices, vertexIndices, vertexCount) {
  const oldToNew = new Map();
  for (let i = 0; i < vertexIndices.length; i++) {
    oldToNew.set(vertexIndices[i], i);
  }
  const newIndices = [];
  if (indices && indices.length >= 3) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      if (oldToNew.has(a) && oldToNew.has(b) && oldToNew.has(c)) {
        newIndices.push(oldToNew.get(a), oldToNew.get(b), oldToNew.get(c));
      }
    }
  } else {
    // Soup: vertex i forms a triangle with i+1 / i+2 every 3 verts.
    for (let t = 0; t + 2 < vertexCount; t += 3) {
      if (oldToNew.has(t) && oldToNew.has(t + 1) && oldToNew.has(t + 2)) {
        newIndices.push(
          oldToNew.get(t),
          oldToNew.get(t + 1),
          oldToNew.get(t + 2)
        );
      }
    }
  }
  return { newIndices, oldToNew };
}

/**
 * Return only the triangles whose three vertices are ALL absent from
 * `removedVertexSet`. The complement of buildSubmeshIndices — used to
 * rebuild the chassis primitive after pulling wheel vertices out, so
 * the chassis doesn't render ghost wheels at their original positions.
 *
 * Returns original (not remapped) vertex indices — the chassis keeps
 * its full attribute arrays, only its index buffer changes. Unused
 * vertices stay around as harmless dead weight rather than triggering
 * a full attribute compaction.
 *
 * @param {Uint32Array|Uint16Array|number[]|null} indices
 * @param {Set<number>} removedVertexSet
 * @param {number} vertexCount
 * @returns {number[]} flat triangle list
 */
function removeTriangles(indices, removedVertexSet, vertexCount) {
  const kept = [];
  if (indices && indices.length >= 3) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      if (
        !removedVertexSet.has(a) &&
        !removedVertexSet.has(b) &&
        !removedVertexSet.has(c)
      ) {
        kept.push(a, b, c);
      }
    }
  } else {
    for (let t = 0; t + 2 < vertexCount; t += 3) {
      if (
        !removedVertexSet.has(t) &&
        !removedVertexSet.has(t + 1) &&
        !removedVertexSet.has(t + 2)
      ) {
        kept.push(t, t + 1, t + 2);
      }
    }
  }
  return kept;
}

// ---------------------------------------------------------------------
// Three.js-backed detection (runtime path).
// ---------------------------------------------------------------------

/**
 * Detect wheels under a vehicle Object3D. Result is cached on
 * `root.userData.wheels` — pass `{ force: true }` to recompute.
 *
 * Each wheel record:
 *   {
 *     object3D,         // THREE.Object3D to spin (the wheel node)
 *     pivot,            // THREE.Vector3, in vehicle local frame
 *     radius,           // number (meters)
 *     side,             // { x: 'L'|'R', z: 'F'|'B' }
 *     axleLocal,        // THREE.Vector3 in wheel.object3D local frame —
 *                       //   the axis around which to rotate to spin.
 *     source            // 'named' | 'geometric'
 *   }
 *
 * @param {THREE.Object3D} root
 * @param {{force?: boolean, groundEpsilon?: number, clusterRadius?: number, THREE?: any}} opts
 * @returns {Array} wheel records (possibly empty)
 */
function detectWheels(root, opts = {}) {
  if (!root) return [];
  if (!opts.force && root.userData && root.userData.wheels) {
    return root.userData.wheels;
  }
  const T = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
  if (!T) {
    console.warn('[wheel-detection] THREE not available; returning []');
    return [];
  }

  let wheels = detectNamed(root, T);
  if (wheels.length === 0) {
    wheels = detectGeometric(root, T, opts);
  }

  // Surgery turns `cc-pending-surgery` placeholders into real spinnable
  // sub-meshes by carving wheel vertices out of the host primitive and
  // attaching them under a new pivot Object3D at the wheel center.
  // Off-switchable so callers (e.g. CLI validator) can inspect the raw
  // detection output without mutating geometry.
  if (opts.performSurgery !== false) {
    const needsSurgery = wheels.some((w) => w.surgeryParts);
    if (needsSurgery) performWheelSurgery(root, wheels, T);
  }

  if (root.userData) root.userData.wheels = wheels;
  if (wheels.length > 0) {
    const counts = wheels.reduce((acc, w) => {
      acc[w.source] = (acc[w.source] || 0) + 1;
      return acc;
    }, {});
    console.info(
      '[wheel-detection]',
      opts.label || root.name || '<vehicle>',
      `${wheels.length} wheels —`,
      counts
    );
  }
  return wheels;
}

function detectNamed(root, T) {
  const out = [];
  // Preserve historic spin axis: the named-bone rig spins around the
  // wheel node's local Y axis (that's what the original `wheel`
  // component did via rotateY).
  const axleLocalY = new T.Vector3(0, 1, 0);
  for (const name of NAMED_BONES) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    const pivot = new T.Vector3();
    // Pivot expressed in vehicle (root) local frame.
    node.updateWorldMatrix(true, false);
    pivot.setFromMatrixPosition(node.matrixWorld);
    root.worldToLocal(pivot);
    out.push({
      object3D: node,
      pivot,
      // Radius isn't known for the named path — caller (legacy wheel
      // component) ignores it, the physics binder will fall back to
      // the geometric path if it needs precise radii.
      radius: 0,
      side: sideFromBoneName(name),
      axleLocal: axleLocalY.clone(),
      source: 'named',
      name
    });
  }
  return out;
}

function sideFromBoneName(name) {
  return {
    x: name.includes('_L') ? 'L' : 'R',
    z: name.includes('_F') ? 'F' : 'B'
  };
}

/**
 * Cache CC result on the geometry instance so we pay union-find at
 * most once per unique BufferGeometry, regardless of how many vehicle
 * spawns share it (mixin-based traffic shares geometry by reference).
 */
function getOrComputeComponents(geometry) {
  if (!geometry.userData) geometry.userData = {};
  if (geometry.userData._wheelComponents) {
    return geometry.userData._wheelComponents;
  }
  const pos = geometry.attributes && geometry.attributes.position;
  if (!pos) return null;
  const idx = geometry.index;
  const components = splitIntoComponents(pos.array, idx ? idx.array : null);
  geometry.userData._wheelComponents = components;
  return components;
}

function detectGeometric(root, T, opts) {
  // Gather every Mesh under the vehicle along with its AABB and centroid
  // in vehicle-local frame. updateWorldMatrix(true, true) refreshes
  // both ancestor chain and the full subtree so the relative transform
  // computed below is correct even if the scene moved this frame.
  root.updateWorldMatrix(true, true);
  const rootWorldInv = new T.Matrix4().copy(root.matrixWorld).invert();

  const primitives = [];
  let vehicleMinY = Infinity;
  let vehicleCenterXZ = { x: 0, z: 0 };
  const vehicleBox = new T.Box3();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const localToVehicle = new T.Matrix4().multiplyMatrices(
      rootWorldInv,
      node.matrixWorld
    );
    // Vertex-level CC: a Mesh whose geometry contains multiple
    // disjoint sub-objects (Draco/gltfpack often merge chassis + wheels
    // into a single primitive) gets split into one entry per component
    // here. Cached on `geometry.userData._wheelComponents` so we pay
    // the union-find cost once per unique geometry instance, regardless
    // of how many traffic spawns share it.
    const components = getOrComputeComponents(node.geometry);
    if (!components || components.length === 0) return;
    const multi = components.length > 1;

    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci];
      const compBoxLocal = new T.Box3(
        new T.Vector3(comp.aabb.min.x, comp.aabb.min.y, comp.aabb.min.z),
        new T.Vector3(comp.aabb.max.x, comp.aabb.max.y, comp.aabb.max.z)
      );
      const compBoxVehicle = compBoxLocal.clone().applyMatrix4(localToVehicle);
      if (compBoxVehicle.isEmpty()) continue;
      const centroid = compBoxVehicle.getCenter(new T.Vector3());
      const size = compBoxVehicle.getSize(new T.Vector3());
      const axleAxisVehicle = shortestAxis(size);
      primitives.push({
        node,
        componentIndex: multi ? ci : null,
        vertexIndices: multi ? comp.vertexIndices : null,
        aabb: {
          min: {
            x: compBoxVehicle.min.x,
            y: compBoxVehicle.min.y,
            z: compBoxVehicle.min.z
          },
          max: {
            x: compBoxVehicle.max.x,
            y: compBoxVehicle.max.y,
            z: compBoxVehicle.max.z
          }
        },
        centroid: { x: centroid.x, y: centroid.y, z: centroid.z },
        axleAxisVehicle,
        fromMultiComponent: multi
      });
      vehicleBox.union(compBoxVehicle);
      if (compBoxVehicle.min.y < vehicleMinY) {
        vehicleMinY = compBoxVehicle.min.y;
      }
    }
  });

  if (primitives.length === 0) return [];
  vehicleCenterXZ = {
    x: (vehicleBox.min.x + vehicleBox.max.x) / 2,
    z: (vehicleBox.min.z + vehicleBox.max.z) / 2
  };

  const candidates = groundCandidates(
    primitives,
    vehicleMinY,
    opts.groundEpsilon
  );
  if (candidates.length === 0) return [];

  const clusters = clusterByXZ(candidates, opts.clusterRadius);

  const out = [];
  for (const cluster of clusters) {
    // Cluster-wide bounds in vehicle-local frame.
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const p of cluster) {
      if (p.aabb.min.x < minX) minX = p.aabb.min.x;
      if (p.aabb.min.y < minY) minY = p.aabb.min.y;
      if (p.aabb.min.z < minZ) minZ = p.aabb.min.z;
      if (p.aabb.max.x > maxX) maxX = p.aabb.max.x;
      if (p.aabb.max.y > maxY) maxY = p.aabb.max.y;
      if (p.aabb.max.z > maxZ) maxZ = p.aabb.max.z;
    }
    const clusterBounds = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
    if (!wheelLikeAspect(clusterBounds, opts.aspectRatioMax)) continue;
    const pivot = new T.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    const radius = (maxY - minY) / 2;

    // Pick the largest sub-AABB in the cluster as the representative
    // for axle / target lookups. If any member came from a multi-
    // component primitive, this cluster needs geometry surgery before
    // it can be spun — we still emit the wheel record (pivot, radius,
    // side are valid) but leave object3D null so tick() skips it.
    let target = cluster[0].node;
    let targetVol = volume(cluster[0].aabb);
    let pendingSurgery = false;
    const clusterVertexIndices = [];
    let surgeryNode = null;
    for (let i = 0; i < cluster.length; i++) {
      const v = volume(cluster[i].aabb);
      if (v > targetVol) {
        target = cluster[i].node;
        targetVol = v;
      }
      if (cluster[i].fromMultiComponent) {
        pendingSurgery = true;
        surgeryNode = cluster[i].node;
        clusterVertexIndices.push({
          node: cluster[i].node,
          componentIndex: cluster[i].componentIndex,
          vertexIndices: cluster[i].vertexIndices
        });
      }
    }

    const vehicleAxle = cluster[0].axleAxisVehicle; // {x,y,z}
    const axleLocal = vehicleAxleToNodeLocal(vehicleAxle, root, target, T);

    out.push({
      object3D: pendingSurgery ? null : target,
      pivot,
      radius,
      side: classifySide({
        x: pivot.x - vehicleCenterXZ.x,
        z: pivot.z - vehicleCenterXZ.z
      }),
      axleLocal,
      // Vehicle-frame axle is kept so the surgery path can spin its
      // synthetic pivot directly without re-deriving the axis from a
      // node that's about to lose those vertices.
      axleVehicle: vehicleAxle,
      source: pendingSurgery ? 'cc-pending-surgery' : 'geometric',
      surgeryNode,
      surgeryParts: pendingSurgery ? clusterVertexIndices : null
    });
  }
  return out;
}

function volume(aabb) {
  return (
    (aabb.max.x - aabb.min.x) *
    (aabb.max.y - aabb.min.y) *
    (aabb.max.z - aabb.min.z)
  );
}

function shortestAxis(size) {
  // Smallest of |x|, |y|, |z|. A wheel's AABB is thinnest along its
  // axle, so this picks the axle direction in the vehicle's local
  // frame.
  if (size.x <= size.y && size.x <= size.z) return { x: 1, y: 0, z: 0 };
  if (size.y <= size.x && size.y <= size.z) return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

function vehicleAxleToNodeLocal(vehicleAxle, root, node, T) {
  // Express `vehicleAxle` (a unit vector in root's local frame) in
  // `node`'s local frame. Use world quaternions so any chain of
  // intermediate parents is handled correctly.
  const rootQ = new T.Quaternion();
  const nodeQ = new T.Quaternion();
  root.getWorldQuaternion(rootQ);
  node.getWorldQuaternion(nodeQ);
  const v = new T.Vector3(vehicleAxle.x, vehicleAxle.y, vehicleAxle.z);
  // root local -> world
  v.applyQuaternion(rootQ);
  // world -> node local
  v.applyQuaternion(nodeQ.invert());
  if (v.lengthSq() < 1e-8) v.set(1, 0, 0);
  return v.normalize();
}

/**
 * Carve `cc-pending-surgery` wheels out of their host primitives and
 * rebuild them as spinnable sub-meshes under fresh pivot Object3Ds.
 *
 * For each pending wheel:
 *   1. Create a pivot Object3D under `root` at the wheel's vehicle-local
 *      pivot. The pivot has identity rotation relative to root, so the
 *      vehicle-frame axle direction is also the pivot-frame axle — that's
 *      what gets written to `axleLocal` so the existing rotateOnAxis spin
 *      path Just Works.
 *   2. For each surgery part (one or more vertex subsets, possibly from
 *      different host nodes), build a fresh BufferGeometry containing
 *      only those vertices. Positions / normals / tangents are
 *      transformed from the host node's local frame into the pivot's
 *      local frame; other attributes (uv, color, skin*, ...) are copied
 *      verbatim. Materials are reused by reference.
 *   3. After all sub-meshes are built, rewrite each host node's geometry
 *      index buffer to drop the surgery vertices' triangles. Without
 *      this step the chassis would still render ghost wheels at their
 *      original positions, producing double-imaging.
 *
 * Host geometries are CLONED before mutation, so this is safe to call
 * on Mesh instances that share a BufferGeometry across spawns (the
 * catalog-mixin case).
 */
function performWheelSurgery(root, wheels, T) {
  // Accumulate per-host-node vertex-removal sets across all wheels
  // first, then rewrite each affected geometry once at the end. A single
  // node can contribute parts to multiple wheels (e.g. a merged glb
  // with all four wheels inside one chassis primitive).
  const nodeRemovals = new Map(); // node -> Set<vertexIndex>

  for (const wheel of wheels) {
    if (!wheel.surgeryParts || wheel.surgeryParts.length === 0) continue;

    const pivot = new T.Object3D();
    pivot.position.copy(wheel.pivot);
    pivot.name = `wheel-pivot-${wheel.side.x}${wheel.side.z}`;
    root.add(pivot);
    pivot.updateMatrixWorld(true);
    const pivotWorldInv = new T.Matrix4().copy(pivot.matrixWorld).invert();

    let primary = null; // first sub-mesh used as object3D fallback
    for (const part of wheel.surgeryParts) {
      const node = part.node;
      if (!node || !node.geometry) continue;
      // Transform from node-local into pivot-local. Pivot is a child of
      // root with no rotation/scale, so this composition handles
      // arbitrarily deep host node hierarchies and any root-level
      // transform on the vehicle.
      const nodeToPivot = new T.Matrix4().multiplyMatrices(
        pivotWorldInv,
        node.matrixWorld
      );
      const subGeo = buildSubGeometry(
        node.geometry,
        part.vertexIndices,
        nodeToPivot,
        T
      );
      if (!subGeo) continue;
      const subMesh = new T.Mesh(subGeo, node.material);
      subMesh.castShadow = node.castShadow;
      subMesh.receiveShadow = node.receiveShadow;
      pivot.add(subMesh);
      if (!primary) primary = subMesh;

      let set = nodeRemovals.get(node);
      if (!set) {
        set = new Set();
        nodeRemovals.set(node, set);
      }
      for (const vi of part.vertexIndices) set.add(vi);
    }

    if (primary) {
      // The spin path keys off `object3D` and `axleLocal`. Use the pivot
      // itself (not the primary sub-mesh) so rotation hits every part
      // we attached to it.
      wheel.object3D = pivot;
      // Vehicle frame == pivot frame (pivot has identity rotation
      // relative to root); copy the axle direction directly.
      const a = wheel.axleVehicle;
      if (a) wheel.axleLocal = new T.Vector3(a.x, a.y, a.z).normalize();
      wheel.source = 'cc-surgery';
    } else {
      // No part successfully extracted (degenerate vertex subset).
      // Leave the wheel record marked pending so tick() keeps skipping
      // it and we don't leave an empty pivot dangling.
      root.remove(pivot);
    }
  }

  // Strip surgery vertices from each host node's geometry. We clone
  // before mutating so catalog-shared BufferGeometries don't lose their
  // chassis on the next spawn.
  for (const [node, removeSet] of nodeRemovals) {
    rewriteGeometryWithoutVertices(node, removeSet, T);
  }
}

/**
 * Build a fresh BufferGeometry holding only the listed vertices,
 * transformed by `nodeToPivot` and reindexed against the surviving
 * triangles in the source primitive.
 *
 * Returns `null` if no triangle survives the filter (the requested
 * vertex subset doesn't form any complete tri in the source).
 */
function buildSubGeometry(srcGeo, vertexIndices, nodeToPivot, T) {
  const posAttr = srcGeo.attributes && srcGeo.attributes.position;
  if (!posAttr) return null;
  const N = vertexIndices.length;
  if (N === 0) return null;

  const srcIndex = srcGeo.index ? srcGeo.index.array : null;
  const { newIndices } = buildSubmeshIndices(
    srcIndex,
    vertexIndices,
    posAttr.count
  );
  if (newIndices.length === 0) return null;

  const subGeo = new T.BufferGeometry();
  const tmpV = new T.Vector3();
  const normalMat = new T.Matrix3().getNormalMatrix(nodeToPivot);

  for (const name in srcGeo.attributes) {
    const srcAttr = srcGeo.attributes[name];
    const itemSize = srcAttr.itemSize;
    const dst = new srcAttr.array.constructor(N * itemSize);
    for (let i = 0; i < N; i++) {
      const oldI = vertexIndices[i];
      const srcOff = oldI * itemSize;
      const dstOff = i * itemSize;
      for (let k = 0; k < itemSize; k++) {
        dst[dstOff + k] = srcAttr.array[srcOff + k];
      }
    }

    if (name === 'position' && itemSize >= 3) {
      for (let i = 0; i < N; i++) {
        const o = i * itemSize;
        tmpV.set(dst[o], dst[o + 1], dst[o + 2]).applyMatrix4(nodeToPivot);
        dst[o] = tmpV.x;
        dst[o + 1] = tmpV.y;
        dst[o + 2] = tmpV.z;
      }
    } else if (name === 'normal' && itemSize >= 3) {
      for (let i = 0; i < N; i++) {
        const o = i * itemSize;
        tmpV
          .set(dst[o], dst[o + 1], dst[o + 2])
          .applyMatrix3(normalMat)
          .normalize();
        dst[o] = tmpV.x;
        dst[o + 1] = tmpV.y;
        dst[o + 2] = tmpV.z;
      }
    } else if (name === 'tangent' && itemSize === 4) {
      // Tangent xyz rotates with the normal transform; w (handedness)
      // is preserved as-is.
      for (let i = 0; i < N; i++) {
        const o = i * itemSize;
        tmpV
          .set(dst[o], dst[o + 1], dst[o + 2])
          .applyMatrix3(normalMat)
          .normalize();
        dst[o] = tmpV.x;
        dst[o + 1] = tmpV.y;
        dst[o + 2] = tmpV.z;
      }
    }

    subGeo.setAttribute(
      name,
      new T.BufferAttribute(dst, itemSize, srcAttr.normalized)
    );
  }

  const IndexCtor = N > 65535 ? Uint32Array : Uint16Array;
  subGeo.setIndex(new T.BufferAttribute(new IndexCtor(newIndices), 1));
  subGeo.computeBoundingBox();
  subGeo.computeBoundingSphere();
  return subGeo;
}

/**
 * Replace `node.geometry` with a clone whose index buffer omits every
 * triangle touching a vertex in `removeSet`. Attribute arrays are left
 * intact — the dropped vertices become unreferenced but harmless. The
 * clone protects shared catalog BufferGeometry instances from mutation.
 */
function rewriteGeometryWithoutVertices(node, removeSet, T) {
  const oldGeo = node.geometry;
  const posAttr = oldGeo.attributes && oldGeo.attributes.position;
  if (!posAttr) return;
  const srcIndex = oldGeo.index ? oldGeo.index.array : null;
  const kept = removeTriangles(srcIndex, removeSet, posAttr.count);

  const newGeo = oldGeo.clone();
  if (kept.length === 0) {
    newGeo.setIndex(new T.BufferAttribute(new Uint16Array(0), 1));
  } else {
    const IndexCtor = posAttr.count > 65535 ? Uint32Array : Uint16Array;
    newGeo.setIndex(new T.BufferAttribute(new IndexCtor(kept), 1));
  }
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();
  node.geometry = newGeo;
}

module.exports = {
  detectWheels,
  // Pure helpers (exported for unit tests).
  groundCandidates,
  clusterByXZ,
  classifySide,
  splitIntoComponents,
  wheelLikeAspect,
  buildSubmeshIndices,
  removeTriangles,
  // Constants (exported for tests / external tuning).
  NAMED_BONES,
  DEFAULT_GROUND_EPSILON,
  DEFAULT_CLUSTER_RADIUS,
  DEFAULT_ASPECT_RATIO_MAX
};
