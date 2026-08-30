/* global THREE */

/**
 * scene-colliders
 * ===============
 *
 * Static-collider seeding shared by the play-mode bootstraps
 * (`drive-mode` in play-mode-vehicle.js, `fly-mode` in
 * play-mode-helicopter.js). Extracted verbatim from drive-mode so both
 * features seed identical physics for streets and obstacles; see each
 * function's doc for the geometry rationale.
 */

/**
 * Walk every managed-street's segments and seed a static cuboid
 * matching each segment's visible top surface.
 *
 * Key fact about 3DStreet rendering (see
 * `src/tested/street-segment-utils.js`): the segment's entity
 * origin is positioned at world Y = BASE_SURFACE_DEPTH (0.15) +
 * level × CURB_HEIGHT (0.15), and the visible surface mesh has
 * its TOP face exactly at the entity origin. So a drive lane
 * (level 0) has its visible top at Y=0.15; a sidewalk (level 1)
 * at Y=0.30; an elevated bus stop (level 2) at Y=0.45; etc.
 *
 * Earlier this seeder used the literal constant 0.15 for sidewalk
 * top and skipped drive lanes, which mis-aligned with visuals by
 * 0.15m in both directions (drive-lane wheels sank into the road,
 * sidewalk wheels hovered above the curb). Reading each segment's
 * own world Y is what makes physics match visuals at every level.
 *
 * Curb walls between adjacent segments at different levels emerge
 * automatically from the slab side faces. Slabs are 0.5m deep so
 * the curb walls extend well below the visible bottom and the
 * chassis can't wedge into a gap.
 *
 * Sloped segments (`street-segment` `slope: true`): the visible mesh
 * (`below-box`) shears its top face across the segment's local x (width)
 * axis — top vertices are displaced in Y by `slopeDeltas.start` at the
 * -x edge and `slopeDeltas.end` at the +x edge (relative to the entity
 * origin, the mean height) while their X is left untouched, so the side
 * walls stay vertical. A plain cuboid can't represent that, and a rotated
 * cuboid would slant the curb walls (misaligning the step-down face to a
 * lower neighbor). So we mirror the mesh exactly with an 8-vertex convex
 * hull: sheared top, flat bottom, vertical sides. A flat average-height
 * slab (the earlier behavior) left the drive surface level and the car
 * ignored the ramp.
 */
function seedSegmentColliders(sceneEl) {
  const physics = sceneEl.systems['play-mode-physics'];
  const COLLIDABLE_LANE_TYPES = new Set([
    'drive-lane',
    'bus-lane',
    'bike-lane',
    'sidewalk',
    'parking-lane',
    'divider',
    'grass',
    'rail'
  ]);
  const SLAB_DEPTH = 0.5;
  const halfY = SLAB_DEPTH / 2;

  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  let count = 0;
  let slopedCount = 0;
  sceneEl
    .querySelectorAll('[managed-street] > [street-segment]')
    .forEach((segEl) => {
      const comp = segEl.components?.['street-segment'];
      const seg = comp?.data;
      if (!seg || !COLLIDABLE_LANE_TYPES.has(seg.type)) return;
      const length = seg.length || 60;
      const width = seg.width || 1.5;
      segEl.object3D.updateMatrixWorld();
      segEl.object3D.getWorldPosition(wp);
      segEl.object3D.getWorldQuaternion(wq);

      // slopeDeltas is set by street-segment when slope is on; the top
      // face runs from `.start` (local -x edge) to `.end` (local +x edge).
      const deltas = comp.slopeDeltas;
      let seeded = false;
      if (deltas && (deltas.start !== 0 || deltas.end !== 0)) {
        // 8 vertices in the segment's local frame (origin at the
        // mean-height entity origin). Top edges carry the slope deltas;
        // X is preserved top-to-bottom, so the side walls stay vertical
        // and match the below-box shear. The flat bottom sits SLAB_DEPTH
        // below the *lower* top edge so the prism is always well-formed
        // (never zero-thickness or inverted, however steep the slope)
        // and every curb wall extends well below its neighbor's surface.
        const hw = width / 2;
        const hl = length / 2;
        const floorY = Math.min(deltas.start, deltas.end) - SLAB_DEPTH;
        const verts = new Float32Array([
          -hw,
          deltas.start,
          -hl,
          -hw,
          deltas.start,
          hl,
          hw,
          deltas.end,
          -hl,
          hw,
          deltas.end,
          hl,
          -hw,
          floorY,
          -hl,
          -hw,
          floorY,
          hl,
          hw,
          floorY,
          -hl,
          hw,
          floorY,
          hl
        ]);
        const body = physics.addStaticConvexHull(
          { x: wp.x, y: wp.y, z: wp.z },
          { x: wq.x, y: wq.y, z: wq.z, w: wq.w },
          verts,
          'segment'
        );
        if (body) {
          slopedCount++;
          seeded = true;
        }
        // else: degenerate hull — drop to the flat-slab fallback below.
      }
      if (!seeded) {
        // Flat segment (or hull fallback): visible top = segment world Y.
        // Place slab so its TOP face is exactly there: center the cuboid
        // halfY below segY.
        physics.addStaticCuboid(
          { x: wp.x, y: wp.y - halfY, z: wp.z },
          { x: width / 2, y: halfY, z: length / 2 },
          { x: wq.x, y: wq.y, z: wq.z, w: wq.w },
          'segment'
        );
      }
      count++;
    });
  console.log(
    '[play-colliders] seeded',
    count,
    'per-segment slabs (' +
      slopedCount +
      ' sheared for slope; curbs emerge from level differences)'
  );
}

