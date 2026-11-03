import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import Events from '@/editor/lib/Events.js';
import { History } from '@/editor/lib/history.js';
import { resolveCommand } from '@/editor/lib/resolveCommand.js';
import useStore from '@/store.js';
import { getAssetImageSrc } from '@/lazy-textures';
import { FILL_MATERIALS } from '@/tested/shape-fill.js';
import { ShapeStyleSectionControls } from '@/editor/components/elements/ShapeStyleSectionControls.jsx';
import { formatSurfaceOption } from '@/editor/components/elements/StreetSegmentSidebar.jsx';

// StreetSegmentSidebar is imported for the segment picker's own option
// formatter. Three of its imports cannot load in jsdom (JSX in .js files) and
// are not used by the formatter.
vi.mock('@/editor/components/elements/StreetSegmentComponent.jsx', () => ({
  default: () => null
}));
vi.mock('@/editor/components/elements/AddGeneratorComponent.js', () => ({
  default: () => null
}));
vi.mock('@/editor/components/elements/AdvancedComponents.jsx', () => ({
  default: () => null
}));

// The help sentences as the panel shows them, verbatim.
const HELP = {
  material: 'The surface of the shape.',
  materialOpacity:
    'How solid the surface is. 0% hides it; any pattern still shows.',
  pattern: 'Paint on top of the material.',
  patternOpacity: 'How solid the pattern is.',
  patternColor: 'Color of the stripes, squares or dots.',
  spacing: 'Distance between the centers of neighboring stripes or dots.',
  stripeWidth: 'Width of each stripe.',
  dotDiameter: 'Width of each dot.',
  squareSize: 'Width of one square.',
  tint: 'Colors the texture. White shows it as it is.',
  angle:
    "Direction of the pattern and texture. Set from the shape's first side when it was drawn; turns with the shape. Stripes and crosshatch run diagonally to it.",
  offset: 'Slides the pattern and texture along and across their direction.'
};

// The shape schema as the panel and the command layer read it: type, default,
// bounds and list, with A-Frame's parse/stringify for each type.
const num = (def, extra = {}) => ({
  type: 'number',
  default: def,
  parse: Number,
  stringify: String,
  ...extra
});
const int = (def, extra = {}) => ({
  type: 'int',
  default: def,
  parse: (v) => parseInt(v, 10),
  stringify: String,
  ...extra
});
const str = (def, extra = {}) => ({
  type: 'string',
  default: def,
  parse: String,
  stringify: String,
  ...extra
});
const color = (def) => ({ ...str(def), type: 'color' });
const bool = (def) => ({
  type: 'boolean',
  default: def,
  parse: (v) => v === true || v === 'true',
  stringify: String
});

const SCHEMA = {
  lineColor: color('#ffe600'),
  lineWidth: num(0.15, { min: 0 }),
  closed: bool(false),
  selectInside: bool(true),
  fillColor: color('#ffe600'),
  fillOpacity: int(40, { min: 0, max: 100 }),
  fillMaterial: str('solid', { oneOf: Object.keys(FILL_MATERIALS) }),
  fillTint: color('#ffffff'),
  fillPattern: str('none', {
    oneOf: ['none', 'stripes', 'crosshatch', 'checkerboard', 'dots']
  }),
  fillPatternOpacity: int(100, { min: 0, max: 100 }),
  fillPatternColor: color('#ffffff'),
  fillPatternSpacing: num(1, { min: 0.05 }),
  fillPatternWidth: num(0.15, { min: 0.01 }),
  fillAngle: num(0),
  fillOffsetAlong: num(0),
  fillOffsetAcross: num(0)
};

let seq = 0;

