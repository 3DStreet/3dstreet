import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  acquirePatternTexture,
  createFillTextures,
  releasePatternTexture
} from '../../src/aframe-components/shape-fill-textures.js';

// One shape's fill textures, driven only through update() and the stub
// callbacks - never by writing .state - so every entry state below is one a
// real shape can reach. jsdom has no renderer, so nothing but this module
// bumps a material's `version`; every case reads it as the record of program
// switches (a map gained or lost).

const GRASS = 'grass-texture';
const CONCRETE = 'seamless-bright-road';

function data(over = {}) {
  return {
    closed: true,
    fillMaterial: 'solid',
    fillOpacity: 100,
    fillPattern: 'none',
    fillPatternOpacity: 100,
    fillPatternSpacing: 1,
    fillPatternWidth: 0.15,
    ...over
  };
}

let made;
let fixtures;

beforeEach(() => {
  made = [];
  fixtures = [];
  for (const id of [GRASS, CONCRETE]) {
    const img = document.createElement('img');
    img.id = id;
    img.setAttribute('data-src', `https://example.invalid/${id}.png`);
    document.body.appendChild(img);
    fixtures.push(img);
  }
});

afterEach(() => {
  // A bound surface map always belongs to a loaded surface.
  for (const h of made) {
    if (h.textures.state.surface.bound) {
      expect(h.textures.state.surface.status).toBe('loaded');
    }
  }
  fixtures.forEach((f) => f.remove());
});

// A manual scheduler: returns a handle, runs a callback only if it was not
// cancelled, records cancels, and keeps every callback so a test can run one
// directly, as if a cancelled frame had fired anyway.
function makeScheduler() {
  let next = 0;
  const live = new Map();
  const sched = {
    calls: 0,
    cancels: [],
    captured: new Map(),
    schedule: (fn) => {
      sched.calls++;
      const h = ++next;
      live.set(h, fn);
      sched.captured.set(h, fn);
      return h;
    },
    cancel: (h) => {
      sched.cancels.push(h);
      live.delete(h);
    },
    flush: () => {
      const fns = Array.from(live.values());
      live.clear();
      fns.forEach((fn) => fn());
    }
  };
  return sched;
}

function make(scene, opts = {}) {
  const materials = [
    new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial()
  ];
  const loads = [];
  const acquired = [];
  const released = [];
  const tiles = opts.tiles || new Map();
  const sched = makeScheduler();
  const onChange = vi.fn();
  const textures = createFillTextures({
    sceneEl: scene,
    materials,
    loadTexture: (img, d, cb) => loads.push({ img, data: d, cb }),
    acquirePattern: (key) => {
      acquired.push(key);
      if (!tiles.has(key)) tiles.set(key, new THREE.Texture());
      return tiles.get(key);
    },
    releasePattern: (key) => released.push(key),
    schedule: sched.schedule,
    cancel: sched.cancel,
    onChange
  });
  const h = { textures, materials, loads, acquired, released, sched, onChange };
  h.materialVersion = () => materials[0].version;
  h.patternVersion = () => materials[1].version;
  made.push(h);
  return h;
}

// A shape whose grass surface has been requested and has landed.
function boundGrass(scene) {
  const h = make(scene);
  h.textures.update(data({ fillMaterial: 'grass' }));
  const tex = new THREE.Texture();
  h.loads[0].cb(tex);
  expect(h.materials[0].map).toBe(tex);
  return { h, tex };
}

