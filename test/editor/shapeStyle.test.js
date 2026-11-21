import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHAPE_STYLE,
  normaliseShapeStyle,
  readStoredShapeStyle
} from '../../src/editor/lib/shapeStyle.js';

const MODULE_PATH = '../../src/editor/lib/shapeStyle.js';
const STORAGE_KEY = 'lastShapeStyle';

// The fill-appearance keys' cold-start values, as literals - the defaults a
// value persisted before they existed picks up.
const NEW_FILL_DEFAULTS = {
  fillMaterial: 'solid',
  fillTint: '#ffffff',
  fillPattern: 'none',
  fillPatternOpacity: 100,
  fillPatternColor: '#ffffff',
  fillPatternSpacing: 1,
  fillPatternWidth: 0.15
};

const ALL_STYLE_KEYS = [
  'fillColor',
  'fillMaterial',
  'fillOpacity',
  'fillPattern',
  'fillPatternColor',
  'fillPatternOpacity',
  'fillPatternSpacing',
  'fillPatternWidth',
  'fillTint',
  'lineColor',
  'lineWidth'
];

// A minimal localStorage double. Real jsdom storage would work for the happy
// paths, but not for the throwing cases, and the call-count assertions need a
// spy either way.
function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((key) => (key in data ? data[key] : null)),
    setItem: vi.fn((key, value) => {
      data[key] = String(value);
    }),
    data
  };
}

