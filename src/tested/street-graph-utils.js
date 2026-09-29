/**
 * Street graph — nodes shared by street ends (#1930 pillar 1, phase 3).
 *
 * The graph is DERIVED, never stored: every managed street's two end nodes
 * (world XZ) are clustered by proximity into shared nodes, and any managed
 * intersection standing within a node's reach is recorded as that node's
 * occupant. Two street ends that meet within `mergeRadius` are the same
 * node; a street with a dangling end still gets a node of its own (degree
 * 1). This is what lets an intersection read "the streets incident to my
 * node" instead of proximity-scanning the scene (phase 5), and what the
 * render-time insets of pillar 2 are keyed on.
 *
 * Pure (no AFRAME/THREE/DOM): the scene-facing `street-graph` system feeds
 * it end records and intersection positions. Unit-tested in
 * test/editor/streetGraphUtils.test.js.
 */

const DEFAULT_MERGE_RADIUS_M = 1.5;

/**
 * @typedef {Object} StreetEnd
 * @property {string} streetId
 * @property {'start'|'end'} key
 * @property {number} x world x
 * @property {number} z world z
 * @property {{x:number,z:number}} [dir] unit direction pointing OUT of the street
 *
 * @typedef {Object} GraphNode
 * @property {string} id stable within one build: "n<index>" in discovery order
 * @property {number} x centroid of the merged ends
 * @property {number} z
 * @property {StreetEnd[]} ends
 * @property {string|null} intersectionId occupant managed-intersection (nearest, within reach)
 */

/**
 * Cluster street ends into shared nodes.
 * @param {StreetEnd[]} ends
 * @param {Object} [options]
 * @param {number} [options.mergeRadius=1.5] meters — two ends this close share a node
 * @param {Array<{id:string,x:number,z:number,reach?:number}>} [options.intersections]
 *   occupant candidates; `reach` defaults to mergeRadius × 4
 * @returns {{ nodes: GraphNode[], byEnd: Map<string, GraphNode> }} byEnd keyed
 *   by `${streetId}:${key}`
 */
export function buildStreetGraph(ends, options = {}) {
  const mergeRadius = options.mergeRadius ?? DEFAULT_MERGE_RADIUS_M;
  const r2 = mergeRadius * mergeRadius;
  const nodes = [];
  const byEnd = new Map();

  // Greedy proximity merge against node CENTROIDS. Ends arrive in scene
  // order, so the result is deterministic for a given scene; centroid
  // membership keeps a long chain of near-touching ends from smearing one
  // node across the map (each end must be within radius of the node's
  // centroid, not just of its last member).
  for (const end of ends || []) {
    let best = null;
    let bestD2 = r2;
    for (const node of nodes) {
      const dx = node.x - end.x;
      const dz = node.z - end.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = node;
      }
    }
    if (!best) {
      best = {
        id: `n${nodes.length}`,
        x: end.x,
        z: end.z,
        ends: [],
        intersectionId: null
      };
      nodes.push(best);
    }
    const n = best.ends.length;
    best.x = (best.x * n + end.x) / (n + 1);
    best.z = (best.z * n + end.z) / (n + 1);
    best.ends.push(end);
    byEnd.set(endKey(end), best);
  }

  // Occupants: each intersection claims the nearest node within its reach;
  // a node keeps its nearest intersection when several compete.
  const claimed = new Map(); // nodeId → distance
  for (const inter of options.intersections || []) {
    const reach = inter.reach ?? mergeRadius * 4;
    let bestNode = null;
    let bestD = reach;
    for (const node of nodes) {
      const d = Math.hypot(node.x - inter.x, node.z - inter.z);
      if (d <= bestD) {
        bestD = d;
        bestNode = node;
      }
    }
    if (!bestNode) continue;
    const prev = claimed.get(bestNode.id);
    if (prev === undefined || bestD < prev) {
      claimed.set(bestNode.id, bestD);
      bestNode.intersectionId = inter.id;
    }
  }

  return { nodes, byEnd };
}

export function endKey(end) {
  return `${end.streetId}:${end.key}`;
}

/** Nodes within `radius` of a world point, nearest first. */
export function nodesNear(graph, point, radius) {
  const out = [];
  for (const node of graph.nodes) {
    const d = Math.hypot(node.x - point.x, node.z - point.z);
    if (d <= radius) out.push({ node, distance: d });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.map((o) => o.node);
}

/** Node degree = number of street ends meeting there. */
export function nodeDegree(node) {
  return node.ends.length;
}
