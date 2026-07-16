import { beforeAll, describe, expect, it } from 'vitest';
import { elFactory } from './helpers.js';

// street-traffic is a scene-level play-mode subscriber. We import only its
// real dependencies under test (street-segment + street-generated-clones for
// the mirrored cast) and register a minimal stand-in for managed-street —
// street-traffic reads nothing from it beyond `data.playable`.
beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/play/street-traffic.js');
  if (!window.AFRAME.components['managed-street']) {
    window.AFRAME.registerComponent('managed-street', {
      schema: { playable: { type: 'boolean', default: false } }
    });
  }
  window.AFRAME.emitReady();
});

function loaded(el) {
  return new Promise((resolve) => {
    if (el.hasLoaded) resolve();
    else el.addEventListener('loaded', resolve);
  });
}

/**
 * Scene with street-traffic + one playable street with a single 100m
 * inbound drive-lane. Fixed-mode clones are deterministic (no seed
 * round-trip): floor(100 / 20) = 5 'box' clones.
 */
async function makePlayableStreet({ withClones, segment, clones }) {
  const streetEl = await elFactory();
  const sceneEl = streetEl.sceneEl;
  sceneEl.setAttribute('street-traffic', '');
  streetEl.setAttribute('managed-street', 'playable: true');

  const segEl = document.createElement('a-entity');
  segEl.setAttribute(
    'street-segment',
    segment ||
      'type: drive-lane; width: 3; length: 100; direction: inbound; surface: asphalt; color: #ffffff'
  );
  if (withClones) {
    segEl.setAttribute(
      'street-generated-clones',
      clones || 'mode: fixed; modelsArray: box; spacing: 20; cycleOffset: 0.5'
    );
  }
  streetEl.appendChild(segEl);
  await loaded(segEl);
  return { sceneEl, streetEl, segEl };
}

