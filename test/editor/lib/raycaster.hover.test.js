import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '@/editor/lib/Events';
import { initRaycaster } from '@/editor/lib/raycaster';

vi.mock('@/editor/lib/nav-experimental/flag.js', () => ({
  isStreetLevelNav: () => false
}));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/cascadingSelection.js', () => ({
  resolveClickSelection: (el) => el
}));
vi.mock('@/store', () => ({
  default: { getState: () => ({ isInspectorEnabled: true }) }
}));

// A stand-in for the cursor entity: initRaycaster only touches its raycaster
// and cursor components, its attributes and its listeners.
function fakeCursorEntity() {
  return {
    components: {
      raycaster: {
        intersections: [],
        objects: [],
        refreshObjects() {},
        checkIntersections() {}
      },
      cursor: { intersectedEl: null }
    },
    setAttribute() {},
    addEventListener() {}
  };
}

describe('raycaster hover when the cursor is hidden', () => {
  let cursor;
  let raycaster;
  let events;
  const onEnter = (el) => events.push(['enter', el]);
  const onLeave = (el) => events.push(['leave', el]);

  beforeEach(() => {
    events = [];
    cursor = fakeCursorEntity();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      tag === 'a-entity' ? cursor : createElement(tag)
    );
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    raycaster = initRaycaster({
      container,
      sceneEl: { appendChild() {}, canvas },
      selectedEntity: null,
      // The group scope controller with no group in the scene.
      groupScope: {
        hasGroupPickTargets: () => false,
        groupSelectedOrOpen: () => false,
        openElements: () => [],
        clearHover() {},
        hoverOpens: null,
        consumeDoubleClick: () => false
      }
    });
    Events.on('raycastermouseenter', onEnter);
    Events.on('raycastermouseleave', onLeave);
  });

  afterEach(() => {
    Events.off('raycastermouseenter', onEnter);
    Events.off('raycastermouseleave', onLeave);
    // Each mount registers its own hidecursor listener; drop them so one
    // test's hover cannot leak into the next.
    Events.removeAllListeners('hidecursor');
    vi.restoreAllMocks();
  });

  function hover(el) {
    cursor.components.cursor.intersectedEl = el;
    cursor.components.raycaster.checkIntersections();
  }

  it('leaves the hovered entity at once when the cursor is hidden', () => {
    const entity = { id: 'car' };
    hover(entity);
    expect(events).toEqual([['enter', entity]]);
    // Switching to the hand tool by keyboard: the pointer never leaves the
    // canvas and the disabled raycaster stops polling.
    Events.emit('hidecursor');
    expect(events).toEqual([
      ['enter', entity],
      ['leave', entity]
    ]);
    // Back on a move tool over the same entity, hover shows again.
    hover(entity);
    expect(events.at(-1)).toEqual(['enter', entity]);
  });

  it('leaves the hovered entity when the raycaster is disabled', () => {
    const entity = { id: 'car' };
    hover(entity);
    raycaster.disable();
    expect(events.at(-1)).toEqual(['leave', entity]);
  });

  it('emits nothing when nothing was hovered', () => {
    Events.emit('hidecursor');
    expect(events).toEqual([]);
  });
});