function installStorage(stub) {
  vi.stubGlobal('localStorage', stub);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normaliseShapeStyle', () => {
  it('keeps a complete object unchanged', () => {
    const complete = {
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#0000ff',
      fillOpacity: 25,
      fillMaterial: 'grass',
      fillTint: '#80c0ff',
      fillPattern: 'dots',
      fillPatternOpacity: 0,
      fillPatternColor: '#ff0000',
      fillPatternSpacing: 2.5,
      fillPatternWidth: 0.4
    };
    expect(normaliseShapeStyle(complete)).toEqual(complete);
  });

  // The migration: a value persisted before the fill keys existed keeps its
  // line style and picks up default fill.
  it('fills missing keys from the defaults, per key', () => {
    expect(
      normaliseShapeStyle({ lineColor: '#00ff00', lineWidth: 0.3 })
    ).toEqual({
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#ffe600',
      fillOpacity: 40,
      ...NEW_FILL_DEFAULTS
    });
    expect(normaliseShapeStyle({ lineColor: '#00ff00' })).toEqual({
      lineColor: '#00ff00',
      lineWidth: 0.15,
      fillColor: '#ffe600',
      fillOpacity: 40,
      ...NEW_FILL_DEFAULTS
    });
    expect(normaliseShapeStyle({ lineWidth: 0.3 })).toEqual({
      lineColor: '#ffe600',
      lineWidth: 0.3,
      fillColor: '#ffe600',
      fillOpacity: 40,
      ...NEW_FILL_DEFAULTS
    });
  });

  it('rejects unusable colours to the default', () => {
    expect(normaliseShapeStyle({ lineColor: '' }).lineColor).toBe('#ffe600');
    expect(normaliseShapeStyle({ lineColor: 42 }).lineColor).toBe('#ffe600');
    expect(normaliseShapeStyle({ fillColor: null }).fillColor).toBe('#ffe600');
  });

  it('accepts non-hex colour strings verbatim', () => {
    expect(normaliseShapeStyle({ lineColor: 'red' }).lineColor).toBe('red');
    expect(normaliseShapeStyle({ fillColor: 'rgb(1,2,3)' }).fillColor).toBe(
      'rgb(1,2,3)'
    );
  });

  // The type gate runs BEFORE coercion. Number(null), Number(''), Number([])
  // and Number(false) are all 0, so a coerce-then-check-finite implementation
  // passes every other test in this file and fails only these.
  it('type-gates numbers before coercing, so wrong types do not become 0', () => {
    expect(normaliseShapeStyle({ lineWidth: null }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ lineWidth: '' }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ lineWidth: [] }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ lineWidth: false }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ fillOpacity: null }).fillOpacity).toBe(40);
    expect(normaliseShapeStyle({ fillOpacity: '' }).fillOpacity).toBe(40);
    expect(normaliseShapeStyle({ fillOpacity: [] }).fillOpacity).toBe(40);
    expect(normaliseShapeStyle({ fillOpacity: true }).fillOpacity).toBe(40);
  });

  // The pair that matters: a bare coercion would put this one hand-edit
  // straight into the all-invisible state.
  it('defaults both numeric keys when both are null', () => {
    expect(normaliseShapeStyle({ lineWidth: null, fillOpacity: null })).toEqual(
      DEFAULT_SHAPE_STYLE
    );
  });

  // Number(' ') is 0 and ' ' is non-empty, so an untrimmed emptiness test
  // admits whitespace as a zero. This is the only automated check on that
  // clause.
  it('trims the string arm before testing emptiness', () => {
    expect(normaliseShapeStyle({ lineWidth: ' ' }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ fillOpacity: '\t' }).fillOpacity).toBe(40);
    expect(normaliseShapeStyle({ lineWidth: '\n' }).lineWidth).toBe(0.15);
  });

  it('rejects non-numeric strings and non-finite numbers', () => {
    expect(normaliseShapeStyle({ lineWidth: 'wide' }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ lineWidth: NaN }).lineWidth).toBe(0.15);
    expect(normaliseShapeStyle({ lineWidth: Infinity }).lineWidth).toBe(0.15);
  });

  it('coerces a numeric string', () => {
    expect(normaliseShapeStyle({ lineWidth: '0.3' }).lineWidth).toBe(0.3);
    expect(normaliseShapeStyle({ fillOpacity: '25' }).fillOpacity).toBe(25);
  });

  it('rounds an int key', () => {
    expect(normaliseShapeStyle({ fillOpacity: 40.7 }).fillOpacity).toBe(41);
    expect(normaliseShapeStyle({ fillOpacity: 40.2 }).fillOpacity).toBe(40);
  });

  it('clamps to the schema range rather than defaulting', () => {
    expect(normaliseShapeStyle({ lineWidth: -2 }).lineWidth).toBe(0.05);
    expect(normaliseShapeStyle({ fillOpacity: 170 }).fillOpacity).toBe(100);
    expect(normaliseShapeStyle({ fillOpacity: -5 }).fillOpacity).toBe(0);
  });

  // "Fill off sticks": a falsy-check regression (raw.fillOpacity || default)
  // would pass every other test here and silently lose this.
  it('keeps an explicit fillOpacity of 0', () => {
    expect(normaliseShapeStyle({ fillOpacity: 0 }).fillOpacity).toBe(0);
  });

  // The other numeric key does NOT keep its zero: a zero-width line is legal on
  // a shape but useless as the default the next shape is drawn with, so the
  // remembered value is floored rather than falling back to the 0.15 default.
  it('floors a stored lineWidth of 0 rather than defaulting it', () => {
    expect(normaliseShapeStyle({ lineWidth: 0 }).lineWidth).toBe(0.05);
  });

  it('returns exactly the appearance keys, dropping everything else', () => {
    const result = normaliseShapeStyle({
      lineColor: '#00ff00',
      lineWidth: 0.3,
      closed: true,
      selectInside: false,
      updateEvent: 'x',
      fillAngle: 30,
      fillOffsetAlong: 1,
      fillOffsetAcross: -1,
      junk: 1
    });
    expect(Object.keys(result).sort()).toEqual(ALL_STYLE_KEYS);
  });

  it('yields the defaults for junk input without throwing', () => {
    for (const raw of [null, undefined, [], 42, 'string', true]) {
      expect(normaliseShapeStyle(raw)).toEqual(DEFAULT_SHAPE_STYLE);
    }
  });

  it('returns a fresh object that does not track the input', () => {
    const raw = { lineColor: '#00ff00', lineWidth: 0.3 };
    const result = normaliseShapeStyle(raw);
    expect(result).not.toBe(raw);
    raw.lineColor = '#ff0000';
    expect(result.lineColor).toBe('#00ff00');
  });

  it('normalises the fill keys: lists, clamps and zeros', () => {
    expect(normaliseShapeStyle({ fillMaterial: 'water' }).fillMaterial).toBe(
      'solid'
    );
    expect(normaliseShapeStyle({ fillMaterial: 'asphalt' }).fillMaterial).toBe(
      'solid'
    );
    expect(normaliseShapeStyle({ fillPattern: 'zigzag' }).fillPattern).toBe(
      'none'
    );
    expect(
      normaliseShapeStyle({ fillMaterial: 'parking-lot' }).fillMaterial
    ).toBe('parking-lot');
    expect(
      normaliseShapeStyle({ fillPatternOpacity: 0 }).fillPatternOpacity
    ).toBe(0);
    expect(
      normaliseShapeStyle({ fillPatternOpacity: 170 }).fillPatternOpacity
    ).toBe(100);
    expect(
      normaliseShapeStyle({ fillPatternSpacing: 0 }).fillPatternSpacing
    ).toBe(0.05);
    expect(normaliseShapeStyle({ fillPatternWidth: -1 }).fillPatternWidth).toBe(
      0.01
    );
    expect(
      normaliseShapeStyle({ fillPatternSpacing: 'wide' }).fillPatternSpacing
    ).toBe(1);
    expect(normaliseShapeStyle({ fillTint: '' }).fillTint).toBe('#ffffff');
  });

  it('keeps an older stored style and gives it the new fill defaults', () => {
    expect(
      normaliseShapeStyle({
        lineColor: '#00ff00',
        lineWidth: 0.3,
        fillColor: '#0000ff',
        fillOpacity: 25
      })
    ).toEqual({
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#0000ff',
      fillOpacity: 25,
      ...NEW_FILL_DEFAULTS
    });
  });

  // Choosing a texture raises the opacity only through the panel's Material
  // dropdown; the sticky style never derives one key from another.
  it('never raises the opacity for a textured material', () => {
    expect(
      normaliseShapeStyle({ fillMaterial: 'grass', fillOpacity: 40 })
        .fillOpacity
    ).toBe(40);
  });
});