// A shape entity in the document with an id (the command layer finds it by
// id), whose setAttribute('shape', prop, value) writes the parsed value into
// its component data, as A-Frame's does.
function makeShape(over = {}) {
  const el = document.createElement('div');
  el.id = `shape-fixture-${++seq}`;
  const data = {};
  for (const [k, s] of Object.entries(SCHEMA)) data[k] = s.default;
  Object.assign(data, { closed: true }, over);
  el.isEntity = true;
  el.object3D = { uuid: `uuid-${seq}` };
  el.components = { shape: { data, schema: SCHEMA } };
  const nativeGet = el.getAttribute.bind(el);
  const nativeSet = el.setAttribute.bind(el);
  el.getAttribute = (name) => (name === 'shape' ? data : nativeGet(name));
  el.getDOMAttribute = (name) => (name === 'shape' ? data : nativeGet(name));
  el.setAttribute = (name, a, b) => {
    if (name === 'shape' && b !== undefined) {
      data[a] = SCHEMA[a].parse(b);
    } else {
      nativeSet(name, a);
    }
  };
  document.body.appendChild(el);
  return el;
}

let inspector;
let executed;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  executed = [];
  inspector = {
    selectedEntity: null,
    config: {},
    selectEntity: vi.fn()
  };
  inspector.history = new History(inspector);
  inspector.execute = (type, payload, name, callback) => {
    executed.push({ type, payload });
    const r = resolveCommand(type, payload, name, callback);
    return inspector.history.execute(
      new r.Cmd(inspector, r.payload, r.callback),
      r.optionalName
    );
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector, components: {} });
  vi.stubGlobal('STREET', { utils: { getCurrentSceneId: () => null } });
  useStore.setState({ unitsPreference: 'metric' });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel(entity) {
  return render(
    <IntlProvider locale="en">
      <ShapeStyleSectionControls entity={entity} />
    </IntlProvider>
  );
}

// Each row's visible label: the help trigger's text where there is one.
function rowLabels(container) {
  return [...container.querySelectorAll('.propertyRow > .text')].map((label) =>
    (label.querySelector('.fill-help-trigger') || label).textContent.trim()
  );
}

function rowByLabel(container, text) {
  return [...container.querySelectorAll('.propertyRow')].find(
    (row) =>
      (
        row.querySelector('.fill-help-trigger') || row.querySelector('.text')
      ).textContent.trim() === text
  );
}

function openSelect(container, property) {
  const input = container.querySelector(`#shape-fill-${property} input`);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 40 });
  return [...container.querySelectorAll('.select__option')];
}

function choose(container, property, label) {
  const option = openSelect(container, property).find(
    (o) => o.textContent === label
  );
  expect(option).toBeDefined();
  act(() => {
    fireEvent.click(option);
  });
}

function typeInto(container, property, text) {
  const input = container.querySelector(`#shape-fill-${property}`);
  act(() => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  });
}

const fillWrites = () =>
  executed.flatMap((e) =>
    e.type === 'multi' ? e.payload.map(([, p]) => p) : [e.payload]
  );

const LINE = ['Closed', 'Line color', 'Line width'];
const MAT = ['Fill material', 'Material opacity (%)'];
const PLACE = ['Angle', 'Offset along', 'Offset across'];
const PAT = ['Pattern opacity (%)', 'Pattern color'];

