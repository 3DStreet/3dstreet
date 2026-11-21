/* global THREE */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import useStore from '@/store';
import { SHAPE_TOOL_DEFAULTS } from '@/editor/lib/shapeToolPrefs.js';
import ShapeSidebar from '@/editor/components/elements/ShapeSidebar.jsx';

// The selected shape's panel pushes the display preferences to the on-canvas
// readouts and the area label. The readout layer is replaced by a recorder,
// so what the panel tells it is observable in order.

const calls = [];
vi.mock('@/editor/lib/ShapeReadouts', () => ({
  default: class {
    constructor() {
      this.instanceId = '1';
    }
    setUnits() {}
    setDisplay(display) {
      calls.push(['setDisplay', { ...display }]);
    }
    renderAll(vertices, cap, hover, closed, pinned, interaction, options) {
      calls.push(['renderAll', vertices.map((v) => v.clone()), options]);
    }
    dispose() {}
  }
}));

function vertexStub(x, z) {
  const object3D = new THREE.Object3D();
  object3D.position.set(x, 0, z);
  return { object3D, components: { 'shape-vertex': {} } };
}

// A shape entity the draw tool never made: only what the panel reads.
function shapeStub({ curveType = 'linear' } = {}) {
  const vertexEls = [vertexStub(0, 0), vertexStub(10, 0), vertexStub(10, 10)];
  const decoy = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(i, 0, i));
  const object3D = new THREE.Group();
  const entity = {
    object3D,
    children: [],
    components: {
      shape: {
        data: { closed: true, curveType, filletRadius: 0 },
        getVertexEls: () => vertexEls,
        _curvedRenderPoints: () => decoy,
        setAreaLabelVisible: vi.fn()
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getAttribute: () => null
  };
  return { entity, vertexEls };
}

const DISPLAY_IDS = [
  'shapeTool.displayHeading',
  'shapeTool.showLengths',
  'shapeTool.showArea',
  'shapeTool.showAngles',
  'shapeSidebar.tipInsertPlus'
];

function mount(entity, messages) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <ShapeSidebar entity={entity} />
    </IntlProvider>
  );
}

const areaLabel = (entity) =>
  entity.components.shape.setAreaLabelVisible.mock.calls.map(([v]) => v);

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  useStore.setState({ shapeToolSettings: { ...SHAPE_TOOL_DEFAULTS } });
  globalThis.AFRAME = {
    INSPECTOR: {},
    scenes: [{ canvas: document.createElement('canvas') }]
  };
});

afterEach(() => {
  cleanup();
  delete globalThis.AFRAME;
  localStorage.clear();
});

const setPref = (key, value) =>
  act(() => useStore.getState().setShapeToolSetting(key, value));

describe('a selected shape and the display preferences', () => {
  it('shows the area label only with the area preference on, and hides it on deselect (fails if the label is shown unconditionally)', () => {
    setPref('showArea', false);
    const off = shapeStub();
    const view = mount(off.entity);
    expect(areaLabel(off.entity)).not.toContain(true);
    expect(areaLabel(off.entity).at(-1)).toBe(false);
    view.unmount();

    setPref('showArea', true);
    const on = shapeStub();
    const view2 = mount(on.entity);
    expect(areaLabel(on.entity).at(-1)).toBe(true);
    view2.unmount();
    expect(areaLabel(on.entity).at(-1)).toBe(false);
  });

  it('keeps the side lengths and the area label independent (fails if one preference drives both)', () => {
    const { entity } = shapeStub();
    mount(entity);
    calls.length = 0;
    setPref('showLengths', false);
    expect(areaLabel(entity).at(-1)).toBe(true);
    setPref('showLengths', true);
    setPref('showArea', false);
    expect(areaLabel(entity).at(-1)).toBe(false);
    const lastDisplay = calls.filter(([name]) => name === 'setDisplay').at(-1);
    expect(lastDisplay[1].showLengths).toBe(true);
  });

  it('repaints the readouts and the label when a preference changes while selected (fails if nothing re-renders)', () => {
    const { entity } = shapeStub();
    mount(entity);
    calls.length = 0;
    setPref('showLengths', false);
    const display = calls.findIndex(
      ([name, arg]) => name === 'setDisplay' && arg.showLengths === false
    );
    expect(display).toBeGreaterThanOrEqual(0);
    expect(
      calls.slice(display + 1).some(([name]) => name === 'renderAll')
    ).toBe(true);
  });

  it('keeps the panel rows with the canvas readouts off, and labels its controls and tip from the catalog', () => {
    setPref('showLengths', false);
    setPref('showArea', false);
    const messages = Object.fromEntries(
      DISPLAY_IDS.map((id) => [id, `[[${id}]]`])
    );
    const { entity } = shapeStub();
    mount(entity, messages);
    // The Area row is still there to read the number from.
    expect(screen.getByText('50.00m²')).toBeTruthy();
    for (const id of DISPLAY_IDS) {
      expect(screen.getByText(`[[${id}]]`, { exact: false })).toBeTruthy();
    }
  });

  it('hands the readouts the control vertices, not a curve’s rendered points', () => {
    const { entity, vertexEls } = shapeStub({ curveType: 'smooth' });
    mount(entity);
    const rendered = calls.filter(([name]) => name === 'renderAll');
    expect(rendered.length).toBeGreaterThan(0);
    const vertices = rendered.at(-1)[1];
    expect(vertices).toHaveLength(3);
    vertices.forEach((v, i) =>
      expect(v.equals(vertexEls[i].object3D.position)).toBe(true)
    );
  });

  it.each([
    ['linear', true],
    ['smooth', false],
    ['arc', false]
  ])(
    'asks for corner angles on a %s shape: %s (fails if a curved shape gets angles)',
    (curveType, expected) => {
      setPref('showAngles', true);
      const { entity } = shapeStub({ curveType });
      mount(entity);
      const rendered = calls.filter(([name]) => name === 'renderAll');
      expect(rendered.at(-1)[2]).toEqual({ cornerAngles: expected });
    }
  );
});
