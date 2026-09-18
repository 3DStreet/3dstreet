import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

const stockTitle = 'Translate Tool (t) - Select and move objects';
const combinedTitle = 'Transform Tool - move and rotate the selected object';

function mountBar() {
  return render(
    <IntlProvider locale="en">
      <ActionBar selectedEntity={null} />
    </IntlProvider>
  );
}

describe('easy gizmo readiness at the toolbar and keyboard', () => {
  beforeEach(() => {
    globalThis.AFRAME = {
      INSPECTOR: { opened: true },
      scenes: [{ canvas: { style: {} } }]
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.AFRAME;
  });

  it('keeps working stock controls until the controller is ready', () => {
    const onMode = vi.fn();
    Events.on('transformmodechange', onMode);
    const view = mountBar();
    expect(screen.queryByTitle(combinedTitle)).toBeNull();
    fireEvent.click(screen.getByTitle(stockTitle));
    expect(onMode).toHaveBeenLastCalledWith('translate');
    act(() => {
      globalThis.AFRAME.INSPECTOR.easyGizmoControls = {};
      Events.emit('easygizmoready');
    });
    expect(screen.getByTitle(combinedTitle)).toBeInTheDocument();
    expect(screen.queryByTitle(stockTitle)).toBeNull();
    view.unmount();
    Events.off('transformmodechange', onMode);
  });

  it('handles a controller which finished loading before the bar mounted', () => {
    globalThis.AFRAME.INSPECTOR.easyGizmoControls = {};
    mountBar();
    expect(screen.getByTitle(combinedTitle)).toBeInTheDocument();
  });

  it('does not leak the readiness listener after unmount', () => {
    const before = Events.listenerCount('easygizmoready');
    const view = mountBar();
    expect(Events.listenerCount('easygizmoready')).toBe(before + 1);
    view.unmount();
    expect(Events.listenerCount('easygizmoready')).toBe(before);
  });

  it('ignores m before readiness and enables it once loading succeeds', () => {
    const onMode = vi.fn();
    Events.on('transformmodechange', onMode);
    const key = { keyCode: 77, target: document.body };
    Shortcuts.onKeyUp(key);
    expect(onMode).not.toHaveBeenCalled();
    globalThis.AFRAME.INSPECTOR.easyGizmoControls = {};
    Shortcuts.onKeyUp(key);
    expect(onMode).toHaveBeenCalledExactlyOnceWith('easy');
    Events.off('transformmodechange', onMode);
  });
});