describe('the shape Style section', () => {
  it('shows the rows each choice needs, after the line rows', () => {
    const cases = [
      [{}, [...LINE, ...MAT, 'Color', 'Fill pattern']],
      [
        { fillMaterial: 'grass' },
        [...LINE, ...MAT, 'Tint', 'Fill pattern', ...PLACE]
      ],
      ...['stripes', 'crosshatch'].map((p) => [
        { fillPattern: p },
        [
          ...LINE,
          ...MAT,
          'Color',
          'Fill pattern',
          ...PAT,
          'Spacing',
          'Stripe width',
          ...PLACE
        ]
      ]),
      [
        { fillPattern: 'dots' },
        [
          ...LINE,
          ...MAT,
          'Color',
          'Fill pattern',
          ...PAT,
          'Spacing',
          'Dot diameter',
          ...PLACE
        ]
      ],
      [
        { fillPattern: 'checkerboard', fillMaterial: 'concrete' },
        [
          ...LINE,
          ...MAT,
          'Tint',
          'Fill pattern',
          ...PAT,
          'Square size',
          ...PLACE
        ]
      ]
    ];
    for (const [over, expected] of cases) {
      const { container, unmount } = renderPanel(makeShape(over));
      expect(container.firstChild.tagName).toBe('DIV');
      expect(
        container.firstChild.classList.contains('shape-style-controls')
      ).toBe(true);
      expect(rowLabels(container)).toEqual(expected);
      unmount();
    }
  });

  it('writes the shared values to their one property', () => {
    const entity = makeShape({ fillPattern: 'checkerboard' });
    const { container } = renderPanel(entity);
    typeInto(container, 'fillPatternSpacing', '3');
    expect(entity.components.shape.data.fillPatternSpacing).toBe(3);
    choose(container, 'fillPattern', 'Dots');
    typeInto(container, 'fillPatternWidth', '0.5');
    expect(entity.components.shape.data.fillPatternWidth).toBe(0.5);
    for (const material of ['Grass', 'Concrete', 'Sand']) {
      choose(container, 'fillMaterial', material);
      const before = executed.length;
      const input = container.querySelector('#shape-fill-fillTint');
      act(() => {
        fireEvent.change(input, { target: { value: '#ff0000' } });
        fireEvent.keyUp(input, { target: { value: '#ff0000' } });
      });
      const writes = executed.slice(before).map((e) => e.payload.property);
      expect(writes).toEqual(['fillTint']);
    }
  });
});

describe('choosing a texture raises the material opacity, once, undoably', () => {
  it('raises a Solid 40% to 100% in one undo step', () => {
    const entity = makeShape({ fillOpacity: 40 });
    const { container } = renderPanel(entity);
    choose(container, 'fillMaterial', 'Grass');
    const { data } = entity.components.shape;
    expect(data.fillMaterial).toBe('grass');
    expect(data.fillOpacity).toBe(100);
    expect(executed.map((e) => e.type)).toEqual(['multi']);
    expect(inspector.history.undos).toHaveLength(1);
    act(() => inspector.history.undo());
    expect(data.fillMaterial).toBe('solid');
    expect(data.fillOpacity).toBe(40);
  });

  it('leaves the opacity alone between textures and back to Solid', () => {
    for (const [from, to] of [
      ['concrete', 'Grass'],
      ['concrete', 'Solid color']
    ]) {
      const entity = makeShape({ fillMaterial: from, fillOpacity: 60 });
      const { container, unmount } = renderPanel(entity);
      executed = [];
      choose(container, 'fillMaterial', to);
      expect(entity.components.shape.data.fillOpacity).toBe(60);
      expect(executed.map((e) => e.type)).toEqual(['entityupdate']);
      unmount();
    }
  });

  it('makes one plain write when Solid is already at 100%', () => {
    const entity = makeShape({ fillOpacity: 100 });
    const { container } = renderPanel(entity);
    choose(container, 'fillMaterial', 'Grass');
    expect(executed.map((e) => e.type)).toEqual(['entityupdate']);
    expect(entity.components.shape.data.fillMaterial).toBe('grass');
  });

  it('treats an unknown stored material as Solid', () => {
    const entity = makeShape({ fillMaterial: 'asphalt', fillOpacity: 40 });
    const { container } = renderPanel(entity);
    choose(container, 'fillMaterial', 'Grass');
    expect(entity.components.shape.data.fillMaterial).toBe('grass');
    expect(entity.components.shape.data.fillOpacity).toBe(100);
  });
});