/**
 * Walk the scene for entities whose mixin's <a-mixin category> starts
 * with "vehicles", "cyclists", or "buildings" and seed a static
 * cuboid collider sized to each one's world-frame bounding box.
 * Everything under any element in `excludeRoots` (the player's source
 * entity and the spawned player rig) is skipped — that's the dynamic
 * chassis. Bounding boxes are re-evaluated on model-loaded since GLBs
 * load async.
 *
 * @param {Element} sceneEl
 * @param {Element[]} excludeRoots — entities (with their subtrees) to skip
 * @returns {Array<{el: Element, fn: Function}>} model-loaded listeners
 *   the caller must remove on cleanup
 */
function seedObstacleColliders(sceneEl, excludeRoots) {
  const physics = sceneEl.systems['play-mode-physics'];
  const roots = (excludeRoots || []).filter(Boolean);
  // 'vehicles' and 'cyclists' catch parked cars / static cyclists on
  // non-playable streets. 'buildings' is the Tier-2 add — a car
  // driving through a wall is the highest-signal break in
  // suspension of disbelief. 'fixtures' (benches, shelters, food
  // carts, light poles) and 'dividers' (jersey barriers, bollards,
  // planters, cones) are the Tier-3 add. Skipping 'plants' (tree
  // canopy AABB feels unfair) and 'signs' (thin posts on most
  // variants). Light-pole / cone tall+thin AABBs inside the
  // included categories are an accepted minor cost — cheap to
  // revisit when a user complains.
  const COLLIDABLE_CATEGORIES = [
    'vehicles',
    'cyclists',
    'buildings',
    'fixtures',
    'dividers'
  ];
  const isVehicleMixin = (id) => {
    const mixin = document.getElementById(id);
    if (!mixin || mixin.tagName !== 'A-MIXIN') return false;
    const cat = mixin.getAttribute('category') || '';
    return COLLIDABLE_CATEGORIES.some((c) => cat.indexOf(c) === 0);
  };
  const isCandidate = (el) => {
    if (!el) return false;
    // Skip the player's own source entity + spawned rig (and their
    // subtrees, e.g. the cloned mesh) so we don't seed a phantom
    // static collider at the spawn point.
    for (const root of roots) {
      if (root === el || root.contains(el)) return false;
    }
    // Animated traffic gets kinematic colliders from
    // street-traffic; don't double-seed with static cuboids.
    if (el.hasAttribute('data-play-mode-traffic')) return false;
    // Skip entities that traffic has hidden — they're visually gone,
    // so a static collider sitting at their last pose would just
    // produce phantom collisions.
    if (el.object3D && !el.object3D.visible) return false;
    const mixinAttr = el.getAttribute('mixin');
    if (!mixinAttr) return false;
    return mixinAttr.split(/\s+/).some(isVehicleMixin);
  };
  const listeners = [];
  // Bounding boxes wrap the mesh's full AABB which is generally
  // larger than the visible silhouette; shrink to 80% so the collider
  // feels closer to the mesh visually.
  const COLLIDER_SHRINK = 0.8;
  const add = (el) => {
    const box = new THREE.Box3().setFromObject(el.object3D);
    // Runtime mesh batching strips a static model's mesh out of its own
    // object3D (folded into a shared BatchedMesh), so setFromObject yields
    // an empty box and the obstacle — a user-placed cone, bollard, jersey
    // barrier — would get no collider. batch-models stashes the entity-local
    // AABB on object3D for exactly this "no mesh tree" case (also used by the
    // editor's selection box, EditorControls.js); transform it to world space.
    if (box.isEmpty() && el.object3D._batchLocalBbox) {
      el.object3D.updateMatrixWorld();
      box
        .copy(el.object3D._batchLocalBbox)
        .applyMatrix4(el.object3D.matrixWorld);
    }
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return;
    const half = COLLIDER_SHRINK / 2;
    physics.addStaticCuboid(
      { x: center.x, y: center.y, z: center.z },
      { x: size.x * half, y: size.y * half, z: size.z * half },
      undefined,
      'obstacle'
    );
  };

  sceneEl.querySelectorAll('[mixin]').forEach((el) => {
    if (!isCandidate(el)) return;
    add(el);
    const onLoaded = () => add(el);
    el.addEventListener('model-loaded', onLoaded);
    listeners.push({ el, fn: onLoaded });
  });

  return listeners;
}

module.exports = { seedSegmentColliders, seedObstacleColliders };
