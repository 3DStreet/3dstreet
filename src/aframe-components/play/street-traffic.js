/* global AFRAME, THREE */
import {
  movingCastFilter,
  hideSegmentClones,
  releaseClones
} from './clone-visibility.js';
import { createRNG } from '../../lib/rng';
import {
  varyLaneSpeed,
  directionFromFacing
} from '../../tested/street-traffic-utils';

/**
 * street-traffic
 * ======================
 *
 * Scene-level play-mode subscriber that animates entities along each
 * lane of every `[managed-street][playable]` in the scene.
 *
 * Design (deterministic, mirrors the edit-time cast — #1823 A):
 *
 *   - The animated cast IS the edit-time cast. On play-start each
 *     static moving-cast clone (street-generated-clones /
 *     street-generated-pedestrians child) is hidden and replaced by an
 *     animated twin with the identical mixin, position, and rotation,
 *     so the frozen frame the user was editing reads as t=0 of the
 *     animation: nothing pops in or out on Start, and model variety /
 *     spacing / lateral offsets come from the clones' own seeded
 *     layout instead of a synthetic uniform flow. A lane with no
 *     moving cast plays empty — removing the clones is how a user
 *     opts a lane out of traffic. (Wanting traffic on a bare lane is
 *     a segment-defaults question: give the segment clones.)
 *
 *   - Pure function of scene-time. Each entity's position is computed
 *     from `(scene-timer.simulationTime, its t=0 layout)` with no
 *     stored per-entity state, and all randomness is seeded from
 *     stable segment/entity indices. Two viewers of the same scene at
 *     the same scene-time see traffic in identical positions.
 *
 *   - Uniform speed within a vehicle/bike lane (no overtake, no
 *     pass-through), varied ±10% per lane so parallel lanes don't move
 *     in lockstep. Pedestrians get per-entity speed jitter (people
 *     passing each other on a sidewalk is normal).
 *
 *   - Visual-only unless drive-mode is active, in which case entities
 *     get kinematic Rapier colliders (see play-mode-notes.md).
 *
 *   - One loop per lane: entities keep their t=0 spacing and wrap
 *     around the segment's length axis.
 *
 *   - Segment-local coordinates (matches street-generated-*): X is
 *     width, Z is length, Z range is [-L/2, L/2]. Direction 'inbound'
 *     = +Z motion (rotation 0, model forward = +Z). 'outbound' = -Z
 *     motion (rotation 0 180 0).
 */

const SEGMENT_TRAFFIC_DEFAULTS = {
  // [speed m/s, kinematic collider half-extents in ENTITY-local frame
  //  (x=width, y=height, z=length, since catalog models are authored
  //  forward = +Z so length lies on z)]
  'drive-lane': {
    speed: 11.2,
    half: { x: 0.9, y: 0.75, z: 2.25 } // 1.8 W × 1.5 H × 4.5 L
  },
  'bus-lane': {
    speed: 9.0,
    half: { x: 1.25, y: 1.5, z: 6.0 } // 2.5 W × 3.0 H × 12 L
  },
  'bike-lane': {
    speed: 6.0,
    half: { x: 0.25, y: 0.85, z: 0.85 } // 0.5 W × 1.7 H × 1.7 L
  },
  sidewalk: {
    speed: 1.4,
    half: { x: 0.25, y: 0.85, z: 0.25 } // 0.5 W × 1.7 H × 0.5 L
  },
  rail: {
    speed: 8.0,
    half: { x: 1.25, y: 1.75, z: 11.5 } // 2.5 W × 3.5 H × 23 L
  }
  // parking-lane intentionally absent: parked cars are static.
  // divider/grass/boundary: no traffic.
};

// Kinematic collider half-extents for known moving-cast mixins; anything
// not listed falls back to its lane type's `half` above. Same entity-local
// frame (x=width, y=height, z=length).
const MIXIN_HALF_EXTENTS = {
  'sedan-rig': { x: 0.9, y: 0.75, z: 2.25 },
  'suv-rig': { x: 0.95, y: 0.9, z: 2.4 },
  'box-truck-rig': { x: 1.1, y: 1.4, z: 3.6 },
  'self-driving-waymo-car': { x: 0.95, y: 0.9, z: 2.4 },
  motorbike: { x: 0.4, y: 0.8, z: 1.1 },
  bus: { x: 1.25, y: 1.5, z: 6.0 },
  tram: { x: 1.25, y: 1.75, z: 11.5 },
  trolley: { x: 1.25, y: 1.75, z: 5.25 }
};

