import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import { refuseGuardedTransform } from '@/editor/lib/transformGuard.js';
import { SCALE_LINK_STORAGE_KEY } from '@/editor/lib/linkedScale.js';
import CommonComponents from '@/editor/components/elements/CommonComponents.jsx';
import { entity, group, scene } from '../lib/groups/_groupFixtures.js';

// The Transform section as the editor renders it: real rows and widgets, the
// real guard and History running the real entityupdate command, over entities
// built without A-Frame.

const HINT =
  'Position describes the group origin. On-canvas movement and rotation controls use the group center, which is distinct from the origin.';

let sceneEl;
let root;
let editor;
let executed;
let refusals;

// The single-property vec3 component A-Frame registers for position, rotation
// and scale, reduced to what the row and the command read.
function vec3Component(fill) {
  return {
    isSingleProperty: true,
    schema: {
      type: 'vec3',
      default: { x: fill, y: fill, z: fill },
      stringify: (v) => (typeof v === 'string' ? v : `${v.x} ${v.y} ${v.z}`)
    }
  };
}

beforeEach(() => {
  localStorage.clear();
  sceneEl = scene();
  root = entity(sceneEl);
  root.id = 'street-container';
  editor = { config: {}, selectedEntity: null, selectEntity: vi.fn() };
  editor.history = new History(editor);
  executed = [];
  refusals = [];
  editor.execute = (type, payload) => {
    executed.push([type, payload]);
    const refusal = refuseGuardedTransform(type, payload);
    if (refusal) {
      refusals.push(refusal);
      return;
    }
    const Cmd = commandsByType.get(type);
    editor.history.execute(new Cmd(editor, payload));
  };
  vi.stubGlobal('AFRAME', {
    components: {
      position: vec3Component(0),
      rotation: vec3Component(0),
      scale: vec3Component(1)
    },
    INSPECTOR: editor
  });
});

afterEach(() => {
  sceneEl.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

let ids = 0;

function show(el, messages = {}) {
  el.id = `panel-${++ids}`;
  // A-Frame answers a scale read from the live object; the fixture reads the attribute.
  if (!el.hasAttribute('scale')) el.setAttribute('scale', '1 1 1');
  return render(
    <IntlProvider locale="en" messages={messages} onError={() => {}}>
      <CommonComponents entity={el} />
    </IntlProvider>
  );
}

function scaleRow() {
  return screen.getByText('scale').closest('.propertyRow');
}

function scaleField(axis) {
  return within(scaleRow())
    .getByText(axis)
    .closest('.inputBlock')
    .querySelector('input');
}

function typeInto(input, text) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

const scaleUpdates = () =>
  executed.filter(
    ([type, p]) => type === 'entityupdate' && p.component === 'scale'
  );

describe('help under a group in the Transform section', () => {
  it('shows the sentence through its react-intl id for a group and not for an ordinary item', () => {
    const g = group(root);
    const { unmount } = show(g, {
      'sidebar.groupOriginHint': 'translated hint'
    });
    expect(screen.getByText('translated hint')).toBeTruthy();
    unmount();

    show(g);
    expect(screen.getByText(HINT)).toBeTruthy();
    unmount();
  });

  it('is absent for an ordinary entity', () => {
    show(entity(root));
    expect(screen.queryByText(HINT)).toBeNull();
    expect(document.querySelector('.group-origin-hint')).toBeNull();
  });
});

describe('a group scale edited in the panel', () => {
  it('stays uniform even when the stored link preference is off, and leaves that preference alone', () => {
    localStorage.setItem(SCALE_LINK_STORAGE_KEY, 'false');
    const g = group(root);
    show(g);

    expect(screen.queryByTestId('vec3-link')).toBeNull();
    typeInto(scaleField('x'), '3');

    expect(refusals).toEqual([]);
    expect(editor.history.undos).toHaveLength(1);
    expect(g.getAttribute('scale')).toEqual({ x: 3, y: 3, z: 3 });
    expect(localStorage.getItem(SCALE_LINK_STORAGE_KEY)).toBe('false');
  });

  it('leaves the preference as it was after a group is shown and then an ordinary item', () => {
    localStorage.setItem(SCALE_LINK_STORAGE_KEY, 'false');
    const first = show(group(root));
    first.unmount();
    show(entity(root));

    expect(localStorage.getItem(SCALE_LINK_STORAGE_KEY)).toBe('false');
    expect(screen.getByTestId('vec3-link').getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('shows an imported uneven group read-only, refuses edits, and resets it to uniform', () => {
    const g = group(root, { scale: [1, 2, 1] });
    g.setAttribute('scale', '1 2 1');
    show(g);

    for (const axis of ['x', 'y', 'z']) {
      expect(scaleField(axis).readOnly).toBe(true);
    }
    expect(scaleField('y').value).toBe('2.000');

    typeInto(scaleField('x'), '5');
    fireEvent.keyDown(scaleField('x'), { keyCode: 38 });
    expect(scaleUpdates()).toEqual([]);
    expect(g.getAttribute('scale')).toEqual({ x: 1, y: 2, z: 1 });

    const reset = within(scaleRow()).getByTestId('vec3-reset');
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(refusals).toEqual([]);
    expect(g.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('the Transform section of an ordinary entity', () => {
  it('keeps the link toggle, editable fields and linked scaling', () => {
    const el = entity(root);
    show(el);

    expect(document.querySelector('.group-origin-hint')).toBeNull();
    expect(scaleField('x').readOnly).toBe(false);
    expect(screen.getByTestId('vec3-link').getAttribute('aria-pressed')).toBe(
      'true'
    );

    typeInto(scaleField('x'), '2');
    expect(el.getAttribute('scale')).toEqual({ x: 2, y: 2, z: 2 });
    expect(refusals).toEqual([]);
  });

  it('still stores the link preference when its toggle is used, and then scales one axis alone', () => {
    const el = entity(root);
    show(el);

    fireEvent.click(screen.getByTestId('vec3-link'));
    expect(localStorage.getItem(SCALE_LINK_STORAGE_KEY)).toBe('false');
    typeInto(scaleField('y'), '4');
    expect(el.getAttribute('scale')).toEqual({ x: 1, y: 4, z: 1 });
    expect(refusals).toEqual([]);
  });
});
