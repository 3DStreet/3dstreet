/* global AFRAME */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import Events from '@/editor/lib/Events.js';
import { ActionBar } from '@/editor/components/elements/ActionBar/ActionBar.component.jsx';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { defineEntityElement } from '../lib/groups/_entityElement.js';
import { group, mountEditor, solid } from '../lib/groups/_editorHarness.js';

// Drawing a shape while a group is open: the real toolbar, shape tool,
// commands and scope controller. A shape keeps its place at the top level
// (shapes never change parent), so it lands outside the group and the user is
// told so.

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => false,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
      setCamera() {}
      focus() {}
      navigateDoubleClick() {}
      newSceneCameraZoom() {}
    }
  };
});

defineEntityElement();

let editor;
let notify;
const onHideCursor = () => editor.inspector.selectEntity(null);

beforeEach(() => {
  editor = mountEditor({ gizmo: true });
  // The shape tool works on the scene and its canvas, as A-Frame's scene.
  AFRAME.scenes[0] = editor.sceneEl;
  editor.sceneEl.camera = editor.camera;
  editor.inspector.config.defaultParent = '#street-container';
  editor.camera.position.set(0, 30, 40);
  editor.camera.lookAt(0, 0, 0);
  editor.camera.updateMatrixWorld();
  // As the inspector does when a tool takes the cursor (index.jsx).
  Events.on('hidecursor', onHideCursor);
  notify = { infoMessage: vi.fn(), warningMessage: vi.fn() };
  vi.stubGlobal('STREET', { notify });
});

afterEach(() => {
  Events.off('hidecursor', onHideCursor);
  cleanup();
  editor.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function click(canvas, x, y) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y });
}

describe('drawing a shape with a group open', () => {
  it('keeps the group open when the tool is picked, and puts the shape at the top level with a notice (fails if picking the tool closes the group, or the shape is put in the group)', () => {
    const { inspector, streetContainer } = editor;
    const outer = group(streetContainer, { id: 'outer' });
    const member = solid(outer, [0, 0, 0], [2, 2, 2], { id: 'member' });
    inspector.groupScope.open(outer);
    inspector.selectEntity(member);
    expect(editor.openIds()).toEqual(['outer']);

    render(
      <IntlProvider locale="en">
        <ActionBar selectedEntity={member} />
      </IntlProvider>
    );
    fireEvent.click(screen.getByTitle(/^Shape Tool/));

    // Picking the tool clears the selection; the group stays open.
    expect(inspector.selectedEntity).toBe(null);
    expect(editor.openIds()).toEqual(['outer']);

    const canvas = editor.sceneEl.canvas;
    click(canvas, 500, 500);
    click(canvas, 700, 520);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });

    const shape = streetContainer.querySelector(':scope > [shape]');
    expect(shape).not.toBe(null);
    expect(outer.querySelector('[shape]')).toBe(null);
    expect(inspector.history.undos).toHaveLength(1);
    expect(notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('placedAtTopLevel')
    );
  });
});