// Marker component put on every animated traffic / replay entity. Beyond being
// a stable selector, it is deliberately NOT in batch-models' safe-component
// allowlist (SAFE_COMPONENTS_BY_KIND), so its presence makes getBlockingComponents
// return non-empty and the entity is excluded from the static BatchedMesh.
// Without it, a traffic entity carrying only its mixin's gltf-part/gltf-model is
// batch-eligible: it gets folded into a static batch and its own mesh is stripped,
// so moving object3D.position each tick moves only the (separately-synced)
// kinematic collider — you can collide with the car/pedestrian but never see it
// where it moves. A no-op component is enough; batch exclusion is the whole point.
if (!AFRAME.components['play-mode-traffic']) {
  AFRAME.registerComponent('play-mode-traffic', {});
}

AFRAME.registerComponent('street-traffic', {
  init: function () {
    this.onPlayStart = this.onPlayStart.bind(this);
    this.onPlayStop = this.onPlayStop.bind(this);
    this.el.addEventListener('play-mode-start', this.onPlayStart);
    this.el.addEventListener('play-mode-stop', this.onPlayStop);
    // Playable capability: the Play UI lights up when any
    // managed-street opts into traffic animation.
    const mgr = this.el.sceneEl.systems['mode-manager'];
    if (mgr) {
      mgr.registerPlayableCheck('street-traffic', () =>
        Array.from(this.el.querySelectorAll('[managed-street]')).some(
          (s) => s.components?.['managed-street']?.data?.playable
        )
      );
    }

    // Per-spawned-entity records: { el, segmentEl, speed, startZ, halfLen, dir }
    this.records = [];
    // Pre-existing auto-generated clones we hid on play-start, held as
    // refcounted entries in the shared clone-visibility registry so a
    // concurrent replay layer hiding the same clones can't double-hide.
    this.hidden = [];
    this.active = false;
  },

  remove: function () {
    this.el.removeEventListener('play-mode-start', this.onPlayStart);
    this.el.removeEventListener('play-mode-stop', this.onPlayStop);
    const mgr = this.el.sceneEl.systems['mode-manager'];
    if (mgr) mgr.registerPlayableCheck('street-traffic', () => false);
    this.teardown();
  },

  onPlayStart: function () {
    const streets = this.el.querySelectorAll('[managed-street]');

    // Streets owned by a street-traffic-replay layer (real-data replay) skip
    // synthetic flow. Replays are their own entities now, so resolve which
    // street each one targets.
    const replayed = new Set();
    this.el.querySelectorAll('[street-traffic-replay]').forEach((el) => {
      const c = el.components?.['street-traffic-replay'];
      if (c?.data?.suppressSyntheticTraffic && c.hasAgents?.()) {
        const s = c.resolveStreet?.();
        if (s) replayed.add(s);
      }
    });

    let playableCount = 0;
    streets.forEach((streetEl, streetIndex) => {
      const ms = streetEl.components?.['managed-street']?.data;
      if (!ms || !ms.playable) return;
      if (replayed.has(streetEl)) {
        console.log(
          '[street-traffic] skipping street with active replay',
          streetEl.id || ''
        );
        return;
      }
      playableCount++;
      this.spawnForStreet(streetEl, streetIndex);
    });
    this.active = this.records.length > 0;

    // If drive-mode is also up (driveable vehicle present), give the
    // animated entities kinematic Rapier bodies so the player can
    // collide with them. Otherwise leave them visual-only — no point
    // loading Rapier WASM just to watch traffic.
    const wantsPhysics = !!this.el.querySelector('[drive-controls]');
    if (wantsPhysics) {
      const physics = this.el.systems['play-mode-physics'];
      physics?.activate()?.then(() => this.createKinematicBodies());
    }

    console.log(
      '[street-traffic] start:',
      streets.length,
      'managed-streets found,',
      playableCount,
      'playable, spawned',
      this.records.length,
      'animated entities, hid',
      this.hidden.length,
      'static, kinematic-physics=',
      wantsPhysics
    );
  },

  createKinematicBodies: function () {
    const physics = this.el.systems['play-mode-physics'];
    if (!physics?.active) return;
    const wp = new THREE.Vector3();
    let n = 0;
    for (const r of this.records) {
      if (r.body) continue;
      r.el.object3D.updateMatrixWorld();
      r.el.object3D.getWorldPosition(wp);
      r.body = physics.addKinematicCuboid(
        { x: wp.x, y: wp.y, z: wp.z },
        r.half,
        'traffic'
      );
      if (r.body) n++;
    }
    console.log('[street-traffic] created', n, 'kinematic bodies');
  },

  onPlayStop: function () {
    this.teardown();
  },

  teardown: function () {
    for (const r of this.records) {
      if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el);
    }
    console.log(
      '[street-traffic] stop: removed',
      this.records.length,
      'animated entities, released',
      this.hidden.length,
      'static'
    );
    this.records.length = 0;
    // Release our hold on the hidden static clones; the registry
    // restores each one when its last holder (us or a replay layer)
    // lets go.
    releaseClones(this.hidden);
    this.active = false;
  },

  spawnForStreet: function (streetEl, streetIndex) {
    // Each direct street-segment child is a lane.
    const segments = streetEl.querySelectorAll(':scope > [street-segment]');
    segments.forEach((segEl, segIndex) => {
      const seg = segEl.getAttribute('street-segment');
      if (!seg) return;
      const defaults = SEGMENT_TRAFFIC_DEFAULTS[seg.type];
      if (!defaults) return; // unsupported lane type

      // A vehicle lane with no travel direction (e.g. a center turn
      // lane) has no traffic flow: leave its authored cast static and
      // synthesize nothing. Sidewalks are direction 'none' by design —
      // pedestrians infer their walk direction from each clone's own
      // facing instead.
      if (seg.type !== 'sidewalk' && seg.direction === 'none') return;

      const length = seg.length || 60;
      const halfLen = length / 2;

      // Seeded rng keyed on (street index, segment index): speed jitter
      // is deterministic so two viewers at the same sim-time agree,
      // while identical lane layouts on different streets (parallel
      // streets in a grid) still decorrelate.
      const rng = createRNG((streetIndex || 0) * 1000 + segIndex + 1);
      // Vehicle/bike lanes stay uniform-speed within the lane (no
      // pass-through) but vary ±10% across lanes so parallel lanes
      // don't move in lockstep.
      const laneSpeed = varyLaneSpeed(defaults.speed, rng);

      // Hide the edit-time moving cast via the shared refcounted
      // registry, snapshotting each clone's pose in the same DOM walk
      // (see clone-visibility.js). Stencils / striping / props stay
      // visible.
      const hideFilter = movingCastFilter(seg.type);
      const cast = [];
      if (hideFilter) {
        this.hidden.push(
          ...hideSegmentClones(segEl, hideFilter, (el, compName) => {
            const position = el.getAttribute('position') || {
              x: 0,
              y: 0,
              z: 0
            };
            cast.push({
              mixin: el.getAttribute('mixin') || '',
              position: { x: position.x, y: position.y, z: position.z },
              rotationY: el.getAttribute('rotation').y,
              isPedestrian: compName.startsWith('street-generated-pedestrians')
            });
          })
        );
      }

      // No moving cast on this lane → it plays empty. Removing the
      // clones is the user's way of opting a lane out of traffic;
      // nothing is synthesized to fill the gap (static props like a
      // parked food trailer or cones were excluded from `cast` by
      // movingCastFilter and stay visible). Wanting traffic on a bare
      // lane means giving the segment clones, not play-time invention.
      if (cast.length === 0) return;

      // Mirror path (#1823 A): every hidden static clone becomes an
      // animated twin with the identical mixin/pose, so the frame the
      // user was editing is exactly t=0 of the animation and the
      // lane keeps its authored variety and spacing.
      for (const member of cast) {
        // Motion sign on segment-local Z. Directed lanes move as the
        // segment says; 'none' (sidewalks) infers per-entity from the
        // clone's own facing (0° faces +Z, 180° faces -Z).
        let dir;
        if (seg.direction === 'inbound') dir = 1;
        else if (seg.direction === 'outbound') dir = -1;
        else dir = directionFromFacing(member.rotationY);
        const speed = member.isPedestrian
          ? SEGMENT_TRAFFIC_DEFAULTS.sidewalk.speed * (0.7 + 0.6 * rng())
          : laneSpeed;
        // A pedestrian authored on a vehicle lane (e.g. a crossing)
        // must not inherit the lane's car-sized collider.
        const fallbackHalf = member.isPedestrian
          ? SEGMENT_TRAFFIC_DEFAULTS.sidewalk.half
          : defaults.half;
        this.spawnRecord(segEl, {
          mixin: member.mixin,
          position: member.position,
          rotationY: member.rotationY,
          dir,
          speed,
          halfLen,
          length,
          half: MIXIN_HALF_EXTENTS[member.mixin] || fallbackHalf
        });
      }
    });
  },

  spawnRecord: function (segEl, opts) {
    const entity = document.createElement('a-entity');
    entity.setAttribute('mixin', opts.mixin);
    entity.setAttribute('data-no-transform', '');
    entity.setAttribute('data-layer-name', 'Traffic');
    // Mark as animated traffic. Two markers with two jobs:
    //  - data-play-mode-traffic (attribute): drive-mode's static-collider
    //    seeder selector — skip us, we get kinematic colliders instead.
    //  - play-mode-traffic (component): excludes us from the static mesh
    //    batcher (it's outside batch-models' safe-component set), so the
    //    moving mesh renders instead of being folded into a frozen batch.
    entity.setAttribute('data-play-mode-traffic', '');
    entity.setAttribute('play-mode-traffic', '');
    entity.classList.add('autocreated');
    // Object form skips A-Frame's string parse on set.
    entity.setAttribute('rotation', { x: 0, y: opts.rotationY, z: 0 });
    // Full t=0 pose: X (lateral offset within the lane) and Y come from
    // the mirrored clone; tick only ever advances Z.
    entity.setAttribute('position', {
      x: opts.position.x,
      y: opts.position.y,
      z: opts.position.z
    });
    segEl.appendChild(entity);

    this.records.push({
      el: entity,
      segmentEl: segEl,
      speed: opts.speed,
      startZ: opts.position.z,
      halfLen: opts.halfLen,
      length: opts.length,
      dir: opts.dir,
      half: opts.half,
      body: null
    });
  },

  tick: function () {
    if (!this.active) return;
    const timer = this.el.components['scene-timer'];
    if (!timer) return;
    // simulationTime is the passive counter advanced by physics (per
    // sub-step) or by play-mode (per rAF tick when no physics).
    // Using it instead of elapsedTime gives slow-motion behavior on
    // weak CPUs and cross-machine determinism at the same sim-time.
    const t = (timer.simulationTime || 0) / 1000;
    const wp = this._wp || (this._wp = new THREE.Vector3());
    const wq = this._wq || (this._wq = new THREE.Quaternion());
    const ws = this._ws || (this._ws = new THREE.Vector3());
    // Pre-allocated plain-object scratches reused for every kinematic
    // setNext* call below. Without this we churned ~3,700 short-lived
    // {x,y,z}/{x,y,z,w} object literals per second (31 traffic entities
    // × 60 fps × 2 calls), which the major-GC trace caught: heap grew
    // ~3 MB/sec and produced visible stutter every few seconds.
    const posOut = this._posOut || (this._posOut = { x: 0, y: 0, z: 0 });
    const rotOut = this._rotOut || (this._rotOut = { x: 0, y: 0, z: 0, w: 1 });
    for (const r of this.records) {
      // Pure function: z(t) = wrap(startZ + dir * speed * t, [-half, +half])
      const span = r.length;
      let z = r.startZ + r.dir * r.speed * t;
      // Wrap into [-half, +half] regardless of sign.
      z = ((((z + r.halfLen) % span) + span) % span) - r.halfLen;
      r.el.object3D.position.z = z;

      // Kinematic body sync (only if drive-mode is active and the
      // body has been created). setNext* gives Rapier the future
      // pose so the solver can compute a proper velocity for the
      // dynamic player chassis to bounce off.
      if (r.body && r.el.object3D.parent) {
        // One local-matrix compose + decompose per record instead of
        // three full ancestor-chain recomposes (updateMatrixWorld +
        // getWorldPosition + getWorldQuaternion each re-walk every
        // ancestor). The parent chain (segment/street) is static during
        // play, so its matrixWorld — kept fresh by the render loop —
        // can be composed against directly.
        const obj = r.el.object3D;
        obj.updateMatrix();
        obj.matrixWorld.multiplyMatrices(obj.parent.matrixWorld, obj.matrix);
        obj.matrixWorld.decompose(wp, wq, ws);
        posOut.x = wp.x;
        posOut.y = wp.y;
        posOut.z = wp.z;
        r.body.setNextKinematicTranslation(posOut);
        rotOut.x = wq.x;
        rotOut.y = wq.y;
        rotOut.z = wq.z;
        rotOut.w = wq.w;
        r.body.setNextKinematicRotation(rotOut);
      }
    }
  }
});
