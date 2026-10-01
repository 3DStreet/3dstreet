import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import { captureNavDiscovery } from '@/editor/lib/navAnalytics.js';
import { group, item, mountEditor, solid } from './_editorHarness.js';

const flags = vi.hoisted(() => ({ streetLevel: false }));

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/flag.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isStreetLevelNav: () => flags.streetLevel
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => flags.streetLevel,
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

// Clicks on the canvas with user groups in the scene, through the real
// raycaster, viewport, scope controller and shortcuts (see _editorHarness).
// Every box is 1 m tall and the cursor ray points straight down, so a group's
// box and its members' tops are the same distance away.

let h;
let focused;
let teleported;
const onFocus = (object) => focused.push(object);
const onTeleport = (payload) => teleported.push(payload);

beforeEach(() => {
  h = mountEditor();
  focused = [];
  teleported = [];
  Events.on('objectfocus', onFocus);
  Events.on('nav-experimental:doubleclick', onTeleport);
});

afterEach(() => {
  // First, while the editor is still mounted: its store subscribers run.
  useStore.setState({ isInspectorEnabled: true, osmWayCandidate: null });
  h.dispose();
  Events.removeAllListeners();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  flags.streetLevel = false;
  vi.clearAllMocks();
});

const selected = () => h.inspector.selectedEntity;

// A ⊃ B ⊃ C ⊃ {tree, tree2}, plus a1 in A, b1 in B, and an item outside.
// Group boxes (x by z): C [4,7]x[4,5], B [4,7]x[0,5], A [0,7]x[0,5].
const TREE = [4.5, 4.5];
const INSIDE_C_EMPTY = [5.5, 4.5];
const A1 = [0.5, 0.5];
const OUT = [20.5, 0.5];
const GROUND = [40, 40];

function nestedScene() {
  const sc = h.streetContainer;
  const A = group(sc, { id: 'A' });
  const a1 = solid(A, [0, 0, 0], [1, 1, 1], { id: 'a1' });
  const B = group(A, { id: 'B' });
  const b1 = solid(B, [4, 0, 0], [5, 1, 1], { id: 'b1' });
  const C = group(B, { id: 'C' });
  const tree = solid(C, [4, 0, 4], [5, 1, 5], { id: 'tree' });
  const tree2 = solid(C, [6, 0, 4], [7, 1, 5], { id: 'tree2' });
  const outside = solid(sc, [20, 0, 0], [21, 1, 1], { id: 'outside' });
  h.frame();
  return { A, a1, B, b1, C, tree, tree2, outside };
}

