/* global THREE */
// The easy gizmo's column probe: one downward ray, split about the object's
// base into what is under it and what is over it.
//
// One ray answers both directions, and every surface it reports was struck on
// its front face on the way down — which is why there is no upward probe.
// Buildings are single-sided, so an upward ray hits a roof's back face and is
// silently skipped.
//
// The gizmo owns its own ProbeTargets instance rather than borrowing the
// navigation controller's: the instance has its own cache and lifetime, so
// placement does not depend on navigation initialization or teardown order.

import {
  intersectProbeTargets,
  ProbeTargets
} from '../nav-experimental/probeTargets.js';
import {
  classifyPlacementHit,
  isGizmoGroundHit,
  isUserImportedMeshHit,
  owningPlacementEntity,
  placementKindOf,
  pickSupportBelow,
  pickSurfaceAbove
} from './easyGizmoGround.js';
import { PROBE_UP_MARGIN_METRES } from './easyGizmoConstants.js';

const DOWN = { x: 0, y: -1, z: 0 };

export class EasyGizmoProbe {
  constructor(sceneEl) {
    this.sceneEl = sceneEl || null;
    this.probeTargets = new ProbeTargets(sceneEl);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;
    this._origin = new THREE.Vector3();
    this._direction = new THREE.Vector3(DOWN.x, DOWN.y, DOWN.z);
    /**
     * The qualifying hits of the MOST RECENT probe, reused rather than
     * reallocated. Valid only until the next `probeColumn` call — which is
     * exactly what a path evaluation's caller needs, since the endpoint is the
     * last column probed and its hit list is what re-splits about the object's
     * new base without a second ray.
     */
    this.lastHits = [];
    this._qualifying = this.lastHits;
    this._buildingRoofs = new Map();
    /** Set while attached; hits inside this
     * entity's subtree are not surfaces it can rest on. */
    this.excludeEl = null;
    this._suspendedFlatteners = new Set();
    this._pendingFlatteningLayers = [];
  }

  /** Expose terrain beneath the selection without changing saved flatten settings. */
  setFlatteningSuspended(suspended) {
    const desired = new Set();
    const exclude = this.excludeEl;
    if (suspended && exclude) {
      const add = (el) => {
        const component = el.components?.['geo-flatten'];
        if (component) desired.add(component);
      };
      add(exclude);
      exclude.querySelectorAll?.('[geo-flatten]').forEach(add);
    }
    let changed = false;
    for (const component of this._suspendedFlatteners) {
      if (!desired.has(component)) {
        component.setSuspended(this, false);
        changed = true;
      }
    }
    for (const component of desired) {
      if (!this._suspendedFlatteners.has(component)) {
        component.setSuspended(this, true);
        changed = true;
      }
    }
    this._suspendedFlatteners = desired;
    if (changed) {
      this._pendingFlatteningLayers = Array.from(
        this.sceneEl?.querySelectorAll('[google-maps-aerial]') || []
      )
        .map((el) => el.components?.['google-maps-aerial'])
        .filter(Boolean);
    }
  }

  _tilesReady() {
    // Shape removal regenerates tiles on their next update, not synchronously.
    for (const layer of this._pendingFlatteningLayers) {
      if (!layer.flattenEntries || layer.flatteningPlugin?.needsUpdate) {
        return false;
      }
      for (const component of this._suspendedFlatteners) {
        if (layer.flattenEntries.has(component)) return false;
      }
    }
    this._pendingFlatteningLayers.length = 0;
    return true;
  }

  /**
   * The column at (x, z), split about `baseY`.
   *
   * Returns `{ below, above }`, each `{ y, cls, hit, entity }` or null.
   *
   * SELF-EXCLUSION IS A SUBTREE TEST, NOT AN IDENTITY TEST. A managed street
   * contains its own road surface, and every child of one carries its own
   * entity — so comparing against the dragged entity alone lets a street use
   * its own road as support, which is the state where its height ratchets onto
   * a neighbouring roof and back off again.
   */
  probeColumn(x, z, baseY) {
    const empty = { below: null, above: null };
    if (!this.sceneEl) {
      this.lastHits.length = 0;
      return empty;
    }
    this._origin.set(x, baseY + PROBE_UP_MARGIN_METRES, z);
    this.raycaster.set(this._origin, this._direction);
    const hits = intersectProbeTargets(this.raycaster, {
      probeTargets: this.probeTargets,
      sceneEl: this.sceneEl
    });

    const qualifying = this._qualifying;
    qualifying.length = 0;
    const roofs = this._buildingRoofs;
    roofs.clear();
    const exclude = this.excludeEl;
    const selectedKind = placementKindOf(exclude);
    const tilesReady = this._tilesReady();
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (exclude) {
        const el = owningPlacementEntity(hit);
        if (el && (el === exclude || exclude.contains(el))) continue;
      }
      if (!isGizmoGroundHit(hit, selectedKind)) continue;
      if (!tilesReady && classifyPlacementHit(hit) === 'tiles') continue;
      qualifying.push(hit);
      if (
        classifyPlacementHit(hit) === 'building' &&
        !isUserImportedMeshHit(hit)
      ) {
        const el = owningPlacementEntity(hit);
        const y = hit.point.y;
        if (!roofs.has(el) || y > roofs.get(el)) roofs.set(el, y);
      }
    }

    // Each building contributes only its roof in this column; stacked entities
    // retain separate roofs even when their geometry shares a batch host.
    let count = 0;
    for (let i = 0; i < qualifying.length; i++) {
      const hit = qualifying[i];
      const roofY = roofs.get(owningPlacementEntity(hit));
      if (roofY !== undefined && hit.point.y < roofY) continue;
      qualifying[count++] = hit;
    }
    qualifying.length = count;
    roofs.clear();

    return {
      below: pickSupportBelow(qualifying, baseY),
      above: pickSurfaceAbove(qualifying, baseY)
    };
  }

  dispose() {
    this.setFlatteningSuspended(false);
    this.probeTargets.dispose();
    this._qualifying.length = 0;
    this._buildingRoofs.clear();
    this.sceneEl = null;
  }
}
