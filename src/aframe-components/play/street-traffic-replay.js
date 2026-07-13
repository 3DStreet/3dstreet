/* global AFRAME */
import {
  movingCastFilter,
  hideSegmentClones,
  releaseClones
} from './clone-visibility.js';

/**
 * street-traffic-replay
 * =====================
 *
 * Standalone "Traffic Replay" layer that REPLAYS real roadside-sensor data as
 * animated street users, instead of the synthetic flow that `street-traffic`
 * spawns. It lives on its OWN entity (its own scene-graph layer with a custom
 * sidebar) and animates onto a linked `[managed-street]`'s lanes during play
 * mode. The link is the `target` property (a managed-street entity id; empty =
 * the first managed-street in the scene).
 *
 * It consumes an anonymized "replay manifest" (see
 * scripts/tmd-replay/README.md and tmd-to-replay.mjs) of the shape:
 *
 *   {
 *     meta: { speedUnit, window: { durationSec }, countsByMode, ... },
 *     agents: [ { t, mode, dir, speed, dur }, ... ]   // sorted by t
 *   }
 *
 *   t      seconds since the capture window began (relative, not wall-clock)
 *   mode   person | bicycle | car | motorcycle | bus | dog
 *   dir    'inbound' | 'outbound'
 *   speed  |radar speed| in mph (or null -> a per-mode default is used)
 *   dur    seconds the user was in the detection zone (unused for motion; kept
 *          as an anonymized fallback signal)
 *
 * Design (mirrors street-traffic so the two are interchangeable):
 *
 *   - Driven by `scene-timer.simulationTime`, so playback is deterministic and
 *     cross-machine consistent at the same sim-time. `timeScale` multiplies
 *     sim-time into manifest-time: 1 = real time, 60 = a minute per second.
 *
 *   - Each manifest agent is a discrete trip: it spawns at one end of the
 *     matching lane when manifest-time passes its `t`, travels the length of
 *     the street at its (clamped, mode-plausible) speed, then despawns. Peak
 *     concurrency for a real capture hour is a few dozen entities.
 *
 *   - Anonymized by construction: the only thing a viewer can read off an
 *     agent is its mode (which model it is). No identity, no source timestamp.
 *
 *   - Segment-local coordinates (matches street-generated-* and
 *     street-traffic): X is width, Z is length, Z range is [-L/2, L/2].
 *     'inbound' = +Z motion (model forward = +Z, rotation 0), 'outbound' = -Z
 *     motion (rotation 0 180 0).
 *
 *   - Visual-only (no Rapier bodies). The point is to watch and tally flow,
 *     not to drive into it. Kinematic coupling could be added later the same
 *     way street-traffic does it.
 *
 * Usage: created by the "Traffic Replay" Add Layer card, configured in its
 * sidebar. Carries an inline (persistable) manifest:
 *   street-traffic-replay="manifestData: <stringified manifest JSON>; target: <street-id>"
 * or a URL: street-traffic-replay="manifestUrl: /path/replay.json".
 * `manifestData` survives scene save/load the same way managed-street's
 * `json-blob` does. While a replay owns its target street, `street-traffic`
 * skips that street's synthetic flow (see its onPlayStart guard).
 */

// Per-mode rendering rules. Speeds are mph (matching the manifest's speedUnit).
// `clamp` keeps radar outliers plausible (e.g. a "person" radar-tagged at
// 25 mph is a co-incident vehicle reading — we cap it to a brisk pace).
// `lanes` lists candidate segment types in priority order; the first type that
// exists on the street is used. `mixins` are catalog ids; one is chosen per
// agent (varied by index) for visual variety.
const MODE_RULES = {
  person: {
    lanes: ['sidewalk'],
    mixins: ['char1', 'char2', 'char3', 'char4', 'char6', 'char8'],
    defaultSpeed: 3,
    clamp: [1, 8]
  },
  bicycle: {
    lanes: ['bike-lane', 'drive-lane'],
    mixins: ['cyclist1', 'cyclist2', 'cyclist3', 'cyclist-dutch'],
    defaultSpeed: 10,
    clamp: [3, 22]
  },
  car: {
    lanes: ['drive-lane'],
    mixins: ['sedan-rig', 'suv-rig', 'sp-hatchback-yellow'],
    defaultSpeed: 25,
    clamp: [5, 45]
  },
  motorcycle: {
    lanes: ['drive-lane', 'bus-lane'],
    mixins: ['motorbike'],
    defaultSpeed: 28,
    clamp: [5, 45]
  },
  bus: {
    lanes: ['bus-lane', 'drive-lane'],
    mixins: ['bus'],
    defaultSpeed: 18,
    clamp: [5, 35]
  },
  dog: {
    lanes: ['sidewalk'],
    mixins: ['char1'],
    defaultSpeed: 5,
    clamp: [2, 12]
  }
};