describe('the selection and open-group rules', () => {
  it('walks every rule of the table: select, open with nothing selected, select inside, clear inside, leave one level selecting the group left, close', () => {
    const { A, B, C, tree, outside } = nestedScene();

    h.aimDown(...TREE);
    h.click();
    // Closed, unselected: the member's click selects the group only.
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);
    h.click();
    // Closed, selected: its box opens it, and an open group is not selected.
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A']);
    h.click();
    // Parent open, child group closed: the child is selected, closed.
    expect(selected()).toBe(B);
    expect(h.openIds()).toEqual(['A']);
    h.click();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A', 'B']);
    h.click();
    expect(selected()).toBe(C);
    h.click();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);
    h.click();
    // Open: an immediate ordinary member is selected, the scope kept.
    expect(selected()).toBe(tree);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);

    // Member selected, empty space inside the scope: nothing is selected and
    // the scope is kept (the open group itself is never reselected).
    h.aimDown(...INSIDE_C_EMPTY);
    h.click();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);

    // Nested: a click outside the box leaves one level and selects the group
    // left, closed, and nothing else, even with an item under the cursor.
    h.aimDown(...A1);
    h.click();
    expect(selected()).toBe(C);
    expect(h.openIds()).toEqual(['A', 'B']);
    // Escape leaves one level the same way, the outermost one included.
    h.escape();
    expect(selected()).toBe(B);
    expect(h.openIds()).toEqual(['A']);
    h.escape();
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);
    // With nothing open, Escape clears the selection as usual.
    h.escape();
    expect(selected()).toBe(null);

    // Outermost: empty space outside leaves the group and selects it, closed.
    h.aimDown(...TREE);
    h.click();
    h.click();
    expect(h.openIds()).toEqual(['A']);
    h.aimDown(...GROUND);
    h.click();
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);

    // Outermost: an outside item closes every group and is selected as usual.
    h.aimDown(...TREE);
    h.click();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['A']);
    h.aimDown(...OUT);
    h.click();
    expect(selected()).toBe(outside);
    expect(h.openIds()).toEqual([]);
  });

  it('steps out of an open empty group through its marker and selects it, also behind a nearer outside object, and previews that on the marker (fails if the marker is taken for empty space inside, or the nearest hit decides)', () => {
    const A = group(h.streetContainer, { id: 'A' });
    solid(A, [0, 0, 0], [1, 1, 1], { id: 'a1' });
    solid(A, [4, 0, 4], [5, 1, 5], { id: 'a2' });
    const E = group(A, { id: 'E', position: [2.5, 0.5, 2.5] });
    h.frame();
    h.inspector.selectEntity(E);
    h.aimDown(2.5, 2.5);
    h.click();
    expect(h.openIds()).toEqual(['A', 'E']);
    expect(selected()).toBe(null);
    h.poll();
    expect(h.groupScope.affordances.hoveredMarkerGroup).toBe(E);
    h.click();
    expect(selected()).toBe(E);
    expect(h.openIds()).toEqual(['A']);

    // Again with an outside object above the marker, outside A's box.
    solid(h.streetContainer, [2, 3, 2], [3, 4, 3], { id: 'over' });
    h.frame();
    h.groupScope.open(E);
    expect(h.openIds()).toEqual(['A', 'E']);
    expect(selected()).toBe(null);
    h.poll();
    expect(h.groupScope.affordances.hoveredMarkerGroup).toBe(E);
    h.click();
    expect(selected()).toBe(E);
    expect(h.openIds()).toEqual(['A']);
  });

  it('leaves only the innermost level on an outside click three levels deep, selecting the group left', () => {
    const { C, tree } = nestedScene();
    h.inspector.selectEntity(tree);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);
    h.aimDown(...OUT);
    h.click();
    expect(selected()).toBe(C);
    expect(h.openIds()).toEqual(['A', 'B']);
  });

  it('resolves one press once: the click that opens a group does not also select inside it', () => {
    const { A } = nestedScene();
    h.inspector.selectEntity(A);
    h.aimDown(...TREE);
    h.click();
    expect(h.openIds()).toEqual(['A']);
    expect(selected()).toBe(null);
  });

  describe('one physical click, resolved once', () => {
    // The raycaster's container listener and the cursor's run in the order
    // they were added, which differs between a freshly opened editor and one
    // back from the Viewer; each click here must do one step in either.
    function remount(cursorFirst) {
      h.dispose();
      Events.removeAllListeners();
      document.body.replaceChildren();
      h = mountEditor({ cursorFirst });
      Events.on('objectfocus', onFocus);
      Events.on('nav-experimental:doubleclick', onTeleport);
    }

    it.each([
      ['the raycaster first', false],
      ['the cursor first', true]
    ])(
      'takes one step per click with %s, for groups and for ordinary items (a double resolution opens and selects inside in one click)',
      (_, cursorFirst) => {
        remount(cursorFirst);
        const { B, outside } = nestedScene();
        h.aimDown(...TREE);
        const steps = [];
        for (let i = 0; i < 4; i++) {
          h.click();
          steps.push([selected()?.id ?? null, h.openIds().join('')]);
        }
        expect(steps).toEqual([
          ['A', ''],
          [null, 'A'],
          ['B', 'A'],
          [null, 'AB']
        ]);

        // One level out per outside click, selecting the group left, then
        // ordinary selection.
        h.aimDown(...OUT);
        h.click();
        expect(h.openIds()).toEqual(['A']);
        expect(selected()).toBe(B);
        h.click();
        expect(h.openIds()).toEqual([]);
        expect(selected()).toBe(outside);
        // No groups in play: an ordinary click selects, empty ground deselects.
        h.inspector.selectEntity(null);
        h.click();
        expect(selected()).toBe(outside);
        h.aimDown(...GROUND);
        h.click();
        expect(selected()).toBe(null);
      }
    );

    it('takes one step per touch tap, which reaches only the cursor, also right after a mouse click', () => {
      const { A, B } = nestedScene();
      h.aimDown(...TREE);
      // A mouse click first: the tap that follows must not be taken for part of it.
      h.click();
      expect(selected()).toBe(A);
      h.tap();
      expect(h.openIds()).toEqual(['A']);
      expect(selected()).toBe(null);
      h.tap();
      expect(selected()).toBe(B);
      expect(h.openIds()).toEqual(['A']);
    });
  });

  it('lets a member be clicked through a nearer outside object', () => {
    const { a1 } = nestedScene();
    // Floating above a1, outside A's box (which is 1 m tall).
    solid(h.streetContainer, [0, 3, 0], [1, 4, 1], { id: 'over' });
    h.frame();
    h.groupScope.open(h.sceneEl.querySelector('#A'));
    expect(h.openIds()).toEqual(['A']);
    h.aimDown(...A1);
    h.click();
    expect(selected()).toBe(a1);
  });

  it('follows a layer-panel selection: a descendant opens every group around it, a group is selected closed even when it was open, with its handles back, and outside closes', () => {
    const { A, B, tree, outside } = nestedScene();
    h.inspector.selectEntity(tree);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);
    h.inspector.selectEntity(outside);
    expect(h.openIds()).toEqual([]);
    h.inspector.selectEntity(B);
    expect(h.openIds()).toEqual(['A']);
    // An open group selected from the panel closes: an open group is never
    // itself selected.
    h.groupScope.open(B);
    expect(h.openIds()).toEqual(['A', 'B']);
    expect(selected()).toBe(null);
    expect(h.inspector.easyGizmoControls.el).toBeUndefined();
    h.inspector.selectEntity(B);
    expect(selected()).toBe(B);
    expect(h.openIds()).toEqual(['A']);
    expect(h.inspector.easyGizmoControls.el).toBe(B);
    // Selecting the outer group, or an outside item, closes everything.
    h.groupScope.open(B);
    h.inspector.selectEntity(A);
    expect(h.openIds()).toEqual([]);
    h.groupScope.open(B);
    h.inspector.selectEntity(outside);
    expect(h.openIds()).toEqual([]);
  });

  it('keeps the scope when an item created inside it is selected, and when the selection is cleared', () => {
    const { A, a1 } = nestedScene();
    h.inspector.selectEntity(a1);
    const created = solid(A, [2, 0, 2], [3, 1, 3], { id: 'created' });
    h.inspector.selectEntity(created);
    expect(h.openIds()).toEqual(['A']);
    // A tool switch clears the selection and keeps the groups open.
    h.inspector.selectEntity(null);
    expect(h.openIds()).toEqual(['A']);
    h.aimDown(...A1);
    h.click();
    expect(selected()).toBe(a1);
    expect(h.openIds()).toEqual(['A']);
  });
});

