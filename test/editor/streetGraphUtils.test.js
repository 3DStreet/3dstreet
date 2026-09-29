// Derived street graph: street ends clustered into shared nodes (#1930).
import { describe, it, expect } from 'vitest';
import {
  buildStreetGraph,
  endKey,
  nodesNear,
  nodeDegree
} from '@/tested/street-graph-utils.js';

const end = (streetId, key, x, z) => ({ streetId, key, x, z });

describe('buildStreetGraph', () => {
  it('shares one node between ends that meet, and gives dangling ends their own', () => {
    const ends = [
      end('a', 'start', 0, -50),
      end('a', 'end', 0, 0),
      end('b', 'start', 0.4, 0.3), // meets a.end within the merge radius
      end('b', 'end', 0, 50),
      end('c', 'start', 0.2, -0.4), // a third street at the same junction
      end('c', 'end', 60, 0)
    ];
    const graph = buildStreetGraph(ends, { mergeRadius: 1.5 });
    expect(graph.nodes).toHaveLength(4);
    const junction = graph.byEnd.get('a:end');
    expect(junction).toBe(graph.byEnd.get('b:start'));
    expect(junction).toBe(graph.byEnd.get('c:start'));
    expect(nodeDegree(junction)).toBe(3);
    // centroid of the three ends
    expect(junction.x).toBeCloseTo(0.2);
    expect(junction.z).toBeCloseTo(-1 / 30);
    expect(nodeDegree(graph.byEnd.get('a:start'))).toBe(1);
    expect(endKey(ends[0])).toBe('a:start');
  });

  it('does not chain distant ends through intermediate ones', () => {
    // three ends 1.2 m apart in a row: the outer two are 2.4 m apart
    const ends = [
      end('a', 'end', 0, 0),
      end('b', 'start', 1.2, 0),
      end('c', 'start', 2.4, 0)
    ];
    const graph = buildStreetGraph(ends, { mergeRadius: 1.5 });
    // a+b merge (centroid 0.6); c is 1.8 from that centroid → its own node
    expect(graph.nodes).toHaveLength(2);
    expect(graph.byEnd.get('c:start')).not.toBe(graph.byEnd.get('a:end'));
  });

  it('records the intersection standing on a node as its occupant', () => {
    const ends = [
      end('a', 'end', 0, 0),
      end('b', 'start', 0.5, 0),
      end('a', 'start', 0, -80)
    ];
    const graph = buildStreetGraph(ends, {
      mergeRadius: 1.5,
      intersections: [
        { id: 'ix-1', x: 1, z: 1 },
        { id: 'ix-far', x: 30, z: 30 }
      ]
    });
    const junction = graph.byEnd.get('a:end');
    expect(junction.intersectionId).toBe('ix-1');
    expect(graph.byEnd.get('a:start').intersectionId).toBeNull();
  });

  it('an intersection absorbs the ends at its mouths into one node', () => {
    // A 4-way OSM junction: each generated end is inset ~8 m from the
    // center, so the four ends are 11+ m apart — far beyond mergeRadius.
    const ends = [
      end('n', 'start', 0, 8),
      end('s', 'end', 0, -8),
      end('e', 'start', 8, 0),
      end('w', 'end', -8, 0),
      end('n', 'end', 0, 200),
      end('s', 'start', 0, -200)
    ];
    const graph = buildStreetGraph(ends, {
      mergeRadius: 1.5,
      intersections: [{ id: 'ix', x: 0, z: 0, reach: 20 }]
    });
    const node = graph.byIntersection.get('ix');
    expect(nodeDegree(node)).toBe(4);
    expect(node.x).toBe(0);
    expect(node.z).toBe(0);
    for (const k of ['n:start', 's:end', 'e:start', 'w:end']) {
      expect(graph.byEnd.get(k)).toBe(node);
    }
    expect(graph.byEnd.get('n:end').intersectionId).toBeNull();
  });

  it('a street joins an intersection with only its nearer end', () => {
    // a 12 m stub with both ends inside the 20 m snap radius
    const graph = buildStreetGraph(
      [end('stub', 'start', 3, 0), end('stub', 'end', 15, 0)],
      { intersections: [{ id: 'ix', x: 0, z: 0, reach: 20 }] }
    );
    const node = graph.byIntersection.get('ix');
    expect(node.ends.map(endKey)).toEqual(['stub:start']);
    expect(graph.byEnd.get('stub:end')).not.toBe(node);
    expect(graph.byEnd.get('stub:end').intersectionId).toBeNull();
  });

  it('an end belongs to its nearest intersection; ties keep document order', () => {
    const graph = buildStreetGraph(
      [end('a', 'end', 4, 0), end('b', 'start', 10, 0)],
      {
        intersections: [
          { id: 'first', x: 0, z: 0, reach: 20 },
          { id: 'second', x: 20, z: 0, reach: 20 }
        ]
      }
    );
    expect(graph.byEnd.get('a:end').intersectionId).toBe('first');
    // 10 m from both: the earlier intersection keeps it
    expect(graph.byEnd.get('b:start').intersectionId).toBe('first');
  });

  it('every intersection is a node, even with no street connected', () => {
    const graph = buildStreetGraph([], {
      intersections: [{ id: 'lonely', x: 5, z: 5 }]
    });
    expect(graph.nodes).toHaveLength(1);
    expect(nodeDegree(graph.byIntersection.get('lonely'))).toBe(0);
  });

  it('nodesNear returns nodes within a radius, nearest first', () => {
    const graph = buildStreetGraph([
      end('a', 'start', 0, 0),
      end('a', 'end', 10, 0),
      end('b', 'end', 4, 0)
    ]);
    const near = nodesNear(graph, { x: 3, z: 0 }, 5);
    expect(near.map((n) => n.ends[0].streetId + ':' + n.ends[0].key)).toEqual([
      'b:end',
      'a:start'
    ]);
    expect(nodesNear(graph, { x: 100, z: 0 }, 5)).toEqual([]);
  });

  it('handles empty input', () => {
    const graph = buildStreetGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.byEnd.size).toBe(0);
    expect(graph.byIntersection.size).toBe(0);
  });
});
