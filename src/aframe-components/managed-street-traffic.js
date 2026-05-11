/* global AFRAME */

/**
 * managed-street-traffic
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
  // [speed m/s, default mixin id, default density (entities per 60m)]
  'drive-lane': { speed: 11.2, mixin: 'sedan-rig', density: 2 },
  'bus-lane': { speed: 9.0, mixin: 'bus', density: 1 },
  'bike-lane': { speed: 6.0, mixin: 'cyclist1', density: 3 },
  sidewalk: { speed: 1.4, mixin: 'char1', density: 6 }
  // parking-lane intentionally absent: parked cars are static.
  // divider/grass/rail/building: no traffic.
};

AFRAME.registerComponent('managed-street-traffic', {
  init: function () {
    this.onPlayStart = this.onPlayStart.bind(this);
    this.onPlayStop = this.onPlayStop.bind(this);
    this.el.addEventListener('play-mode-start', this.onPlayStart);
    this.el.addEventListener('play-mode-stop', this.onPlayStop);

    // Per-spawned-entity records: { el, segmentEl, speed, startZ, halfLen, dir }
    this.records = [];
    // Pre-existing auto-generated entities we hid on play-start so we
    // can restore them on play-stop. [{ el, wasVisible }]
    this.hidden = [];
    this.active = false;
  },

  remove: function () {
    this.el.removeEventListener('play-mode-start', this.onPlayStart);
    this.el.removeEventListener('play-mode-stop', this.onPlayStop);
    this.teardown();
  },

  onPlayStart: function () {
    const streets = this.el.querySelectorAll('[managed-street]');
    let playableCount = 0;
    streets.forEach((streetEl) => {
      const ms = streetEl.components?.['managed-street']?.data;
      if (!ms || !ms.playable) return;
      playableCount++;
      this.spawnForStreet(streetEl);
    });
    this.active = this.records.length > 0;
    console.log(
      '[managed-street-traffic] start:',
      streets.length,
      'managed-streets found,',
      playableCount,
      'playable, spawned',
      this.records.length,
      'animated entities, hid',
      this.hidden.length,
      'static'
    );
  },

  onPlayStop: function () {
    this.teardown();
  },

  teardown: function () {
    for (const r of this.records) {
      if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el);
    }
    // Restore any static auto-generated entities we hid on play-start.
    for (const h of this.hidden) {
      if (h.el?.object3D) h.el.object3D.visible = h.wasVisible;
    }
    console.log(
      '[managed-street-traffic] stop: removed',
      this.records.length,
      'animated entities, restored',
      this.hidden.length,
      'static'
    );
    this.records.length = 0;
    this.hidden.length = 0;
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

      // Per-type rules for which existing children to hide and whether
      // to animate at all. Sidewalks specifically must not hide trees,
      // poles, benches (those come from street-generated-clones, not
      // street-generated-pedestrians) — only the static pedestrian
      // clones get hidden. And we only animate a sidewalk if the user
      // actually configured pedestrians on it.
      let hideFilter; // (componentName) => boolean
      if (seg.type === 'sidewalk') {
        // Look for any `street-generated-pedestrians__N` component on
        // the segment with density != 'empty'. If none, leave this
        // sidewalk alone entirely (don't hide, don't spawn).
        const pedComponents = Object.keys(segEl.components || {}).filter((n) =>
          n.startsWith('street-generated-pedestrians')
        );
        const hasPedestrians = pedComponents.some((n) => {
          const d = segEl.components[n]?.data?.density;
          return d && d !== 'empty';
        });
        if (!hasPedestrians) {
          console.log(
            '[managed-street-traffic] skipping sidewalk segment without pedestrian density'
          );
          return;
        }
        hideFilter = (compName) =>
          compName.startsWith('street-generated-pedestrians');
      } else {
        // drive-lane / bus-lane / bike-lane: legacy v1 behavior, hide
        // every procedural child on the segment. TODO: tighten this
        // the same way we did for sidewalks once we have a reliable
        // signal for "this entity is a static vehicle vs. street prop".
        hideFilter = () => true;
      }

      segEl.querySelectorAll('[data-parent-component]').forEach((existing) => {
        const compName = existing.getAttribute('data-parent-component') || '';
        if (!hideFilter(compName)) return;
        this.hidden.push({
          el: existing,
          wasVisible: existing.object3D?.visible ?? true
        });
        if (existing.object3D) existing.object3D.visible = false;
      });

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
          dir
        });
      }
    });
  },

  tick: function () {
    if (!this.active) return;
    const timer = this.el.components['scene-timer'];
    if (!timer) return;
    // scene-timer stores elapsedTime in MILLISECONDS.
    const t = (timer.elapsedTime || 0) / 1000;
    for (const r of this.records) {
      // Pure function: z(t) = wrap(startZ + dir * speed * t, [-half, +half])
      const span = r.length;
      let z = r.startZ + r.dir * r.speed * t;
      // Wrap into [-half, +half] regardless of sign.
      z = ((((z + r.halfLen) % span) + span) % span) - r.halfLen;
      r.el.object3D.position.z = z;
    }
  }
});
