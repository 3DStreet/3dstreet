import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import useStore from '@/store';
import {
  SHAPE_TOOL_DEFAULTS,
  SHAPE_TOOL_SETTINGS_ATTR,
  SNAP_STEPS
} from '@/editor/lib/shapeToolPrefs.js';
import {
  broadcastCollapseAll,
  isSectionCollapsed
} from '@/editor/lib/panelPrefs';
import {
  ShapeDisplayPrefControls,
  ShapeToolSection
} from '@/editor/components/elements/ShapeToolSection.jsx';

// A remembered collapse must not apply to this section: the panel opens to
// make it reachable. Reporting every named section as collapsed makes any
// use of that memory visible.
vi.mock('@/editor/lib/panelPrefs', async (importActual) => ({
  ...(await importActual()),
  isSectionCollapsed: vi.fn(() => true)
}));

const IDS = [
  'shapeTool.title',
  'shapeTool.displayHeading',
  'shapeTool.showLengths',
  'shapeTool.showArea',
  'shapeTool.showAngles',
  'shapeTool.snap',
  'shapeTool.snapOff',
  'shapeTool.snapStep',
  'shapeTool.alignToAxes',
  'shapeTool.alignToAxesHint',
  'shapeTool.openPanelOnSelect'
];

function mount(ui, messages) {
  return render(
    <IntlProvider locale="en" messages={messages}>
      {ui}
    </IntlProvider>
  );
}

// A preference row by its label: the BooleanWidget is the row's first child.
const rowOf = (label) => screen.getByText(label).closest('.propertyRow');
const toggle = (label) =>
  fireEvent.click(rowOf(label).querySelector('.checkboxAnim'));

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    shapeToolSettings: { ...SHAPE_TOOL_DEFAULTS },
    shapeDrawActive: true
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ shapeDrawActive: false });
  delete globalThis.AFRAME;
});

describe('the Shape Tool section', () => {
  it('shows only while the shape tool is active (fails if it shows whenever the panel is open)', () => {
    useStore.setState({ shapeDrawActive: false });
    const view = mount(<ShapeToolSection />);
    expect(document.querySelector('.shape-tool-section')).toBe(null);
    act(() => useStore.setState({ shapeDrawActive: true }));
    expect(document.querySelector('.shape-tool-section')).not.toBe(null);
    view.unmount();
  });

  it('takes every label and option from the catalog', () => {
    const messages = Object.fromEntries(IDS.map((id) => [id, `[[${id}]]`]));
    mount(<ShapeToolSection />, messages);
    const text = document.body.textContent;
    for (const id of IDS.filter((i) => i !== 'shapeTool.alignToAxesHint')) {
      expect(text).toContain(`[[${id}]]`);
    }
    expect(
      document.querySelector('[title="[[shapeTool.alignToAxesHint]]"]')
    ).not.toBe(null);
    // Nothing visible is left in English.
    const leftovers = text.replace(/\[\[[a-zA-Z.]+\]\]/g, '').trim();
    expect(leftovers).toBe('');
  });

  it('changes one shared value from either place, outside the undo history (fails on two stores, or a setting sent through a command)', () => {
    globalThis.AFRAME = {
      INSPECTOR: { execute: vi.fn(), history: { undos: [] } }
    };
    mount(
      <>
        <ShapeToolSection />
        <div data-testid="panel">
          <ShapeDisplayPrefControls />
        </div>
      </>
    );
    const panelRows = screen
      .getByTestId('panel')
      .querySelectorAll('.checkboxAnim');
    // Both start ticked, so the untick below is seen to change something.
    expect(panelRows[0].classList.contains('checked')).toBe(true);
    const sectionLengths = screen.getAllByText('Side lengths')[0];
    fireEvent.click(
      sectionLengths.closest('.propertyRow').querySelector('.checkboxAnim')
    );
    expect(useStore.getState().shapeToolSettings.showLengths).toBe(false);
    expect(panelRows[0].classList.contains('checked')).toBe(false);
    expect(globalThis.AFRAME.INSPECTOR.execute).not.toHaveBeenCalled();
    expect(globalThis.AFRAME.INSPECTOR.history.undos).toHaveLength(0);
    // Two copies of a row on screen: each checkbox keeps its own id, so a
    // label never activates the other copy's input.
    const ids = [...document.querySelectorAll('input[type="checkbox"]')].map(
      (input) => input.id
    );
    expect(ids.length).toBeGreaterThan(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('arrives expanded whatever the remembered collapse state (fails if it carries a section key)', () => {
    mount(<ShapeToolSection />);
    const content = () =>
      document.querySelector('.shape-tool-section .collapsible > .content');
    expect(content().classList.contains('hide')).toBe(false);
    act(() => broadcastCollapseAll(true));
    expect(content().classList.contains('hide')).toBe(false);
    expect(isSectionCollapsed).not.toHaveBeenCalled();
  });

  it('offers exactly the admissible steps and gives focus back after a pick (fails without the blur, or with the marker off the control)', () => {
    mount(<ShapeToolSection />);
    const select = screen.getByRole('combobox');
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toEqual(['Off', ...SNAP_STEPS.map((s) => `${s}°`)]);
    select.focus();
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: '60' } });
    expect(useStore.getState().shapeToolSettings.snapStep).toBe(60);
    expect(document.activeElement).not.toBe(select);
    expect(select.closest(`[${SHAPE_TOOL_SETTINGS_ATTR}]`)).not.toBe(null);
  });

  it('shows axis alignment as unavailable while snap is off', () => {
    mount(<ShapeToolSection />);
    const label = 'Align first side to axes';
    expect(rowOf(label).classList.contains('shape-tool-row--disabled')).toBe(
      true
    );
    toggle(label);
    expect(useStore.getState().shapeToolSettings.alignToAxes).toBe(false);

    act(() => useStore.getState().setShapeToolSetting('snapStep', 90));
    expect(rowOf(label).classList.contains('shape-tool-row--disabled')).toBe(
      false
    );
    toggle(label);
    expect(useStore.getState().shapeToolSettings.alignToAxes).toBe(true);
  });
});