describe('fill textures - surface texture transitions', () => {
  it('requests nothing for a Solid shape', () => {
    const h = make({});
    const v = h.materialVersion();
    h.textures.update(data());
    expect(h.loads).toHaveLength(0);
    expect(h.materialVersion() - v).toBe(0);
  });

  it('requests a texture with its real-world repeat and binds it when it lands', () => {
    const h = make({});
    h.textures.update(data({ fillMaterial: 'grass' }));
    expect(h.loads).toHaveLength(1);
    expect(h.loads[0].img.id).toBe(GRASS);
    expect(h.loads[0].data.repeat).toEqual({ x: 1 / 4, y: 1 / 6 });
    expect(h.materials[0].map).toBe(null);
    expect(h.textures.state.surface.status).toBe('pending');
    const v = h.materialVersion();
    const tex = new THREE.Texture();
    h.loads[0].cb(tex);
    expect(h.materials[0].map).toBe(tex);
    expect(h.textures.state.surface.status).toBe('loaded');
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(h.materialVersion() - v).toBe(1);
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('unbinds on un-want and keeps the id', () => {
    const { h } = boundGrass({});
    const v = h.materialVersion();
    h.textures.update(data());
    expect(h.materials[0].map).toBe(null);
    expect(h.materialVersion() - v).toBe(1);
    expect(h.textures.state.surface.id).toBe(GRASS);
  });

  it('rebinds the same texture when a shape is opened and closed again', () => {
    const { h, tex } = boundGrass({});
    h.textures.update(data({ fillMaterial: 'grass', closed: false }));
    expect(h.materials[0].map).toBe(null);
    const v = h.materialVersion();
    h.textures.update(data({ fillMaterial: 'grass', closed: true }));
    expect(h.materials[0].map).toBe(tex);
    expect(h.materialVersion() - v).toBe(1);
    expect(h.loads).toHaveLength(1);
  });

  it('does nothing for the same id loaded, pending or failed', () => {
    const { h } = boundGrass({});
    const v = h.materialVersion();
    h.textures.update(data({ fillMaterial: 'grass', fillTint: '#ff0000' }));
    expect(h.materialVersion() - v).toBe(0);
    expect(h.loads).toHaveLength(1);

    const p = make({});
    p.textures.update(data({ fillMaterial: 'grass' }));
    p.textures.update(data({ fillMaterial: 'grass', fillOpacity: 50 }));
    expect(p.loads).toHaveLength(1);

    const f = make({});
    f.textures.update(data({ fillMaterial: 'grass' }));
    f.loads[0].cb(null);
    f.textures.update(data({ fillMaterial: 'grass', fillOpacity: 50 }));
    expect(f.loads).toHaveLength(1);
    expect(f.textures.state.surface.status).toBe('failed');
  });

  it('hands a texture another shape already loaded straight back, with no callback', () => {
    const scene = {};
    const { tex } = boundGrass(scene);
    const b = make(scene);
    const v = b.materialVersion();
    b.textures.update(data({ fillMaterial: 'grass' }));
    expect(b.materials[0].map).toBe(tex);
    expect(b.textures.state.surface.status).toBe('loaded');
    expect(b.materialVersion() - v).toBe(1);
    expect(b.loads).toHaveLength(0);
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('tells every waiting shape inside the load callback', () => {
    const scene = {};
    const a = make(scene);
    const b = make(scene);
    a.textures.update(data({ fillMaterial: 'grass' }));
    b.textures.update(data({ fillMaterial: 'grass' }));
    expect(a.loads.length + b.loads.length).toBe(1);
    const tex = new THREE.Texture();
    a.loads[0].cb(tex);
    for (const h of [a, b]) {
      expect(h.materials[0].map).toBe(tex);
      expect(h.textures.state.surface.status).toBe('loaded');
      expect(h.onChange).toHaveBeenCalledTimes(1);
    }
  });

  it('unbinds at once when one texture is swapped for another not yet loaded', () => {
    const { h } = boundGrass({});
    const v = h.materialVersion();
    h.textures.update(data({ fillMaterial: 'concrete' }));
    expect(h.materials[0].map).toBe(null);
    expect(h.materialVersion() - v).toBe(1);
    expect(h.loads).toHaveLength(2);
    expect(h.loads[1].img.id).toBe(CONCRETE);
    h.loads[1].cb(null);
    expect(h.materials[0].map).toBe(null);
    expect(h.textures.state.surface.status).toBe('failed');
  });

  it('ignores a load for a surface the shape has moved off, or after dispose', () => {
    const moved = make({});
    moved.textures.update(data({ fillMaterial: 'grass' }));
    moved.textures.update(data({ fillMaterial: 'concrete' }));
    moved.loads[0].cb(new THREE.Texture());
    expect(moved.materials[0].map).toBe(null);
    expect(moved.textures.state.surface.id).toBe(CONCRETE);
    expect(moved.textures.state.surface.status).toBe('pending');
    expect(moved.onChange).not.toHaveBeenCalled();

    const gone = make({});
    gone.textures.update(data({ fillMaterial: 'grass' }));
    gone.textures.dispose();
    gone.loads[0].cb(new THREE.Texture());
    expect(gone.materials[0].map).toBe(null);
    expect(gone.onChange).not.toHaveBeenCalled();
  });

  it('records a load that lands while un-wanted, and binds it on a re-want', () => {
    const h = make({});
    h.textures.update(data({ fillMaterial: 'grass' }));
    h.textures.update(data({ fillMaterial: 'grass', closed: false }));
    const tex = new THREE.Texture();
    h.loads[0].cb(tex);
    expect(h.materials[0].map).toBe(null);
    expect(h.textures.state.surface.status).toBe('loaded');
    h.textures.update(data({ fillMaterial: 'grass' }));
    expect(h.materials[0].map).toBe(tex);
    expect(h.loads).toHaveLength(1);
  });

  it('marks a failed load and asks again only for a different surface', () => {
    const h = make({});
    h.textures.update(data({ fillMaterial: 'grass' }));
    h.loads[0].cb(null);
    expect(h.textures.state.surface.status).toBe('failed');
    h.textures.update(data({ fillMaterial: 'grass', fillTint: '#00ff00' }));
    expect(h.loads).toHaveLength(1);
    h.textures.update(data({ fillMaterial: 'concrete' }));
    expect(h.loads).toHaveLength(2);
    // Back to grass: the failed entry was dropped, so it is asked for again.
    h.textures.update(data({ fillMaterial: 'grass' }));
    expect(h.loads).toHaveLength(3);
  });

  it('waits once for a surface left and returned to while it loads', () => {
    const h = make({});
    h.textures.update(data({ fillMaterial: 'grass' }));
    h.textures.update(data({ fillMaterial: 'concrete' }));
    h.textures.update(data({ fillMaterial: 'grass' }));
    expect(h.loads.filter((l) => l.img.id === GRASS)).toHaveLength(1);
    const v = h.materialVersion();
    const tex = new THREE.Texture();
    h.loads[0].cb(tex);
    expect(h.materials[0].map).toBe(tex);
    expect(h.materialVersion() - v).toBe(1);
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('requests nothing when there is no image to load', () => {
    fixtures.forEach((f) => f.remove());
    const missing = make({});
    missing.textures.update(data({ fillMaterial: 'grass' }));
    expect(missing.textures.state.surface.status).toBe('failed');
    expect(missing.loads).toHaveLength(0);

    const bare = document.createElement('img');
    bare.id = GRASS;
    document.body.appendChild(bare);
    fixtures.push(bare);
    const noSrc = make({});
    noSrc.textures.update(data({ fillMaterial: 'grass' }));
    expect(noSrc.textures.state.surface.status).toBe('failed');
    expect(noSrc.loads).toHaveLength(0);
  });
});

describe('fill textures - pattern tile transitions', () => {
  const stripes = (over = {}) => data({ fillPattern: 'stripes', ...over });

  it('releases nothing when nothing is held', () => {
    const h = make({});
    expect(() => h.textures.update(data())).not.toThrow();
    expect(h.released).toHaveLength(0);
    expect(h.acquired).toHaveLength(0);
  });

  it('draws the first tile synchronously and keeps it for the same key', () => {
    const h = make({});
    const v = h.patternVersion();
    h.textures.update(stripes());
    expect(h.acquired).toHaveLength(1);
    expect(h.materials[1].map).not.toBe(null);
    expect(h.textures.state.pattern.bound).toBe(true);
    expect(h.patternVersion() - v).toBe(1);
    h.textures.update(stripes({ fillPatternColor: '#ff0000' }));
    expect(h.acquired).toHaveLength(1);
    expect(h.sched.calls).toBe(0);
  });

  it('defers a key change one step, coalesces, and swaps without a program switch', () => {
    const h = make({});
    h.textures.update(stripes());
    const first = h.materials[1].map;
    const firstKey = h.textures.state.pattern.key;
    h.textures.update(stripes({ fillPatternSpacing: 1.2 }));
    expect(h.sched.calls).toBe(1);
    expect(h.materials[1].map).toBe(first);
    h.textures.update(stripes({ fillPatternSpacing: 1.4 }));
    h.textures.update(stripes({ fillPatternSpacing: 1.6 }));
    expect(h.sched.calls).toBe(1);
    const v = h.patternVersion();
    h.sched.flush();
    expect(h.acquired).toHaveLength(2);
    expect(h.acquired[1]).toBe('stripes|1.6|0.15');
    expect(h.materials[1].map).not.toBe(first);
    expect(h.patternVersion() - v).toBe(0);
    expect(h.released).toEqual([firstKey]);
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('releases and clears on every kind of un-want', () => {
    for (const off of [
      { fillPattern: 'none' },
      { fillPatternOpacity: 0 },
      { closed: false }
    ]) {
      const h = make({});
      h.textures.update(stripes());
      h.textures.update(stripes({ fillPatternSpacing: 2 }));
      const handle = Array.from(h.sched.captured.keys())[0];
      const v = h.patternVersion();
      h.textures.update(stripes(off));
      expect(h.sched.cancels).toEqual([handle]);
      expect(h.released).toHaveLength(1);
      expect(h.materials[1].map).toBe(null);
      expect(h.patternVersion() - v).toBe(1);
      expect(h.textures.state.pattern.key).toBe(null);
      expect(h.textures.state.pattern.bound).toBe(false);
    }
  });

  it('treats a re-want after an un-want as a first want', () => {
    const h = make({});
    h.textures.update(stripes());
    h.textures.update(data());
    const v = h.patternVersion();
    h.textures.update(stripes());
    expect(h.acquired).toHaveLength(2);
    expect(h.released).toHaveLength(1);
    expect(h.textures.state.pattern.bound).toBe(true);
    expect(h.patternVersion() - v).toBe(1);
    h.textures.dispose();
    expect(h.released).toHaveLength(h.acquired.length);
  });

  it('acquires nothing from a step that runs after an un-want', () => {
    const h = make({});
    h.textures.update(stripes());
    h.textures.update(stripes({ fillPatternSpacing: 2 }));
    const [handle, step] = Array.from(h.sched.captured.entries())[0];
    h.textures.update(data());
    expect(h.sched.cancels).toContain(handle);
    expect(() => step()).not.toThrow();
    expect(h.acquired).toHaveLength(1);
    expect(h.released).toHaveLength(1);
  });

  it('cancels a pending change on a return to the held key', () => {
    const h = make({});
    h.textures.update(stripes());
    h.textures.update(stripes({ fillPatternSpacing: 2 }));
    const handle = Array.from(h.sched.captured.keys())[0];
    h.textures.update(stripes());
    expect(h.sched.cancels).toEqual([handle]);
    h.sched.flush();
    expect(h.acquired).toHaveLength(1);
    expect(h.released).toHaveLength(0);
  });
});

describe('fill textures - dispose', () => {
  it('cancels the step, releases once, and ignores anything that arrives later', () => {
    const h = make({});
    h.textures.update(data({ fillMaterial: 'grass', fillPattern: 'stripes' }));
    h.textures.update(
      data({
        fillMaterial: 'grass',
        fillPattern: 'stripes',
        fillPatternSpacing: 2
      })
    );
    const [handle, step] = Array.from(h.sched.captured.entries())[0];
    h.textures.dispose();
    expect(h.sched.cancels).toContain(handle);
    expect(h.released).toHaveLength(1);
    h.loads[0].cb(new THREE.Texture());
    expect(h.materials[0].map).toBe(null);
    expect(h.onChange).not.toHaveBeenCalled();
    step();
    expect(h.acquired).toHaveLength(1);
  });

  it('releases nothing after an un-want', () => {
    const h = make({});
    h.textures.update(data({ fillPattern: 'stripes' }));
    h.textures.update(data());
    h.textures.dispose();
    expect(h.released).toHaveLength(1);
  });
});

describe('fill textures - the real pattern cache', () => {
  it('shares one drawn texture per exact tuple and disposes it on the last release', () => {
    const scene = {};
    const key = 'stripes|1|0.15';
    const a = acquirePatternTexture(scene, key);
    const b = acquirePatternTexture(scene, key);
    expect(b).toBe(a);
    expect(a).toBeInstanceOf(THREE.DataTexture);
    expect(a.repeat.x).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(a.repeat.y).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(a.version).toBeGreaterThanOrEqual(1);
    const dispose = vi.spyOn(a, 'dispose');
    releasePatternTexture(scene, key);
    expect(dispose).not.toHaveBeenCalled();
    releasePatternTexture(scene, key);
    expect(dispose).toHaveBeenCalledTimes(1);
    // The entry is gone: the next acquire draws a new texture.
    const c = acquirePatternTexture(scene, key);
    // Identity only. not.toBe deep-compares any two distinct objects for its
    // failure hint, and two tiles of one tuple hold equal pixel arrays, which
    // takes seconds.
    expect(Object.is(c, a)).toBe(false);
    releasePatternTexture(scene, key);
  });

  it('keeps proportional tuples apart', () => {
    const scene = {};
    const a = acquirePatternTexture(scene, 'stripes|1|0.15');
    const b = acquirePatternTexture(scene, 'stripes|2|0.3');
    expect(b).not.toBe(a);
    expect(a.repeat.x).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(b.repeat.x).toBeCloseTo(1 / (2 * Math.SQRT2), 12);
  });

  it('keeps each scene to its own cache', () => {
    const key = 'dots|1|0.15';
    const a = acquirePatternTexture({}, key);
    const b = acquirePatternTexture({}, key);
    expect(Object.is(b, a)).toBe(false);
  });

  it('shares a tile between two shapes through the default acquire', () => {
    const scene = {};
    const make2 = () => {
      const materials = [
        new THREE.MeshStandardMaterial(),
        new THREE.MeshStandardMaterial()
      ];
      const sched = makeScheduler();
      const textures = createFillTextures({
        sceneEl: scene,
        materials,
        schedule: sched.schedule,
        cancel: sched.cancel
      });
      return { textures, materials };
    };
    const a = make2();
    const b = make2();
    a.textures.update(data({ fillPattern: 'stripes' }));
    b.textures.update(data({ fillPattern: 'stripes' }));
    const tex = a.materials[1].map;
    expect(b.materials[1].map).toBe(tex);
    const dispose = vi.spyOn(tex, 'dispose');
    a.textures.dispose();
    expect(dispose).not.toHaveBeenCalled();
    b.textures.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