describe('readStoredShapeStyle', () => {
  it('reads and normalises a stored value', () => {
    installStorage(
      makeStorage({
        [STORAGE_KEY]: '{"lineColor":"#00ff00","lineWidth":0.3}'
      })
    );
    expect(readStoredShapeStyle(STORAGE_KEY)).toEqual({
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#ffe600',
      fillOpacity: 40,
      ...NEW_FILL_DEFAULTS
    });
  });

  it('falls back to the defaults for malformed, absent or non-object values', () => {
    for (const stored of [undefined, 'garbage', 'null', '[]', '42']) {
      installStorage(
        makeStorage(stored === undefined ? {} : { [STORAGE_KEY]: stored })
      );
      expect(readStoredShapeStyle(STORAGE_KEY)).toEqual(DEFAULT_SHAPE_STYLE);
      vi.unstubAllGlobals();
    }
  });

  it('does not propagate a throwing getItem', () => {
    installStorage({
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {}
    });
    expect(readStoredShapeStyle(STORAGE_KEY)).toEqual(DEFAULT_SHAPE_STYLE);
  });

  // One contract on every path: a fresh mutable object, never the frozen
  // shared constant — otherwise a future in-place write would no-op or throw
  // depending on which branch produced the value.
  it('returns a fresh mutable object on both the success and failure paths', () => {
    installStorage(makeStorage({ [STORAGE_KEY]: '{"lineWidth":0.3}' }));
    const ok = readStoredShapeStyle(STORAGE_KEY);
    expect(ok).not.toBe(DEFAULT_SHAPE_STYLE);
    ok.lineWidth = 9;
    expect(ok.lineWidth).toBe(9);

    vi.unstubAllGlobals();
    installStorage(makeStorage({ [STORAGE_KEY]: 'garbage' }));
    const failed = readStoredShapeStyle(STORAGE_KEY);
    expect(failed).not.toBe(DEFAULT_SHAPE_STYLE);
    failed.lineWidth = 9;
    expect(failed.lineWidth).toBe(9);
  });
});