describe('switching a choice writes only that choice', () => {
  it('keeps every value the switch does not own', () => {
    const entity = makeShape({
      fillPattern: 'stripes',
      fillPatternSpacing: 2.5,
      fillPatternWidth: 0.4,
      fillTint: '#80c0ff',
      fillColor: '#336699',
      fillOpacity: 60
    });
    const { container } = renderPanel(entity);
    const step = (property, label, expectMulti = false) => {
      const before = executed.length;
      choose(container, property, label);
      const run = executed.slice(before);
      expect(run).toHaveLength(1);
      if (expectMulti) {
        expect(run[0].type).toBe('multi');
        expect(run[0].payload.map(([, p]) => p.property)).toEqual([
          'fillMaterial',
          'fillOpacity'
        ]);
      } else {
        expect(run[0].type).toBe('entityupdate');
        expect(run[0].payload.property).toBe(property);
      }
    };
    const shows = (label, value) =>
      expect(rowByLabel(container, label).querySelector('input').value).toBe(
        value
      );

    for (const p of ['None', 'Crosshatch', 'Checkerboard', 'Dots', 'Stripes']) {
      step('fillPattern', p);
    }
    shows('Spacing', '2.50');
    shows('Stripe width', '0.40');

    step('fillMaterial', 'Concrete', true);
    for (const m of [
      'Grass',
      'Sidewalk',
      'Gravel',
      'Sand',
      'Cracked asphalt',
      'Parking lot'
    ]) {
      step('fillMaterial', m);
      expect(container.querySelector('#shape-fill-fillTint').value).toBe(
        '#80c0ff'
      );
    }
    step('fillMaterial', 'Solid color');
    expect(container.querySelector('#shape-fill-fillColor').value).toBe(
      '#336699'
    );
    shows('Spacing', '2.50');
  });
});

describe('the Fill group heading and collapse state', () => {
  const content = (container) =>
    container.querySelector('.fill-subsection > .content');
  const header = (container) =>
    container.querySelector('.fill-subsection > .static');

  it('remembers a closed shape’s collapse; an open polyline always starts collapsed', () => {
    const a = renderPanel(makeShape());
    expect(content(a.container).classList.contains('hide')).toBe(false);
    expect(header(a.container).textContent).toBe('Fill');
    act(() => {
      fireEvent.click(header(a.container));
    });
    expect(content(a.container).classList.contains('hide')).toBe(true);
    a.unmount();

    const c = renderPanel(makeShape());
    expect(content(c.container).classList.contains('hide')).toBe(true);
    c.unmount();

    const b = renderPanel(makeShape({ closed: false }));
    expect(header(b.container).textContent).toBe('Fill (applies when closed)');
    expect(content(b.container).classList.contains('hide')).toBe(true);
    act(() => {
      fireEvent.click(header(b.container));
    });
    expect(content(b.container).classList.contains('hide')).toBe(false);
    b.unmount();

    const d = renderPanel(makeShape({ closed: false }));
    expect(content(d.container).classList.contains('hide')).toBe(true);
  });
});

describe('lengths follow Metric/Imperial', () => {
  it('shows and writes feet, rounded as other length fields', () => {
    useStore.setState({ unitsPreference: 'imperial' });
    const entity = makeShape({ fillPattern: 'stripes' });
    const { container } = renderPanel(entity);
    const spacing = container.querySelector('#shape-fill-fillPatternSpacing');
    expect(spacing.value).toBe('3.28');
    expect(rowByLabel(container, 'Spacing').textContent).toContain('ft');
    typeInto(container, 'fillPatternSpacing', '10');
    expect(entity.components.shape.data.fillPatternSpacing).toBe(3.048);
    // The minimum, in feet: typing 0 clamps to 0.05 m.
    typeInto(container, 'fillPatternSpacing', '0');
    expect(entity.components.shape.data.fillPatternSpacing).toBe(0.05);
    typeInto(container, 'fillOffsetAlong', '1');
    typeInto(container, 'fillOffsetAcross', '2');
    const writes = fillWrites().map((p) => p.property);
    expect(writes.slice(-2)).toEqual(['fillOffsetAlong', 'fillOffsetAcross']);
  });
});