describe('nested drilling and exit', () => {
  function drillScene() {
    const A = group(h.streetContainer, { id: 'A' });
    const B = group(A, { id: 'B' });
    const tree = solid(B, [0, 0, 0], [1, 1, 1], { id: 'tree' });
    solid(h.streetContainer, [10, 0, 0], [11, 1, 1], { id: 'outside' });
    h.frame();
    h.aimDown(0.5, 0.5);
    return { A, B, tree };
  }

  it('drills with separate clicks, and just as well at double-click speed, without moving the camera, and Escape leaves one level at a time selecting the group left', () => {
    // Under street-level navigation a double-click teleports whatever is
    // selected, so only the drilling latch keeps the camera still here.
    flags.streetLevel = true;
    const { A, B, tree } = drillScene();
    for (let i = 0; i < 5; i++) h.click();
    expect(selected()).toBe(tree);
    expect(h.openIds()).toEqual(['A', 'B']);
    h.escape();
    expect(selected()).toBe(B);
    expect(h.openIds()).toEqual(['A']);
    h.escape();
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);
    h.escape();
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual([]);

    // Quickly: the browser counts the clicks at one spot up and fires a
    // dblclick after every second one.
    for (let detail = 1; detail <= 5; detail++) {
      h.click({ detail });
      if (detail === 2) {
        expect(selected()).toBe(null);
        expect(h.openIds()).toEqual(['A']);
      }
      if (detail === 2 || detail === 4) h.dblclick();
    }
    expect(selected()).toBe(tree);
    expect(h.openIds()).toEqual(['A', 'B']);
    expect(focused).toEqual([]);
    expect(teleported).toEqual([]);
  });
});