// The module caches the sticky style in module scope, so each test needs its
// own module instance.
//
// EVERY symbol asserted against here must come from this describe's OWN dynamic
// import. After resetModules the dynamically-imported module is a different
// instance, so its DEFAULT_SHAPE_STYLE is a different object identity from the
// statically-imported one at the top of this file — an identity assertion
// against the static symbol would hold no matter what the function returned.
describe('getShapeStyle / setShapeStyle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a fresh defaults object when nothing is stored', async () => {
    installStorage(makeStorage());
    const { getShapeStyle, DEFAULT_SHAPE_STYLE: DEFAULTS } = await import(
      MODULE_PATH
    );
    const result = getShapeStyle();
    expect(result).toEqual(DEFAULTS);
    expect(result).not.toBe(DEFAULTS);
  });

  it('reads localStorage once and caches for the session', async () => {
    const storage = makeStorage({ [STORAGE_KEY]: '{"lineWidth":0.3}' });
    installStorage(storage);
    const { getShapeStyle } = await import(MODULE_PATH);
    getShapeStyle();
    getShapeStyle();
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it('persists the normalised value and serves it back', async () => {
    const storage = makeStorage();
    installStorage(storage);
    const { getShapeStyle, setShapeStyle } = await import(MODULE_PATH);
    setShapeStyle({ lineColor: '#00ff00', lineWidth: '0.3' });
    const expected = {
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#ffe600',
      fillOpacity: 40,
      ...NEW_FILL_DEFAULTS
    };
    expect(getShapeStyle()).toEqual(expected);
    expect(JSON.parse(storage.data[STORAGE_KEY])).toEqual(expected);
  });

  it('writes only the appearance keys from a raw shape data object', async () => {
    const storage = makeStorage();
    installStorage(storage);
    const { setShapeStyle } = await import(MODULE_PATH);
    setShapeStyle({
      lineColor: '#00ff00',
      lineWidth: 0.3,
      fillColor: '#0000ff',
      fillOpacity: 25,
      closed: true,
      selectInside: false,
      updateEvent: '',
      fillAngle: 30,
      fillOffsetAlong: 1,
      fillOffsetAcross: -1
    });
    expect(Object.keys(JSON.parse(storage.data[STORAGE_KEY])).sort()).toEqual(
      ALL_STYLE_KEYS
    );
  });

  it('does not touch storage when the value is unchanged', async () => {
    const storage = makeStorage();
    installStorage(storage);
    const { setShapeStyle } = await import(MODULE_PATH);
    setShapeStyle({ lineColor: '#00ff00', lineWidth: 0.3 });
    setShapeStyle({ lineColor: '#00ff00', lineWidth: 0.3 });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  // Every other write test also moves lineColor, so a guard comparing only
  // lineColor would pass them all. One key at a time here, so a guard that
  // omits ANY of the keys swallows that key's write and fails this.
  const BASE_STYLE = {
    lineColor: '#00ff00',
    lineWidth: 0.3,
    fillColor: '#0000ff',
    fillOpacity: 25,
    fillMaterial: 'grass',
    fillTint: '#80c0ff',
    fillPattern: 'dots',
    fillPatternOpacity: 50,
    fillPatternColor: '#ff0000',
    fillPatternSpacing: 2.5,
    fillPatternWidth: 0.4
  };
  const CHANGED = {
    lineColor: '#ff0000',
    lineWidth: 0.7,
    fillColor: '#00ffff',
    fillOpacity: 70,
    fillMaterial: 'concrete',
    fillTint: '#336699',
    fillPattern: 'stripes',
    fillPatternOpacity: 0,
    fillPatternColor: '#00ff00',
    fillPatternSpacing: 3,
    fillPatternWidth: 0.2
  };

  for (const key of Object.keys(BASE_STYLE)) {
    it(`writes when only ${key} changes`, async () => {
      const storage = makeStorage();
      installStorage(storage);
      const { getShapeStyle, setShapeStyle } = await import(MODULE_PATH);
      setShapeStyle(BASE_STYLE);
      setShapeStyle({ ...BASE_STYLE, [key]: CHANGED[key] });
      expect(storage.setItem).toHaveBeenCalledTimes(2);
      expect(getShapeStyle()[key]).toBe(CHANGED[key]);
      expect(JSON.parse(storage.data[STORAGE_KEY])[key]).toBe(CHANGED[key]);
    });
  }

  // The point of caching in module scope: with storage unavailable the
  // preference still works for the rest of the session, degrading to "does not
  // survive a reload" rather than to "does nothing".
  it('keeps serving the new value when setItem throws', async () => {
    installStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      }
    });
    const { getShapeStyle, setShapeStyle } = await import(MODULE_PATH);
    expect(() => setShapeStyle({ lineColor: '#00ff00' })).not.toThrow();
    expect(getShapeStyle().lineColor).toBe('#00ff00');
  });
});