describe('street-traffic', () => {
  it('registers the component', () => {
    expect(window.AFRAME.components['street-traffic']).toBeDefined();
  });

  it('mirrors the static cast on start and restores it on stop (#1823 A)', async () => {
    const { sceneEl, segEl } = await makePlayableStreet({ withClones: true });
    const clones = segEl.components['street-generated-clones'].createdEntities;
    expect(clones).toHaveLength(5);

    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];

    // One twin per static clone, identical mixin and t=0 position.
    expect(comp.records).toHaveLength(5);
    const byNumber = (a, b) => a - b;
    expect(comp.records.map((r) => r.startZ).sort(byNumber)).toEqual(
      clones.map((c) => c.getAttribute('position').z).sort(byNumber)
    );
    comp.records.forEach((r) => {
      expect(r.el.getAttribute('mixin')).toBe('box');
      expect(r.dir).toBe(1); // inbound lane moves +Z
    });
    // The static originals are hidden while their twins animate.
    clones.forEach((c) => expect(c.getAttribute('visible')).toBe(false));

    sceneEl.emit('play-mode-stop');
    expect(comp.records).toHaveLength(0);
    clones.forEach((c) => expect(c.getAttribute('visible')).toBe(true));
  });

  it('gives a pedestrian on a vehicle lane a pedestrian-sized collider and speed', async () => {
    const { sceneEl, segEl } = await makePlayableStreet({ withClones: true });

    // A stray authored pedestrian on the drive-lane (e.g. a crossing).
    const ped = document.createElement('a-entity');
    ped.setAttribute('mixin', 'char3');
    ped.setAttribute('position', '1 0 5');
    ped.setAttribute('data-parent-component', 'street-generated-pedestrians');
    segEl.appendChild(ped);
    await loaded(ped);

    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];
    const pedRecord = comp.records.find(
      (r) => r.el.getAttribute('mixin') === 'char3'
    );
    expect(pedRecord).toBeDefined();
    // Sidewalk-sized half extents, not the lane's sedan-sized fallback.
    expect(pedRecord.half.z).toBe(0.25);
    // Walking speed with jitter (0.7–1.3 × 1.4 m/s), not car speed.
    expect(pedRecord.speed).toBeLessThan(2);
    sceneEl.emit('play-mode-stop');
  });

  it('leaves static props (food truck, cones, parklets, dining) visible and unanimated, with no synthetic fallback', async () => {
    const { sceneEl, segEl } = await makePlayableStreet({
      withClones: true,
      clones:
        'mode: fixed; modelsArray: temporary-traffic-cone; spacing: 20; cycleOffset: 0.5'
    });
    const cones = segEl.components['street-generated-clones'].createdEntities;
    expect(cones.length).toBeGreaterThan(0);

    // Other static props authored on the same lane (Streetmix maps
    // food-truck / parklet / outdoor-dining to drive-lane segments).
    const props = ['food-trailer-rig', 'parklet', 'outdoor_dining'].map(
      (mixin, i) => {
        const el = document.createElement('a-entity');
        el.setAttribute('mixin', mixin);
        el.setAttribute(
          'data-parent-component',
          `street-generated-clones__${i + 2}`
        );
        segEl.appendChild(el);
        return el;
      }
    );
    await Promise.all(props.map(loaded));

    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];
    // No animated twins AND no synthesized sedans through the props.
    expect(comp.records).toHaveLength(0);
    cones.forEach((c) => expect(c.getAttribute('visible')).toBe(true));
    props.forEach((p) => expect(p.getAttribute('visible')).toBe(true));
    sceneEl.emit('play-mode-stop');
  });

  it('skips a vehicle lane with direction none (e.g. a center turn lane)', async () => {
    const { sceneEl, segEl } = await makePlayableStreet({
      withClones: true,
      segment:
        'type: drive-lane; width: 3; length: 100; direction: none; surface: asphalt; color: #ffffff'
    });
    const clones = segEl.components['street-generated-clones'].createdEntities;

    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];
    expect(comp.records).toHaveLength(0);
    clones.forEach((c) => expect(c.getAttribute('visible')).toBe(true));
    sceneEl.emit('play-mode-stop');
  });

  it('animates the tram cast on a rail lane', async () => {
    const { sceneEl, segEl } = await makePlayableStreet({
      withClones: true,
      segment:
        'type: rail; width: 3; length: 100; direction: outbound; surface: asphalt; color: #ffffff',
      clones: 'mode: fixed; modelsArray: tram; spacing: 20; cycleOffset: 0.5'
    });
    const trams = segEl.components['street-generated-clones'].createdEntities;
    expect(trams).toHaveLength(5);

    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];
    expect(comp.records).toHaveLength(5);
    comp.records.forEach((r) => {
      expect(r.el.getAttribute('mixin')).toBe('tram');
      expect(r.dir).toBe(-1); // outbound lane moves -Z
      expect(r.half.z).toBe(11.5); // tram-sized collider
    });
    trams.forEach((c) => expect(c.getAttribute('visible')).toBe(false));
    sceneEl.emit('play-mode-stop');
    trams.forEach((c) => expect(c.getAttribute('visible')).toBe(true));
  });

  it('falls back to a synthesized mixed-model flow when a lane has no cast', async () => {
    const { sceneEl } = await makePlayableStreet({ withClones: false });
    sceneEl.emit('play-mode-start');
    const comp = sceneEl.components['street-traffic'];

    // density 2 per 60m over 100m → 3 records.
    expect(comp.records).toHaveLength(3);
    const pool = [
      'sedan-rig',
      'box-truck-rig',
      'self-driving-waymo-car',
      'suv-rig',
      'motorbike'
    ];
    comp.records.forEach((r) => {
      expect(pool).toContain(r.el.getAttribute('mixin'));
      expect(Math.abs(r.startZ)).toBeLessThanOrEqual(50);
    });
    sceneEl.emit('play-mode-stop');
  });
});
