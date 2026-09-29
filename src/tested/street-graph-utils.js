/**
 * Street graph — nodes shared by street ends (#1930 pillar 1, phase 3).
 *
 * The graph is DERIVED, never stored. Streets TERMINATE at nodes
 * (docs/osm-street-lod.md, "Node model decisions"), and a node is built in
 * one of two ways:
 *
 * 1. **Intersection nodes.** A managed intersection IS a node: it absorbs
 *    every street end within its `reach` (its snap radius) that it owns —
 *    the nearest intersection wins, ties by document order, exactly the
 *    ownership rule managed-intersection applies to its arms. Ends at a
 *    real junction sit at the intersection's mouths, several meters apart
 *    and several meters from its center, so a plain proximity merge would
 *    leave them as separate one-end nodes. A street contributes only its
 *    nearer end to any one intersection (the same rule as
 *    managed-intersection's arm collection), so a short street with both
 *    ends inside one snap radius is one arm, not a loop. The node sits at
 *    the intersection's position. An intersection with no streets yet is
 *    still a node (degree 0), so every intersection resolves to one.
 * 2. **Free nodes.** Every end no intersection claimed is clustered by
 *    proximity: ends within `mergeRadius` of a node's centroid share it,
 *    and a dangling end gets a node of its own (degree 1).
 *
 * This is what lets an intersection read "the streets incident to my node"
 * instead of proximity-scanning the scene (phase 5), and what the render-
 * time insets of pillar 2 are keyed on.
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
 * @property {{x:number,z:number}} [along] unit direction from the node INTO
 *   the street body (the intersection-arm `dir` convention)
 *
 * @typedef {Object} Intersection
 * @property {string} id
 * @property {number} x world x
 * @property {number} z world z
 * @property {number} [reach] snap radius; defaults to mergeRadius × 4
 *
 * @typedef {Object} GraphNode
 * @property {string} id stable within one build: "n<index>", intersections first
 * @property {number} x intersection position, or centroid of the merged ends
 * @property {number} z
 * @property {StreetEnd[]} ends
 * @property {string|null} intersectionId the occupying managed-intersection
 */

/**
 * Build the graph's nodes from street ends and intersections.
 * @param {StreetEnd[]} ends
 * @param {Object} [options]
 * @param {number} [options.mergeRadius=1.5] meters — two free ends this close share a node
 * @param {Intersection[]} [options.intersections] in document order
 * @returns {{ nodes: GraphNode[], byEnd: Map<string, GraphNode>,
 *   byIntersection: Map<string, GraphNode> }} byEnd keyed by
 *   `${streetId}:${key}`
 */
export function buildStreetGraph(ends, options = {}) {
  const mergeRadius = options.mergeRadius ?? DEFAULT_MERGE_RADIUS_M;
  const intersections = options.intersections || [];
  const nodes = [];
  const byEnd = new Map();
  const byIntersection = new Map();

  // 1. Intersection nodes.
  for (const inter of intersections) {
    const node = {
      id: `n${nodes.length}`,
      x: inter.x,
      z: inter.z,
      ends: [],
      intersectionId: inter.id
    };
    nodes.push(node);
    byIntersection.set(inter.id, node);
  }
  // Each end goes to its nearest intersection within that intersection's
  // reach (strictly nearer wins; a tie keeps the earlier one in document
  // order — managed-intersection's ownsNode rule).
  const candidates = new Map(); // `${interId}|${streetId}` → {end, d}
  for (const end of ends || []) {
    let owner = null;
    let ownerD = Infinity;
    for (const inter of intersections) {
      const reach = inter.reach ?? mergeRadius * 4;
      const d = Math.hypot(end.x - inter.x, end.z - inter.z);
      if (d <= reach && d < ownerD - 1e-6) {
        owner = inter;
        ownerD = d;
      }
    }
    if (!owner) continue;
    // One end per street per intersection: the nearer one.
    const key = `${owner.id}|${end.streetId}`;
    const prev = candidates.get(key);
    if (!prev || ownerD < prev.d) {
      candidates.set(key, { end, d: ownerD, owner });
    }
  }
  for (const { end, owner } of candidates.values()) {
    const node = byIntersection.get(owner.id);
    node.ends.push(end);
    byEnd.set(endKey(end), node);
  }

  // 2. Free nodes: greedy proximity merge of the unclaimed ends against
  // node CENTROIDS. Ends arrive in scene order, so the result is
  // deterministic for a given scene; centroid membership keeps a long chain
  // of near-touching ends from smearing one node across the map (each end
  // must be within radius of the node's centroid, not just of its last
  // member).
  const r2 = mergeRadius * mergeRadius;
  const free = [];
  for (const end of ends || []) {
    if (byEnd.has(endKey(end))) continue;
    let best = null;
    let bestD2 = r2;
    for (const node of free) {
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
      free.push(best);
    }
    const n = best.ends.length;
    best.x = (best.x * n + end.x) / (n + 1);
    best.z = (best.z * n + end.z) / (n + 1);
    best.ends.push(end);
    byEnd.set(endKey(end), best);
  }

  return { nodes, byEnd, byIntersection };
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