describe('shapeStyleSeedFromUpdate', () => {
  let shapeStyleSeedFromUpdate;

  beforeEach(async () => {
    installStorage(makeStorage());
    ({ shapeStyleSeedFromUpdate } = await import(MODULE_PATH));
  });

  const entityWith = (data) => ({
    getAttribute: (name) => (name === 'shape' ? data : null)
  });

  // Every numeric here is deliberately NON-default (defaults are 0.15 / 40), so
  // a build that returned the entity's colours but cold-start numbers fails
  // rather than passing on two values that could not move.
  const fullData = {
    lineColor: '#ff0000',
    lineWidth: 0.4,
    fillColor: '#0000ff',
    fillOpacity: 25,
    fillMaterial: 'grass',
    fillTint: '#80c0ff',
    fillPattern: 'stripes',
    fillPatternOpacity: 60,
    fillPatternColor: '#ff00ff',
    fillPatternSpacing: 2.5,
    fillPatternWidth: 0.4,
    fillAngle: 30,
    fillOffsetAlong: 0.37,
    fillOffsetAcross: -1.2,
    closed: true,
    selectInside: true,
    updateEvent: ''
  };

  // The appearance values of `fullData`, i.e. what any seeding call on it must
  // return. Spelled out rather than asserted as "not null", which would also
  // pass against `undefined` or a partial object. Angle and Offset are not in
  // it: they belong to each shape.
  const fullSeed = {
    lineColor: '#ff0000',
    lineWidth: 0.4,
    fillColor: '#0000ff',
    fillOpacity: 25,
    fillMaterial: 'grass',
    fillTint: '#80c0ff',
    fillPattern: 'stripes',
    fillPatternOpacity: 60,
    fillPatternColor: '#ff00ff',
    fillPatternSpacing: 2.5,
    fillPatternWidth: 0.4
  };

  // The headline rule: the seed is the WHOLE shape, read off the entity, not
  // the property that was edited. An implementation that seeded from
  // detail.value returns the blue it was handed and fails here.
  it('snapshots the whole shape, not the edited property', () => {
    const seed = shapeStyleSeedFromUpdate(
      { component: 'shape', property: 'fillColor', value: '#0000ff' },
      entityWith(fullData)
    );
    expect(seed.lineColor).toBe('#ff0000');
    expect(seed).toEqual(fullSeed);
  });

  it('returns exactly the appearance keys, in a fresh object', () => {
    const data = { ...fullData };
    const seed = shapeStyleSeedFromUpdate(
      { component: 'shape', property: 'lineColor', value: '#ff0000' },
      entityWith(data)
    );
    expect(Object.keys(seed).sort()).toEqual(ALL_STYLE_KEYS);
    expect(seed).not.toBe(data);
  });

  it('seeds on each of the appearance properties', () => {
    for (const property of ALL_STYLE_KEYS) {
      expect(
        shapeStyleSeedFromUpdate(
          { component: 'shape', property },
          entityWith(fullData)
        )
      ).toEqual(fullSeed);
    }
  });

  it('seeds a pattern edit without the shape\u2019s Angle or Offset', () => {
    const seed = shapeStyleSeedFromUpdate(
      { component: 'shape', property: 'fillPattern', value: 'stripes' },
      entityWith(fullData)
    );
    expect(seed).toEqual(fullSeed);
    for (const key of ['fillAngle', 'fillOffsetAlong', 'fillOffsetAcross']) {
      expect(key in seed).toBe(false);
    }
  });

  // A whole-component write (the AI-chat route) leaves `property` empty, and
  // some emitters omit it entirely. Both are genuine appearance changes.
  it('seeds on a whole-component write', () => {
    expect(
      shapeStyleSeedFromUpdate(
        { component: 'shape', property: '', value: fullData },
        entityWith(fullData)
      )
    ).toEqual(fullSeed);
    expect(
      shapeStyleSeedFromUpdate({ component: 'shape' }, entityWith(fullData))
    ).toEqual(fullSeed);
  });

  // `AEntity.getAttribute` falls through to `HTMLElement.getAttribute` before
  // the component initialises and returns the raw attribute STRING. Seeding
  // from that would hand back full cold-start defaults, silently wiping the
  // user's preference.
  it('does not seed from a raw attribute string', () => {
    expect(
      shapeStyleSeedFromUpdate(
        { component: 'shape', property: 'lineColor' },
        entityWith('lineColor: #ff0000; fillOpacity: 40')
      )
    ).toBeNull();
  });

  it('does not seed on non-appearance properties of shape', () => {
    for (const property of [
      'closed',
      'selectInside',
      'updateEvent',
      'fillAngle',
      'fillOffsetAlong',
      'fillOffsetAcross'
    ]) {
      expect(
        shapeStyleSeedFromUpdate(
          { component: 'shape', property },
          entityWith(fullData)
        )
      ).toBeNull();
    }
  });

  it('does not seed on other components or malformed payloads', () => {
    expect(
      shapeStyleSeedFromUpdate(
        { component: 'position', property: 'x' },
        entityWith(fullData)
      )
    ).toBeNull();
    expect(
      shapeStyleSeedFromUpdate(
        { component: 'material', property: 'lineColor' },
        entityWith(fullData)
      )
    ).toBeNull();
    expect(
      shapeStyleSeedFromUpdate({ property: 'lineColor' }, entityWith(fullData))
    ).toBeNull();
    expect(
      shapeStyleSeedFromUpdate(undefined, entityWith(fullData))
    ).toBeNull();
    expect(shapeStyleSeedFromUpdate(null, entityWith(fullData))).toBeNull();
  });

  // Undoing an AI-added `shape` component removes it: the payload still looks
  // like a whole-component write, but there is no attribute left to read.
  // Without the bail this either throws inside a live event handler or
  // silently resets the preference to the cold-start defaults.
  it('does not seed when the shape component has been removed', () => {
    expect(
      shapeStyleSeedFromUpdate(
        { component: 'shape', property: '', value: null },
        entityWith(null)
      )
    ).toBeNull();
  });
});
