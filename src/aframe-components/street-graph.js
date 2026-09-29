/* global AFRAME */
/**
 * street-graph — the derived node graph of a scene's managed streets
 * (#1930 pillar 1, phase 3).
 *
 * Rebuilt from entity data on demand, never stored: every managed
 * intersection is a node that absorbs the street ends it owns within its
 * snap radius (nearest intersection wins, one end per street), and the
 * remaining street ends (see street-nodes.js) are clustered into shared
 * nodes by proximity (street-graph-utils.js). Nothing here mutates the scene, and a
 * saved scene carries no trace of it — the managed-street JSON round-trip
 * contract holds. Consumers ask the system for the current graph:
 *
 *   const graph = sceneEl.systems['street-graph'].getGraph();
 *   graph.nodes                  // [{ id, x, z, ends, intersectionId }]
 *   system.nodeForStreetEnd(streetEl, 'end')
 *   system.nodeForIntersection(intersectionEl) // its incident street ends
 *   system.nodesNear(worldPoint, radius)
 *
 * The graph is cached and re-derived when it is older than `maxAgeMs`
 * (default 250 ms) or after `invalidate()`. There is deliberately no event
 * plumbing: street ends move through routes no event covers (gizmo drags,
 * undo, scene load ordering), and editor entities keep their ticks paused,
 * so a short-lived cache is the honest cheap answer — the same reason
 * managed-intersection polls a signature.
 *
 * Phase 5 moves managed-intersection onto this graph (arms = the node's
 * incident streets) and phase 4's per-end insets are keyed by node.
 */
import { getStreetEndNodesWorld } from './street-nodes.js';
import { buildStreetGraph, nodesNear } from '../tested/street-graph-utils.js';

const DEFAULT_MAX_AGE_MS = 250;
export const NODE_MERGE_RADIUS_M = 1.5;

AFRAME.registerSystem('street-graph', {
  init: function () {
    this.graph = null;
    this.builtAt = 0;
    this.dirty = true;
    // Streets without a DOM id still need a stable key within a build.
    this._keys = new WeakMap();
    this._nextKey = 0;
  },

  invalidate: function () {
    this.dirty = true;
  },

  keyFor: function (el) {
    if (el.id) return el.id;
    let key = this._keys.get(el);
    if (!key) {
      key = `street~${this._nextKey++}`;
      this._keys.set(el, key);
    }
    return key;
  },

  /**
   * The current graph. `graph.ends` lists every street end record with its
   * entity; `graph.nodes` the merged nodes; `graph.byEnd` maps
   * `${streetKey}:${start|end}` → node.
   */
  getGraph: function ({ maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    const now = Date.now();
    if (!this.graph || this.dirty || now - this.builtAt > maxAgeMs) {
      this.rebuild();
    }
    return this.graph;
  },

  rebuild: function () {
    const ends = [];
    const streets = this.el.querySelectorAll('a-entity[managed-street]');
    streets.forEach((streetEl) => {
      const nodes = getStreetEndNodesWorld(streetEl);
      if (!nodes) return;
      const streetId = this.keyFor(streetEl);
      for (const key of ['start', 'end']) {
        const n = nodes[key];
        ends.push({
          streetId,
          key,
          el: streetEl,
          x: n.position.x,
          z: n.position.z,
          y: n.position.y,
          along: { x: n.along.x, z: n.along.z },
          right: { x: n.right.x, z: n.right.z },
          curved: nodes.curved,
          totalWidth: nodes.totalWidth
        });
      }
    });
    const intersections = [];
    this.el.querySelectorAll('a-entity[managed-intersection]').forEach((el) => {
      const comp = el.components['managed-intersection'];
      if (!comp) return;
      el.object3D.updateWorldMatrix(true, false);
      const p = el.object3D.getWorldPosition(
        this._vec || (this._vec = new THREE.Vector3())
      );
      intersections.push({
        id: this.keyFor(el),
        el,
        x: p.x,
        z: p.z,
        // an intersection occupies any node inside its snap radius
        reach: comp.data?.snapRadius ?? NODE_MERGE_RADIUS_M * 4
      });
    });
    const graph = buildStreetGraph(ends, {
      mergeRadius: NODE_MERGE_RADIUS_M,
      intersections
    });
    graph.ends = ends;
    graph.intersections = intersections;
    this.graph = graph;
    this.builtAt = Date.now();
    this.dirty = false;
    return graph;
  },

  nodeForStreetEnd: function (streetEl, key) {
    const graph = this.getGraph();
    return graph.byEnd.get(`${this.keyFor(streetEl)}:${key}`) || null;
  },

  /** The node an intersection occupies (degree 0 while no street connects). */
  nodeForIntersection: function (intersectionEl) {
    const graph = this.getGraph();
    return graph.byIntersection.get(this.keyFor(intersectionEl)) || null;
  },

  nodesNear: function (worldPoint, radius) {
    return nodesNear(this.getGraph(), worldPoint, radius);
  }
});
