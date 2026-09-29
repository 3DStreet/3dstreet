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

  it('a node keeps the nearest of two competing intersections', () => {
    const graph = buildStreetGraph([end('a', 'end', 0, 0)], {
      intersections: [
        { id: 'near', x: 0.5, z: 0, reach: 20 },
        { id: 'far', x: 3, z: 0, reach: 20 }
      ]
    });
    expect(graph.nodes[0].intersectionId).toBe('near');
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
  });
});