describe('the double-click that enters a group', () => {
  function scene() {
    const G = group(h.streetContainer, { id: 'G' });
    const member = solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    const other = solid(h.streetContainer, [10, 0, 0], [11, 1, 1], {
      id: 'other'
    });
    h.frame();
    h.aimDown(0.5, 0.5);
    return { G, member, other };
  }

  it('does not move the camera after a select-and-open double-click (fails if opening does not latch the double-click)', () => {
    // Nothing is selected after the open, so there is nothing to frame; under
    // street-level navigation the double-click would teleport.
    flags.streetLevel = true;
    scene();
    h.click({ detail: 1 });
    h.click({ detail: 2 });
    h.dblclick();
    expect(h.openIds()).toEqual(['G']);
    expect(selected()).toBe(null);
    expect(focused).toEqual([]);
    expect(teleported).toEqual([]);
  });

  it('does not frame after an open-and-select-member double-click on a selected group', () => {
    const { G, member } = scene();
    h.inspector.selectEntity(G);
    h.click({ detail: 1 });
    h.click({ detail: 2 });
    h.dblclick();
    expect(selected()).toBe(member);
    expect(h.openIds()).toEqual(['G']);
    expect(focused).toEqual([]);
  });

  it('frames as usual once a fresh click has started a new gesture', () => {
    const { G, member } = scene();
    h.inspector.selectEntity(G);
    h.click({ detail: 1 });
    h.click({ detail: 1 });
    h.dblclick();
    expect(selected()).toBe(member);
    expect(focused).toEqual([member.object3D]);
  });

  // A double-click whose second click moves a pixel resolves nothing on that
  // second click, so what the dblclick does rests on the first. The next two
  // tests record how that differs today by whether group rules resolved the
  // first click; which of the two is wanted is an open question.
  it('does not frame when the second click jitters, after a first click that selected the closed group while another group was selected (fails if selecting a closed group does not start the entering gesture)', () => {
    const { G } = scene();
    const H = group(h.streetContainer, { id: 'H' });
    solid(H, [20, 0, 0], [21, 1, 1], { id: 'hm' });
    h.frame();
    h.inspector.selectEntity(H);
    h.aimDown(0.5, 0.5);
    h.click({ detail: 1 });
    expect(selected()).toBe(G);
    expect(h.openIds()).toEqual([]);
    h.drag(1, { detail: 2 });
    expect(selected()).toBe(G);
    expect(h.openIds()).toEqual([]);
    h.dblclick();
    expect(focused).toEqual([]);
  });

  it('frames the group when the second click jitters, after a first click that selected it with nothing selected before (the ordinary route starts no entering gesture)', () => {
    const { G } = scene();
    h.click({ detail: 1 });
    expect(selected()).toBe(G);
    h.drag(1, { detail: 2 });
    expect(selected()).toBe(G);
    expect(h.openIds()).toEqual([]);
    h.dblclick();
    expect(focused).toEqual([G.object3D]);
  });

  it('frames as usual once something else selected the entity', () => {
    const { G, other } = scene();
    h.inspector.selectEntity(G);
    h.click();
    expect(h.openIds()).toEqual(['G']);
    h.inspector.selectEntity(other);
    h.dblclick();
    expect(focused).toEqual([other.object3D]);
  });

  it('forgets the entering click when the window loses focus', () => {
    // Under street-level navigation, so the double-click has something to do
    // with nothing selected after the open: it teleports.
    flags.streetLevel = true;
    const { G } = scene();
    h.inspector.selectEntity(G);
    h.click();
    expect(selected()).toBe(null);
    window.dispatchEvent(new Event('blur'));
    h.dblclick();
    expect(teleported).toHaveLength(1);
  });

  it('under street-level navigation opens a closed group instead of teleporting, and teleports inside it', () => {
    flags.streetLevel = true;
    const G = group(h.streetContainer, { id: 'G' });
    const street = item(G, { id: 'street' });
    const lane = solid(street, [0, 0, 0], [3, 0.2, 10], { id: 'lane' });
    h.frame();
    h.aimDown(1, 5);
    h.click({ detail: 1 });
    h.click({ detail: 2 });
    h.dblclick();
    expect(h.openIds()).toEqual(['G']);
    expect(selected()).toBe(null);
    expect(teleported).toEqual([]);

    h.click({ detail: 1 });
    h.click({ detail: 2 });
    h.dblclick();
    expect(selected()).toBe(lane);
    expect(teleported).toHaveLength(1);
  });
});