describe('help text', () => {
  const rowsWithHelp = [
    ['Fill material', HELP.material],
    ['Material opacity (%)', HELP.materialOpacity],
    ['Fill pattern', HELP.pattern],
    ['Pattern opacity (%)', HELP.patternOpacity],
    ['Pattern color', HELP.patternColor],
    ['Spacing', HELP.spacing],
    ['Stripe width', HELP.stripeWidth],
    ['Angle', HELP.angle],
    ['Offset along', HELP.offset],
    ['Offset across', HELP.offset]
  ];

  it('gives every row one tab stop, described by the help', () => {
    const { container } = renderPanel(makeShape({ fillPattern: 'stripes' }));
    for (const [label, help] of rowsWithHelp) {
      const row = rowByLabel(container, label);
      expect(row).toBeDefined();
      const trigger = row.querySelector('.text .fill-help-trigger');
      expect(trigger.tagName).toBe('SPAN');
      expect(trigger.hasAttribute('tabindex')).toBe(false);
      expect(row.querySelector('.text label')).toBe(null);
      expect(row.querySelector('.text').hasAttribute('title')).toBe(false);
      const hidden = row.querySelector('.sr-only');
      expect(hidden.textContent).toBe(help);
      if (label.endsWith('(%)')) {
        expect(row.querySelector('.text').contains(hidden)).toBe(true);
      } else {
        const control = row.querySelector('input');
        expect(control.getAttribute('aria-describedby')).toBe(hidden.id);
      }
    }
    // The dot and square rows carry their own sentences.
    const dots = renderPanel(makeShape({ fillPattern: 'dots' }));
    expect(
      rowByLabel(dots.container, 'Dot diameter').querySelector('.sr-only')
        .textContent
    ).toBe(HELP.dotDiameter);
    const squares = renderPanel(
      makeShape({ fillPattern: 'checkerboard', fillMaterial: 'grass' })
    );
    expect(
      rowByLabel(squares.container, 'Square size').querySelector('.sr-only')
        .textContent
    ).toBe(HELP.squareSize);
    expect(
      rowByLabel(squares.container, 'Tint').querySelector('.sr-only')
        .textContent
    ).toBe(HELP.tint);
  });

  it('opens after a rest, and the next label waits again', () => {
    vi.useFakeTimers();
    const { container } = renderPanel(makeShape({ fillPattern: 'stripes' }));
    const tooltipWith = (text) =>
      [...document.querySelectorAll('[role="tooltip"]')].some(
        (t) => t.textContent === text
      );
    const trigger = (label) =>
      rowByLabel(container, label).querySelector('.fill-help-trigger');
    const advance = (ms) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    // A mouse resting on the label, as radix listens for it.
    const hover = (el) =>
      act(() => {
        fireEvent.pointerEnter(el, { pointerType: 'mouse' });
        fireEvent.pointerMove(el, { pointerType: 'mouse' });
      });
    // Leaving the label. jsdom has no layout for radix's "still heading for
    // the tooltip" grace area, so the tooltip is then dismissed with Escape,
    // which closes it by the same path.
    const unhover = (el) =>
      act(() => {
        fireEvent.pointerLeave(el, { pointerType: 'mouse' });
        fireEvent.keyDown(document, { key: 'Escape' });
      });

    hover(trigger('Fill material'));
    advance(100);
    expect(tooltipWith(HELP.material)).toBe(false);
    advance(350);
    expect(tooltipWith(HELP.material)).toBe(true);

    unhover(trigger('Fill material'));
    for (let i = 0; i < 20 && tooltipWith(HELP.material); i++) advance(100);
    expect(tooltipWith(HELP.material)).toBe(false);

    hover(trigger('Fill pattern'));
    advance(100);
    expect(tooltipWith(HELP.pattern)).toBe(false);
    advance(350);
    expect(tooltipWith(HELP.pattern)).toBe(true);
  });
});

