import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// A street that follows a path shape keeps following it when the shape is
// moved into a group (which recreates the shape under the same id) and when
// the group is moved. The move goes through the real reparent command and the
// save/load pipeline it uses.
//
// shape.js statically imports the app store (Firebase/PostHog chain); a
// stand-in with the two methods it reads, as shape-fill-export.test.js does.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ unitsPreference: 'metric' }),
    subscribe: () => () => {}
  }
}));

let EntityReparentCommand;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  window.STREET.utils = window.STREET.utils || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/street-generated-stencil.js');
  await import('../../src/aframe-components/street-generated-striping.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  await import('../../src/aframe-components/street-generated-rail.js');
  await import('../../src/aframe-components/managed-street.js');
  await import('../../src/aframe-components/street-align.js');
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  await import('../../src/aframe-components/street-path.js');
  await import('../../src/json-utils_1.1.js');
  ({ EntityReparentCommand } =
    await import('../../src/editor/lib/commands/EntityReparentCommand.js'));
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

describe('a street following a path shape that is moved into a group', () => {
  it('follows the shape into the group, along with the group, and back', async () => {
    const root = await elFactory();
    const sceneEl = root.sceneEl;
    mounted.push(sceneEl);
    const add = async (parent, html) => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const el = holder.firstElementChild;
      parent.appendChild(el);
      await vi.waitFor(() => expect(el.hasLoaded).toBe(true));
      return el;
    };
    const group = await add(
      sceneEl,
      '<a-entity id="g" class="user-group" position="10 0 4" rotation="0 30 0"></a-entity>'
    );
    const path = await add(
      sceneEl,
      '<a-entity id="p" position="-30 0 8" shape="curveType: linear"></a-entity>'
    );
    for (const position of ['0 0 0', '12 0 0', '12 0 9']) {
      await add(
        path,
        `<a-entity shape-vertex position="${position}"></a-entity>`
      );
    }
    const street = await add(
      sceneEl,
      '<a-entity id="street" managed-street="path: #p; length: 20"></a-entity>'
    );

    // Where the street's centerline starts, in the world.
    const curveStart = () => {
      const curve = street.components['managed-street'].streetCurve;
      if (!curve) return null;
      return street.object3D.localToWorld(curve.sampler.points[0].clone());
    };
    const firstVertex = () =>
      document
        .getElementById('p')
        .querySelector('[shape-vertex]')
        .object3D.getWorldPosition(new window.THREE.Vector3());
    // Polls for the street to follow the shape's first vertex, which it does
    // on a throttle of a few hundred milliseconds.
    const followsShape = (what) =>
      vi.waitFor(
        () => {
          const start = curveStart();
          expect(start, `${what}: the street has a curve`).not.toBe(null);
          expect(start.distanceTo(firstVertex()), what).toBeLessThan(1e-3);
        },
        { timeout: 2000, interval: 50 }
      );

    await followsShape('before the move');
    const original = firstVertex().clone();

    new EntityReparentCommand(
      { selectEntity() {} },
      { entity: path, parentEl: 'g', indexInParent: 0 }
    ).execute();
    await vi.waitFor(() => {
      const moved = document.getElementById('p');
      expect(moved.parentNode).toBe(group);
      expect(moved.hasLoaded).toBe(true);
    });
    // Same world pose after the move, and the street still on it.
    expect(firstVertex().distanceTo(original)).toBeLessThan(1e-3);
    await followsShape('after the move into the group');

    group.setAttribute('position', { x: 20, y: 0, z: 4 });
    await vi.waitFor(
      () => expect(firstVertex().x).not.toBeCloseTo(original.x, 1),
      { timeout: 2000 }
    );
    await followsShape('after the group moved');

    group.setAttribute('position', { x: 10, y: 0, z: 4 });
    await vi.waitFor(
      () => expect(firstVertex().distanceTo(original)).toBeLessThan(1e-3),
      { timeout: 2000 }
    );
    await followsShape('after the group moved back');
  }, 30000);
});