describe('the magenta hover of a selected closed group', () => {
  it('shows over the box and clears on blur, on a selection change and on opening', () => {
    const G = group(h.streetContainer, { id: 'G' });
    solid(G, [0, 0, 0], [1, 1, 1], { id: 'member' });
    h.frame();
    h.inspector.selectEntity(G);
    h.aimDown(0.5, 0.5);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(h.groupHoverBox.visible).toBe(false);

    h.poll();
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    // Clearing the selection (as a tool switch does) hides it.
    h.inspector.selectEntity(null);
    expect(h.groupHoverBox.visible).toBe(false);

    h.inspector.selectEntity(G);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    h.click();
    expect(h.openIds()).toEqual(['G']);
    expect(h.groupHoverBox.visible).toBe(false);
  });
});

describe('reconciling the open groups', () => {
  it('drops a deleted group, and closes on a new scene and on leaving the editor', () => {
    const { A, B, a1, tree } = nestedScene();
    h.inspector.selectEntity(tree);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);
    h.inspector.execute('entityremove', B);
    expect(h.openIds()).toEqual(['A']);
    const open = h.groupScope.openElements();
    expect(open).toEqual([A]);
    expect(open.every((el) => el.isConnected)).toBe(true);

    h.sceneEl.dispatchEvent(new CustomEvent('newScene'));
    expect(h.openIds()).toEqual([]);

    h.inspector.selectEntity(null);
    h.inspector.selectEntity(a1);
    expect(h.openIds()).toEqual(['A']);
    useStore.getState().setIsInspectorEnabled(false);
    expect(h.openIds()).toEqual([]);
  });

  it('closes a group hidden from the layer panel, keeps it selected, and does not reopen it when shown', () => {
    const { A, a1 } = nestedScene();
    h.inspector.selectEntity(a1);
    expect(h.openIds()).toEqual(['A']);
    h.inspector.execute('entityupdate', {
      entity: A,
      component: 'visible',
      value: false
    });
    expect(h.openIds()).toEqual([]);
    expect(selected()).toBe(A);
    h.inspector.execute('entityupdate', {
      entity: A,
      component: 'visible',
      value: true
    });
    expect(h.openIds()).toEqual([]);
  });

  it('reopens the editor closed, with a member selected at exit replaced by its outermost group', () => {
    const { A, tree } = nestedScene();
    h.inspector.selectEntity(tree);
    expect(h.openIds()).toEqual(['A', 'B', 'C']);
    useStore.getState().setIsInspectorEnabled(false);
    expect(h.openIds()).toEqual([]);
    expect(h.inspector.opened).toBe(false);
    useStore.getState().setIsInspectorEnabled(true);
    expect(h.inspector.opened).toBe(true);
    expect(selected()).toBe(A);
    expect(h.openIds()).toEqual([]);
  });
});

describe('ordinary items, with no group in the scene', () => {
  // A street-like tree with no user group: the cascade, multi-click and
  // double-click rules are the ones the editor had before groups.
  function streetScene() {
    const street = item(h.streetContainer, { id: 'street' });
    const segment = item(street, { id: 'segment' });
    const car = solid(segment, [0, 0, 0], [1, 1, 1], { id: 'car' });
    h.frame();
    h.aimDown(0.5, 0.5);
    return { street, segment, car };
  }

  it('cascades one level per click, ignores later clicks of a double-click and frames on the double-click', () => {
    const { street, segment } = streetScene();
    h.click({ detail: 1 });
    expect(selected()).toBe(street);
    h.click({ detail: 2 });
    expect(selected()).toBe(street);
    h.dblclick();
    expect(focused).toEqual([street.object3D]);
    h.click({ detail: 1 });
    expect(selected()).toBe(segment);
    const selects = captureNavDiscovery.mock.calls.filter(
      ([kind]) => kind === 'select'
    );
    expect(selects).toHaveLength(2);
  });

  it('deselects on empty space, but not on a release whose press began off the canvas (fails if the canvas resolves a release it never saw pressed)', () => {
    const { street } = streetScene();
    h.click();
    expect(selected()).toBe(street);
    // Empty ground under the cursor, and a drag there, which resolves nothing
    // and leaves the last canvas press at its start.
    h.aim([40, 50, 40], [0, -1, 0]);
    h.poll();
    h.drag(5);
    expect(selected()).toBe(street);
    // A press on a panel released over the canvas, exactly where the drag
    // began: only the unseen press tells it apart from a click there.
    h.releaseFromOffCanvasPress();
    expect(selected()).toBe(street);
    h.click();
    expect(selected()).toBe(null);
  });
});