const MPH_TO_MS = 0.44704;
const EXIT_MARGIN = 1.5; // metres past the lane end before we despawn

AFRAME.registerComponent('street-traffic-replay', {
  schema: {
    // Inline anonymized manifest JSON (stringified). This is the persistable
    // source: it survives scene save/load just like managed-street's json-blob.
    // (Deliberately NOT named `src` — json-utils strips `src` on save.)
    manifestData: { type: 'string', default: '' },
    // Alternative: fetch the manifest from a URL instead of inlining it.
    manifestUrl: { type: 'string', default: '' },
    // Id of the managed-street entity to animate onto. Empty = auto (the first
    // managed-street in the scene). Set from the Traffic Replay sidebar.
    target: { type: 'string', default: '' },
    // sim-seconds -> manifest-seconds. 1 = real time.
    timeScale: { type: 'number', default: 1 },
    // Restart from t=0 when the manifest is exhausted.
    loop: { type: 'boolean', default: true },
    // Suppress synthetic street-traffic on this street while a replay is active.
    suppressSyntheticTraffic: { type: 'boolean', default: true }
  },

  init: function () {
    this.onPlayStart = this.onPlayStart.bind(this);
    this.onPlayStop = this.onPlayStop.bind(this);
    this.onPlayReset = this.onPlayReset.bind(this);
    // play-mode events fire on the scene (bubbles off), so subscribe there.
    this.el.sceneEl.addEventListener('play-mode-start', this.onPlayStart);
    this.el.sceneEl.addEventListener('play-mode-stop', this.onPlayStop);
    this.el.sceneEl.addEventListener('play-mode-reset', this.onPlayReset);
    // Playable capability: a replay layer with a usable manifest and a
    // street to animate onto lights up the Play UI on its own — the
    // target street doesn't need the synthetic-traffic playable flag.
    // The check is scene-wide (not per-instance), so re-registering from
    // each replay layer is idempotent and removing one layer leaves the
    // check accurate for the rest.
    const sceneEl = this.el.sceneEl;
    const mgr = sceneEl.systems['mode-manager'];
    if (mgr) {
      mgr.registerPlayableCheck('street-traffic-replay', () =>
        Array.from(sceneEl.querySelectorAll('[street-traffic-replay]')).some(
          (el) => {
            const c = el.components['street-traffic-replay'];
            return !!(c && c.hasAgents() && c.resolveStreet());
          }
        )
      );
    }

    this.manifest = null; // parsed manifest
    this.duration = 0; // manifest length in seconds
    this.records = []; // live agents: { el, dirSign, speedMS, startZ, halfLen, spawnTRel }
    this.hidden = []; // clones we hold hidden in the shared registry (clone-visibility.js)
    this.active = false;
    this.nextIdx = 0; // next manifest agent to spawn
    this.cycleBase = 0; // manifest-time at the start of the current loop
    this.cumulative = {}; // mode -> count spawned this cycle
    this._lastStatsEmit = 0;

    this.loadFromData();
  },

  update: function (oldData) {
    if (
      this.data.manifestData !== oldData.manifestData ||
      this.data.manifestUrl !== oldData.manifestUrl
    ) {
      this.loadFromData();
    }
  },

  remove: function () {
    this.el.sceneEl.removeEventListener('play-mode-start', this.onPlayStart);
    this.el.sceneEl.removeEventListener('play-mode-stop', this.onPlayStop);
    this.el.sceneEl.removeEventListener('play-mode-reset', this.onPlayReset);
    this.teardown();
  },

  // True once a usable manifest is parsed. street-traffic checks this to know a
  // replay owns its target street's traffic and skips that synthetic flow.
  hasAgents: function () {
    return !!(this.manifest && this.manifest.agents.length);
  },

  // The managed-street this replay animates onto: the `target` entity when set
  // and valid, otherwise the first managed-street in the scene.
  resolveStreet: function () {
    const id = this.data.target;
    if (id) {
      const el = document.getElementById(id);
      if (el && el.components && el.components['managed-street']) return el;
    }
    return this.el.sceneEl.querySelector('[managed-street]');
  },

  loadFromData: function () {
    if (this.data.manifestData) {
      try {
        this.setManifest(JSON.parse(this.data.manifestData));
      } catch (err) {
        console.error('[street-traffic-replay] bad manifestData JSON', err);
      }
    } else if (this.data.manifestUrl) {
      fetch(this.data.manifestUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((m) => this.setManifest(m))
        .catch((err) =>
          console.error(
            '[street-traffic-replay] failed to fetch manifest',
            this.data.manifestUrl,
            err
          )
        );
    }
  },

  setManifest: function (m) {
    const agents = Array.isArray(m.agents) ? m.agents.slice() : [];
    agents.sort((a, b) => a.t - b.t);
    this.manifest = { meta: m.meta || {}, agents };
    const lastT = agents.length ? agents[agents.length - 1].t : 0;
    this.duration = (m.meta?.window?.durationSec || lastT) + 5;
    console.log(
      '[street-traffic-replay] loaded',
      agents.length,
      'agents,',
      Math.round(this.duration),
      's window,',
      JSON.stringify(m.meta?.countsByMode || {})
    );
  },

  onPlayStart: function () {
    if (!this.hasAgents()) {
      console.log('[street-traffic-replay] no manifest; nothing to replay');
      return;
    }
    const streetEl = this.resolveStreet();
    if (!streetEl) {
      console.warn(
        '[street-traffic-replay] no managed-street to replay onto (link one in the Traffic Replay panel)'
      );
      return;
    }
    this.indexLanes(streetEl);
    this.hideStaticClones(streetEl);

    this.nextIdx = 0;
    this.cycleBase = 0;
    this.cumulative = {};
    this.active = true;
    console.log(
      '[street-traffic-replay] start: replaying',
      this.manifest.agents.length,
      'agents at timeScale',
      this.data.timeScale
    );
  },

  // Hide the target street's static auto-generated vehicle/pedestrian clones
  // for the duration of the replay, so the recorded agents don't animate over
  // a frozen duplicate crowd. Shared rule + refcounted registry (see
  // clone-visibility.js) so street-traffic hiding the same clones on the same
  // street can't double-hide. Released in teardown().
  hideStaticClones: function (streetEl) {
    streetEl.querySelectorAll(':scope > [street-segment]').forEach((segEl) => {
      const seg = segEl.getAttribute('street-segment');
      if (!seg) return;
      const hideFilter = movingCastFilter(seg.type);
      if (!hideFilter) return; // no moving cast on this lane type
      this.hidden.push(...hideSegmentClones(segEl, hideFilter));
    });
  },

  // Build mode-lane lookup: laneType -> [{ el, length, halfLen }]. Direction
  // matching is best-effort at spawn time.
  indexLanes: function (streetEl) {
    this.lanesByType = {};
    streetEl.querySelectorAll(':scope > [street-segment]').forEach((segEl) => {
      const seg = segEl.getAttribute('street-segment');
      if (!seg) return;
      const length = seg.length || 60;
      (this.lanesByType[seg.type] = this.lanesByType[seg.type] || []).push({
        el: segEl,
        length,
        halfLen: length / 2,
        direction: seg.direction
      });
    });
  },

  // Find a lane segment for an agent, preferring one whose nominal direction
  // matches and falling back through the mode's candidate lane types.
  pickLane: function (rule, dir) {
    // Pass 1: a lane whose own direction matches the agent, honoring the
    // mode's lane-type priority order — an outbound cyclist on a street
    // with only an inbound bike-lane should fall through to an outbound
    // drive-lane, not ride against the bike lane.
    for (const type of rule.lanes) {
      const lanes = this.lanesByType[type];
      if (!lanes || !lanes.length) continue;
      const byDir = lanes.find((l) => l.direction === dir);
      if (byDir) return byDir;
    }
    // Pass 2: no directional match anywhere (e.g. sidewalks are 'none').
    // Split opposing flows so they don't pile onto one segment — inbound
    // takes the first lane of the highest-priority type present, outbound
    // the last (e.g. pedestrians use both sidewalks).
    for (const type of rule.lanes) {
      const lanes = this.lanesByType[type];
      if (!lanes || !lanes.length) continue;
      return dir === 'outbound' ? lanes[lanes.length - 1] : lanes[0];
    }
    // Last resort: any segment at all, so the agent still appears.
    for (const type in this.lanesByType) {
      const lanes = this.lanesByType[type];
      if (lanes && lanes.length) return lanes[0];
    }
    return null;
  },

  spawnAgent: function (agent) {
    const rule = MODE_RULES[agent.mode] || MODE_RULES.person;
    const lane = this.pickLane(rule, agent.dir);
    if (!lane) return;

    const dirSign = agent.dir === 'outbound' ? -1 : 1;
    let mph = typeof agent.speed === 'number' ? agent.speed : rule.defaultSpeed;
    mph = Math.min(Math.max(mph, rule.clamp[0]), rule.clamp[1]);
    const speedMS = mph * MPH_TO_MS;

    const mixin = rule.mixins[this.records.length % rule.mixins.length];
    const entity = document.createElement('a-entity');
    entity.setAttribute('mixin', mixin);
    entity.setAttribute('data-no-transform', '');
    entity.setAttribute('data-layer-name', 'Traffic Replay');
    // data-play-mode-traffic (attribute) = drive-mode collider-seeder selector;
    // play-mode-traffic (component) = exclude from the static mesh batcher so
    // the moving replay agent renders instead of freezing into a batch.
    entity.setAttribute('data-play-mode-traffic', '');
    entity.setAttribute('play-mode-traffic', '');
    entity.classList.add('autocreated');
    if (dirSign === -1) entity.setAttribute('rotation', '0 180 0');
    // Enter at the near end for the travel direction; X centred (lane offset
    // is applied by the segment itself).
    const startZ = -dirSign * lane.halfLen;
    entity.object3D.position.set(0, 0, startZ);
    lane.el.appendChild(entity);

    this.records.push({
      el: entity,
      dirSign,
      speedMS,
      startZ,
      halfLen: lane.halfLen,
      spawnTRel: agent.t
    });
    this.cumulative[agent.mode] = (this.cumulative[agent.mode] || 0) + 1;
  },

  tick: function () {
    if (!this.active) return;
    const timer = this.el.sceneEl.components['scene-timer'];
    if (!timer) return;

    const manifestTime =
      ((timer.simulationTime || 0) / 1000) * this.data.timeScale;
    let tRel = manifestTime - this.cycleBase;

    // Loop: once we're past the window and everything on-screen has cleared,
    // rewind to the top of the manifest.
    if (this.data.loop && tRel >= this.duration && this.records.length === 0) {
      this.cycleBase = manifestTime;
      this.nextIdx = 0;
      this.cumulative = {};
      tRel = 0;
    }

    // Spawn everything whose entry time has arrived this cycle.
    const agents = this.manifest.agents;
    while (this.nextIdx < agents.length && agents[this.nextIdx].t <= tRel) {
      this.spawnAgent(agents[this.nextIdx]);
      this.nextIdx++;
    }

    // Advance live agents; despawn once they pass the far lane end. Motion is a
    // pure function of tRel: at its own entry time the agent sits at startZ.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      const z = r.startZ + r.dirSign * r.speedMS * (tRel - r.spawnTRel);
      r.el.object3D.position.z = z;
      const past =
        r.dirSign === 1
          ? z > r.halfLen + EXIT_MARGIN
          : z < -r.halfLen - EXIT_MARGIN;
      if (past) {
        if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
        this.records.splice(i, 1);
      }
    }

    this.emitStats(timer.simulationTime || 0, tRel);
  },

  emitStats: function (simTime, tRel) {
    // Throttle to ~5 Hz; this drives any live analytics overlay.
    if (simTime - this._lastStatsEmit < 200) return;
    this._lastStatsEmit = simTime;
    let total = 0;
    for (const k in this.cumulative) total += this.cumulative[k];
    // Emit on the scene so a single overlay can aggregate every street's replay.
    this.el.sceneEl.emit('street-traffic-replay-stats', {
      street: this.el.id || null,
      manifestTime: tRel,
      cumulative: { ...this.cumulative },
      active: this.records.length,
      total
    });
  },

  onPlayStop: function () {
    this.teardown();
  },

  // Reset re-arms the replay to the top of the manifest without leaving play.
  // play-mode.reset() zeroes scene-timer.simulationTime, so every cycle/stat
  // counter derived from it must be zeroed too — otherwise tRel goes negative
  // (manifestTime 0 minus a stale cycleBase) and the replay freezes for as
  // long as the previous run lasted. No-op when a replay isn't running.
  onPlayReset: function () {
    if (!this.active) return;
    for (const r of this.records) {
      if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el);
    }
    this.records.length = 0;
    this.nextIdx = 0;
    this.cycleBase = 0;
    this.cumulative = {};
    this._lastStatsEmit = 0;
  },

  teardown: function () {
    for (const r of this.records) {
      if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el);
    }
    this.records.length = 0;
    // Release our hold on the hidden static clones; the registry restores
    // each one when its last holder (us or street-traffic) lets go.
    releaseClones(this.hidden);
    this.active = false;
  }
});
