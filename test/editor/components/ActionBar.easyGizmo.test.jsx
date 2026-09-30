import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import Events from '@/editor/lib/Events';
import { ActionBar } from '@/editor/components/elements/ActionBar/ActionBar.component.jsx';
import { Shortcuts } from '@/editor/lib/shortcuts.js';

vi.mock('@/editor/lib/nav-experimental/flag.js', () => ({
  isWasdNav: () => false
}));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/entity', () => ({
  isManagedStreetSegment: () => false,
  removeSelectedEntity: vi.fn(),
  cloneSelectedEntity: vi.fn()
}));
vi.mock('@/editor/lib/clipboard', () => ({
  copySelectedEntity: vi.fn(),
  cutSelectedEntity: vi.fn(),
  pasteFromClipboard: vi.fn()
}));
vi.mock('@/editor/lib/utils', () => ({ getOS: () => 'Windows' }));
vi.mock('@/editor/components/elements/ActionBar/ShapeDrawAction.jsx', () => ({
  useShapeDrawTool: vi.fn()
}));
vi.mock('@/editor/components/elements', () => ({
  Button: 'button',
  UnitsPreference: () => null,
  UndoRedo: () => null
}));
vi.mock('@shared/icons', () => {
  const icon = (name) => {
    const Icon = () => <svg data-icon={name} />;
    Icon.displayName = `Icon(${name})`;
    return Icon;
  };
  return {
    Rotate24Icon: icon('rotate'),
    Translate24Icon: icon('translate'),
    EasyTransform24Icon: icon('easy'),
    ShapeDraw24Icon: icon('shape'),
    ZoomIn24Icon: icon('zoom-in'),
    ZoomOut24Icon: icon('zoom-out'),
    CameraReset24Icon: icon('camera-reset')
  };
});

const menuTitle =
  'Move tools (m) - Choose how to move and rotate the selected object';
const handTitle =
  'Hand Tool (h) - pan and rotate the view without selecting objects';

function mountBar() {
  return render(
    <IntlProvider locale="en">
      <ActionBar selectedEntity={null} />
    </IntlProvider>
  );
}

function key(keyCode) {
  Shortcuts.onKeyUp({ keyCode, target: document.body });
}

describe('move tools at the toolbar and keyboard', () => {
  let modes;
  const onMode = (mode) => modes.push(mode);

  beforeEach(() => {
    modes = [];
    globalThis.AFRAME = {
      INSPECTOR: { opened: true },
      scenes: [{ canvas: { style: {} } }]
    };
    Events.on('transformmodechange', onMode);
  });
  afterEach(() => {
    Events.off('transformmodechange', onMode);
    vi.unstubAllGlobals();
    delete globalThis.AFRAME;
  });

  it('renders the move tools menu on mount, with no separate mode buttons', () => {
    mountBar();
    const trigger = screen.getByTitle(menuTitle);
    expect(trigger.className).toMatch(/menuTrigger/);
    expect(trigger.querySelector('[data-icon="easy"]')).not.toBeNull();
    expect(
      screen.queryByTitle('Translate Tool (t) - Select and move objects')
    ).toBeNull();
    expect(
      screen.queryByTitle('Rotate Tool (e) - Select and rotate objects')
    ).toBeNull();
  });

  it('starts from the mode the viewport already holds', () => {
    globalThis.AFRAME.INSPECTOR.transformMode = 'rotate';
    mountBar();
    const trigger = screen.getByTitle(menuTitle);
    expect(trigger.querySelector('[data-icon="rotate"]')).not.toBeNull();
    key(77);
    expect(modes).toEqual(['easy']);
  });

  it('cycles the move tools in menu order with m', () => {
    mountBar();
    key(77);
    key(77);
    key(77);
    expect(modes).toEqual(['translate', 'rotate', 'easy']);
  });

  it('goes to Move with m from the hand tool', () => {
    mountBar();
    key(77);
    expect(modes).toEqual(['translate']);
    fireEvent.click(screen.getByTitle(handTitle));
    key(77);
    expect(modes).toEqual(['translate', 'easy']);
  });

  it('no longer picks a tool with t, e or w', () => {
    const onCycle = vi.fn();
    Events.on('transformmodecycle', onCycle);
    mountBar();
    for (const code of [84, 69, 87]) key(code);
    expect(modes).toEqual([]);
    expect(onCycle).not.toHaveBeenCalled();
    Events.off('transformmodecycle', onCycle);
  });

  it('lists Move, Advanced move and Advanced rotate, with no letters', () => {
    mountBar();
    fireEvent.keyDown(screen.getByTitle(menuTitle), { key: 'Enter' });
    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Move',
      'Advanced move',
      'Advanced rotate'
    ]);
  });
});
