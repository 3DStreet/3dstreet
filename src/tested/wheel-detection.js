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

  if (root.userData) root.userData.wheels = wheels;
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

function detectGeometric(root, T, opts) {
  // Gather every Mesh under the vehicle along with its AABB and centroid
  // in vehicle-local frame. updateWorldMatrix(true, true) refreshes
  // both ancestor chain and the full subtree so the relative transform
  // computed below is correct even if the scene moved this frame.
  root.updateWorldMatrix(true, true);
  const rootWorldInv = new T.Matrix4().copy(root.matrixWorld).invert();

  const primitives = [];
  const tmpBox = new T.Box3();
  let vehicleMinY = Infinity;
  let vehicleCenterXZ = { x: 0, z: 0 };
  const vehicleBox = new T.Box3();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    // Transform the mesh's local AABB into vehicle-local frame by way
    // of: mesh.local -> world -> vehicle.local.
    const localToVehicle = new T.Matrix4().multiplyMatrices(
      rootWorldInv,
      node.matrixWorld
    );
    tmpBox.copy(node.geometry.boundingBox).applyMatrix4(localToVehicle);
    if (tmpBox.isEmpty()) return;
    const centroid = tmpBox.getCenter(new T.Vector3());
    const size = tmpBox.getSize(new T.Vector3());
    // Detect short-axis = axle direction. Wheels are "thin" along the
    // axle (e.g. width 0.2m vs height/depth ~0.6m). We pick the axis
    // with the smallest extent of THIS primitive's vehicle-local AABB.
    const axleAxisVehicle = shortestAxis(size);
    primitives.push({
      node,
      aabb: {
        min: { x: tmpBox.min.x, y: tmpBox.min.y, z: tmpBox.min.z },
        max: { x: tmpBox.max.x, y: tmpBox.max.y, z: tmpBox.max.z }
      },
      centroid: { x: centroid.x, y: centroid.y, z: centroid.z },
      axleAxisVehicle
    });
    vehicleBox.union(tmpBox);
    if (tmpBox.min.y < vehicleMinY) vehicleMinY = tmpBox.min.y;
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
    const pivot = new T.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    const radius = (maxY - minY) / 2;

    // The cluster's representative node is the largest primitive in it
    // (by AABB volume). That's the node we'll spin — typically the
    // tire, not the rim cap.
    let target = cluster[0].node;
    let targetVol = volume(cluster[0].aabb);
    for (let i = 1; i < cluster.length; i++) {
      const v = volume(cluster[i].aabb);
      if (v > targetVol) {
        target = cluster[i].node;
        targetVol = v;
      }
    }

    // Convert vehicle-local axle direction into the target node's
    // local frame. This is the axis we'll feed into rotateOnAxis().
    const vehicleAxle = cluster[0].axleAxisVehicle; // {x,y,z}
    const axleLocal = vehicleAxleToNodeLocal(vehicleAxle, root, target, T);

    out.push({
      object3D: target,
      pivot,
      radius,
      side: classifySide({
        x: pivot.x - vehicleCenterXZ.x,
        z: pivot.z - vehicleCenterXZ.z
      }),
      axleLocal,
      source: 'geometric'
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

module.exports = {
  detectWheels,
  // Pure helpers (exported for unit tests).
  groundCandidates,
  clusterByXZ,
  classifySide,
  // Constants (exported for tests / external tuning).
  NAMED_BONES,
  DEFAULT_GROUND_EPSILON,
  DEFAULT_CLUSTER_RADIUS
};
