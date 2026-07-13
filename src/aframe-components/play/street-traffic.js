/* global AFRAME, THREE */
import {
  movingCastFilter,
  hideSegmentClones,
  releaseClones
} from './clone-visibility.js';

/**
 * street-traffic
 * ======================
 *
 * Scene-level play-mode subscriber that animates entities along each
 * lane of every `[managed-street][playable]` in the scene.
 *
 * v1 design (intentionally simple, deterministic):
 *
 *   - Pure function of scene-time. Each entity's position is computed
 *     from `(scene-timer.elapsed, lane_index, slot_index)` with no
 *     stored per-entity state. Two viewers of the same scene at the
 *     same scene-time see traffic in identical positions.
 *
 *   - Uniform speed within a lane (no overtake, no pass-through).
 *     Different speed across lane types (car > bus > bike > pedestrian).
 *
 *   - Visual-only. No Rapier colliders, no interaction with the
 *     player chassis. If the player drives into traffic, they pass
 *     through. Kinematic-collider coupling is deferred to v1.5 — see
 *     play-mode-notes.md.
 *
 *   - One loop per lane: entities are evenly spaced and wrap around
 *     the segment's length axis. Coprime per-lane periods (different
 *     speed × different lane length) hide the repetition for the
 *     human-eye timescale most users will spend looking.
 *
 *   - Segment-local coordinates (matches street-generated-*): X is
 *     width, Z is length, Z range is [-L/2, L/2]. Direction 'inbound'
 *     = +Z motion (rotation 0, model forward = +Z). 'outbound' = -Z
 *     motion (rotation 0 180 0).
 */

const SEGMENT_TRAFFIC_DEFAULTS = {
  // [speed m/s, default mixin id, default density (entities per 60m),
  //  kinematic collider half-extents in ENTITY-local frame
  //  (x=width, y=height, z=length, since catalog models are
  //  authored forward = +Z so length lies on z).]
  'drive-lane': {
    speed: 11.2,
    mixin: 'sedan-rig',
    density: 2,
    half: { x: 0.9, y: 0.75, z: 2.25 } // 1.8 W × 1.5 H × 4.5 L
  },
  'bus-lane': {
    speed: 9.0,
    mixin: 'bus',
    density: 1,
    half: { x: 1.25, y: 1.5, z: 6.0 } // 2.5 W × 3.0 H × 12 L
  },
  'bike-lane': {
    speed: 6.0,
    mixin: 'cyclist1',
    density: 3,
    half: { x: 0.25, y: 0.85, z: 0.85 } // 0.5 W × 1.7 H × 1.7 L
  },
  sidewalk: {
    speed: 1.4,
    mixin: 'char1',
    density: 6,
    half: { x: 0.25, y: 0.85, z: 0.25 } // 0.5 W × 1.7 H × 0.5 L
  }
  // parking-lane intentionally absent: parked cars are static.
  // divider/grass/rail/building: no traffic.
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
    streets.forEach((streetEl) => {
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
      this.spawnForStreet(streetEl);
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

  spawnForStreet: function (streetEl) {
    // Each direct street-segment child is a lane. Spawn evenly-spaced
    // entities along its length axis (segment-local Z).
    streetEl.querySelectorAll(':scope > [street-segment]').forEach((segEl) => {
      const seg = segEl.getAttribute('street-segment');
      if (!seg) return;
      const defaults = SEGMENT_TRAFFIC_DEFAULTS[seg.type];
      if (!defaults) return; // unsupported lane type

      // Only animate a sidewalk if the user actually configured
      // pedestrians on it: look for any `street-generated-pedestrians__N`
      // component with density != 'empty'. If none, leave this sidewalk
      // alone entirely (don't hide, don't spawn).
      if (seg.type === 'sidewalk') {
        const pedComponents = Object.keys(segEl.components || {}).filter((n) =>
          n.startsWith('street-generated-pedestrians')
        );
        const hasPedestrians = pedComponents.some((n) => {
          const d = segEl.components[n]?.data?.density;
          return d && d !== 'empty';
        });
        if (!hasPedestrians) {
          console.log(
            '[street-traffic] skipping sidewalk segment without pedestrian density'
          );
          return;
        }
      }

      // Hide the static moving-cast clones this lane type replaces with
      // animated ones (shared rule + refcounted registry — see
      // clone-visibility.js). Stencils / striping / props stay visible.
      const hideFilter = movingCastFilter(seg.type);
      if (hideFilter) {
        this.hidden.push(...hideSegmentClones(segEl, hideFilter));
      }

      // Determine direction sign on segment-local Z. 'inbound' moves
      // toward +Z, 'outbound' toward -Z. 'none' (sidewalks set to none)
      // defaults to inbound so a v1 sidewalk still animates; we vary
      // by spawning a mix of both directions below.
      const length = seg.length || 60;
      const halfLen = length / 2;

      // Density scales with length so a 30m segment doesn't get the
      // same crowd as a 120m one. Minimum 1 to ensure something shows.
      const N = Math.max(1, Math.round((defaults.density * length) / 60));

      const directions = [];
      if (seg.direction === 'none') {
        // Split evenly between inbound/outbound for a "people on
        // sidewalk going both ways" look.
        for (let i = 0; i < N; i++) directions.push(i % 2 === 0 ? 1 : -1);
      } else {
        const dir = seg.direction === 'outbound' ? -1 : 1;
        for (let i = 0; i < N; i++) directions.push(dir);
      }

      for (let i = 0; i < N; i++) {
        const dir = directions[i];
        // Even spacing along [-L/2, L/2]. Offset half a slot so the
        // first entity doesn't sit exactly on the lane endpoint.
        const startZ = -halfLen + ((i + 0.5) * length) / N;

        const entity = document.createElement('a-entity');
        entity.setAttribute('mixin', defaults.mixin);
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
        // Catalog models are authored forward = +Z. inbound (dir=+1)
        // keeps default rotation; outbound (dir=-1) flips 180° so the
        // mesh faces the direction it's moving.
        if (dir === -1) entity.setAttribute('rotation', '0 180 0');
        // X stays at 0 (segment-local center). The segment itself is
        // positioned at the right lateral offset by managed-street.
        entity.object3D.position.set(0, 0, startZ);
        segEl.appendChild(entity);

        this.records.push({
          el: entity,
          segmentEl: segEl,
          speed: defaults.speed,
          startZ,
          halfLen,
          length,
          dir,
          half: defaults.half,
          body: null
        });
      }
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
