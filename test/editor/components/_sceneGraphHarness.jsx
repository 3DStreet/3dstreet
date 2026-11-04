import { act, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import SceneGraph from '@/editor/components/scenegraph/SceneGraph.jsx';

// Render helpers for layer panel tests: the panel as the editor renders it,
// and its rows found by name.

export const ROW_HEIGHT = 40;

// What the panel header reads from the STREET global (its menu asks for the
// current scene). A test stubs STREET with this, adding what it needs.
export const streetUtilsStub = () => ({ getCurrentSceneId: () => null });

export async function renderPanel(scene, selectedEntity = null, messages) {
  const view = render(
    <IntlProvider locale="en" messages={messages}>
      <SceneGraph scene={scene} selectedEntity={selectedEntity} />
    </IntlProvider>
  );
  await settle();
  return view;
}

// The panel rebuilds its row list on a zero-delay debounce.
export async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** The row showing `name`, as it is: no layout. */
export function findRow(name) {
  return screen.getByText(name).closest('.entity');
}

// jsdom lays nothing out: give a row, or the strip after the last row, the
// place it has in the list (rows 40 px tall, flush, in document order).
export function placeInList(el) {
  const hosts = [...document.querySelectorAll('.entity, .layers-drop-end')];
  const top = hosts.indexOf(el) * ROW_HEIGHT;
  Object.defineProperty(el, 'offsetTop', { configurable: true, value: top });
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    value: ROW_HEIGHT
  });
  return el;
}

/**
 * The row showing `name`, given its place in the list and a 200 px wide box
 * of its own at the top of the viewport, for drag tests. The box is the
 * element's own, so it shadows any prototype stub and stays with the element
 * when rows are re-keyed.
 */
export function row(name) {
  const el = placeInList(findRow(name));
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: ROW_HEIGHT,
    left: 0,
    right: 200,
    height: ROW_HEIGHT,
    width: 200
  });
  return el;
}
