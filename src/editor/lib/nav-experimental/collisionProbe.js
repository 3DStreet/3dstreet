/* global THREE */

import { isSolidFloorHit, worldHitNormal } from './cursorAnchor.js';

// Downward direction for the AGL ground probe. Module-level frozen constant so
// the per-frame floor probes never allocate per call. `Raycaster.set` copies it
// into `ray.direction`, so a shared read-only vector is safe.
const GROUND_PROBE_DIR = Object.freeze(new THREE.Vector3(0, -1, 0));

// Collision-floor probing for the experimental nav controls. Answers "what solid
// surface is directly below this XZ column?" (ground OR building roof OR tiles;
// scatter excluded) for the descent clamp, swoop, orbit clamp, WASD destination,
// and enclosure floor.
//
// Stateful: it carries `_lastGroundY`, the last-known ground height held through
// probe misses so the inferred ground stays continuous as the camera crosses a
// scene edge. A miss returns that cache with source 'cache'. Only a HIT with
// `refreshCache` set updates it — a clearance/standoff probe over a column the
// camera never visits must pass `refreshCache:false` so it does not poison the
// next recovery/WASD miss fallback. That asymmetry is load-bearing; preserve it.
//
// Reads the live camera/scene through the shared controls context, and carries
// its own scratch + raycaster so a probe never aliases another gesture's scratch.
export class CollisionProbe {
  constructor(ctx) {
    this._ctx = ctx;
    this._lastGroundY = 0;
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
  }

  // Downward floor probe at an arbitrary XZ column. Returns
  // { y, normal, source, hit }. Casts from `fromY` (default = the live camera y)
  // and uses the same y as the floor ceiling, so a teleport endpoint validated
  // under an overpass finds the lane below it, not the deck the high camera
  // would probe through. `acceptBuildings`/`acceptTiles` default true.
  floorYBelowAt(x, z, opts = {}) {
    const camera = this._ctx.camera;
    const sceneEl = this._ctx.sceneEl;
    const acceptBuildings = opts.acceptBuildings !== false;
    const acceptTiles = opts.acceptTiles !== false;
    const fromY = opts.fromY != null ? opts.fromY : camera.position.y;
    if (!sceneEl || !sceneEl.object3D) {
      return { y: this._lastGroundY, normal: null, source: 'cache', hit: null };
    }
    this._origin.set(x, fromY, z);
    this._raycaster.set(this._origin, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    const pick = this.pickFloorFromHits(hits, fromY, {
      acceptBuildings,
      acceptTiles
    });
    if (pick) {
      if (opts.refreshCache) this._lastGroundY = pick.hit.point.y;
      return {
        y: pick.hit.point.y,
        normal: worldHitNormal(pick.hit),
        source: pick.source,
        hit: pick.hit
      };
    }
    return { y: this._lastGroundY, normal: null, source: 'cache', hit: null };
  }

  // Shared floor-priority picker. Given a near→far hit list and a reference
  // height `refY` (only hits at/below refY + epsilon are floor candidates),
  // return { hit, source }: nearest accepted segment/building below refY wins
  // over any tiles hit (a tiles rooftop must never beat a lower segment/building
  // even when nearer); else the nearest accepted tiles hit; else null. Reused by
  // the floor probe and the enclosure probe so every consumer reads the SAME
  // floor the swoop/WASD path does.
  pickFloorFromHits(hits, refY, { acceptBuildings, acceptTiles }) {
    const ceil = refY === Infinity ? Infinity : refY + 1e-3;
    let tilesHit = null;
    for (const hit of hits) {
      if (hit.point.y > ceil) continue; // overhead — not a floor candidate
      if (isSolidFloorHit(hit, { acceptBuildings, acceptTiles: false })) {
        return { hit, source: 'segment-or-building' };
      }
      if (
        acceptTiles &&
        !tilesHit &&
        isSolidFloorHit(hit, { acceptBuildings: false, acceptTiles: true })
      ) {
        tilesHit = hit;
      }
    }
    if (tilesHit) return { hit: tilesHit, source: 'tiles' };
    return null;
  }

  // Collision floor at an XZ column — nearest solid surface (ground OR building
  // roof OR tiles), scatter excluded. Passes `fromY` through (default camera-y);
  // a clearance/standoff probe opts out of the `_lastGroundY` cache refresh via
  // `refreshCache:false`. Defaults keep every plain caller unchanged.
  collisionFloorAt(x, z, opts = {}) {
    return this.floorYBelowAt(x, z, {
      acceptBuildings: true,
      acceptTiles: true,
      refreshCache: opts.refreshCache !== false,
      fromY: opts.fromY
    });
  }

  // Travel-height floor below the camera (WASD fly-speed scaling only).
  travelHeightFloorYBelow() {
    return this.travelHeightFloorAt(
      this._ctx.camera.position.x,
      this._ctx.camera.position.z
    );
  }

  // Travel-height floor at an arbitrary XZ column: nearest segment-only hit
  // (buildings see-through, for WASD speed), else the minimum collision-floor y
  // over a ±2 m 3×3 grid (approximating the street/ground between roofs so speed
  // doesn't crawl over a single roof).
  travelHeightFloorAt(cx, cz) {
    const seg = this.floorYBelowAt(cx, cz, {
      acceptBuildings: false,
      acceptTiles: false,
      refreshCache: false
    });
    if (seg.source === 'segment-or-building') return seg.y;
    const SPAN = 2;
    let minY = Infinity;
    let any = false;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const f = this.floorYBelowAt(cx + ix * SPAN, cz + iz * SPAN, {
          acceptBuildings: true,
          acceptTiles: true,
          refreshCache: false
        });
        if (f.source !== 'cache') {
          any = true;
          if (f.y < minY) minY = f.y;
        }
      }
    }
    return any ? minY : this._lastGroundY;
  }

  // Forward view-ray raycast to the first solid-floor hit → cloned Vector3 or
  // null (at/above the horizon, or nothing solid ahead). Vertical-ray floor
  // assumptions do NOT apply here; callers must handle null.
  centerRayGroundHit() {
    const sceneEl = this._ctx.sceneEl;
    if (!sceneEl || !sceneEl.object3D) return null;
    const cam = this._ctx.camera;
    const dir = this._dir;
    cam.getWorldDirection(dir); // unit view direction (camera -Z in world)
    this._raycaster.set(cam.position, dir);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    for (const hit of hits) {
      if (isSolidFloorHit(hit)) {
        return hit.point.clone();
      }
    }
    return null;
  }
}