describe('undo selection', () => {
  it('writes every Fill row the way the generic rows do', async () => {
    const entity = makeShape({ fillPattern: 'stripes', fillMaterial: 'grass' });
    const { container } = renderPanel(entity);
    choose(container, 'fillMaterial', 'Concrete');
    choose(container, 'fillPattern', 'Dots');
    for (const property of [
      'fillPatternSpacing',
      'fillPatternWidth',
      'fillAngle',
      'fillOffsetAlong',
      'fillOffsetAcross'
    ]) {
      typeInto(container, property, '1.5');
    }
    for (const property of ['fillTint', 'fillPatternColor']) {
      const input = container.querySelector(`#shape-fill-${property}`);
      act(() => {
        fireEvent.change(input, { target: { value: '#123456' } });
        fireEvent.keyUp(input, { target: { value: '#123456' } });
      });
    }
    for (const property of ['fillOpacity', 'fillPatternOpacity']) {
      const slider = container.querySelector(`#shape-fill-${property}`);
      fireEvent.change(slider, { target: { value: '30' } });
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    const writes = fillWrites();
    expect(writes).toHaveLength(11);
    expect(writes.map((p) => p.property).sort()).toEqual(
      [
        'fillMaterial',
        'fillPattern',
        'fillPatternSpacing',
        'fillPatternWidth',
        'fillAngle',
        'fillOffsetAlong',
        'fillOffsetAcross',
        'fillTint',
        'fillPatternColor',
        'fillOpacity',
        'fillPatternOpacity'
      ].sort()
    );
    for (const p of writes) expect(p.noSelectEntity).toBeFalsy();
  });
});

describe('refreshing from outside the panel', () => {
  it('follows writes it did not make', () => {
    const entity = makeShape({ closed: false });
    const { container } = renderPanel(entity);
    expect(rowByLabel(container, 'Spacing')).toBeUndefined();
    entity.components.shape.data.fillPattern = 'stripes';
    act(() => {
      Events.emit('entityupdate', { entity, component: 'shape' });
    });
    expect(rowByLabel(container, 'Spacing')).toBeDefined();
    entity.components.shape.data.closed = true;
    act(() => {
      Events.emit('entityupdate', { entity, component: 'shape' });
    });
    expect(
      container.querySelector('.fill-subsection > .static').textContent
    ).toBe('Fill');
  });
});

describe('swatches', () => {
  beforeEach(() => {
    const img = document.createElement('img');
    img.id = 'grass-texture';
    img.setAttribute('src', 'https://example.invalid/grass.png');
    document.body.appendChild(img);
  });

  it('draws Solid color in the shape’s colour and textures from their asset', () => {
    const { container } = renderPanel(makeShape({ fillColor: '#336699' }));
    const options = openSelect(container, 'fillMaterial');
    const solid = options.find((o) => o.textContent === 'Solid color');
    expect(solid.querySelector('.surface-swatch').style.background).toBe(
      'rgb(51, 102, 153)'
    );
    const grass = options.find((o) => o.textContent === 'Grass');
    expect(grass.querySelector('img.surface-swatch').getAttribute('src')).toBe(
      getAssetImageSrc(document.getElementById(FILL_MATERIALS.grass.textureId))
    );
  });

  it('leaves the segment Material dropdown’s options exactly as they were', () => {
    // Captured from the segment picker before its swatch renderer was shared.
    expect(
      renderToStaticMarkup(
        formatSurfaceOption({ value: 'grass', label: 'grass' })
      )
    ).toBe(
      '<span class="surface-option"><img class="surface-swatch" src="https://example.invalid/grass.png" alt=""/>grass</span>'
    );
    expect(
      renderToStaticMarkup(
        formatSurfaceOption({ value: 'solid', label: 'solid' })
      )
    ).toBe(
      '<span class="surface-option"><span class="surface-swatch" style="background:#dddddd"></span>solid</span>'
    );
  });
});
