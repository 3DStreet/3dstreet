import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { httpsCallable } from 'firebase/functions';
import { auth } from '@shared/services/firebase.js';
import * as assetUpload from '@shared/asset-upload';
import {
  beginPlacement,
  newGroupPlacement,
  placeDefinition
} from '@/editor/lib/groups/groupPlacement.js';
import { isGroupableItem } from '@/editor/lib/groups/groupModel.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { uploadAndPlaceAsset } from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { dispatchToolCall } from '@/editor/lib/commands/registry.js';
import { ensureViewerStartAtCurrentView } from '@/editor/lib/entity.jsx';
import { createReplayEntityFromManifest } from '@/editor/components/elements/AddLayerPanel/createLayerFunctions.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  committedWorldPosition,
  entityIn,
  memberWithBox,
  mountPlacementScene
} from './_placementHarness.js';
import {
  expectMatrixClose,
  setFixtureMixin,
  worldOf
} from './_entityElement.js';

vi.mock('@shared/asset-upload', async (importOriginal) => ({
  ...(await importOriginal()),
  analyzeGltfFile: vi.fn()
}));

let scene;

// One clock for every notice test in this file, only ever moved forward and
// later than any real time: a repeat of the same notice text is held back
// briefly, so each test and each step is judged well clear of the one before,
// whatever order the tests run in.
let clock = Date.now() + 3600000;
function tick() {
  clock += 60000;
  vi.setSystemTime(clock);
}

beforeEach(() => {
  scene = mountPlacementScene();
});

afterEach(() => {
  delete auth.currentUser;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('where a new item is placed', () => {
  it('keeps each route to its own rule with no group open, and places in the innermost open group when one is', () => {
    const { outer, inner } = scene.scopeGroups();
    const definition = { mixin: 'tree3', components: { position: '1 0 2' } };

    expect(beginPlacement()).toBe(null);
    expect(placeDefinition(definition, beginPlacement())).toEqual({
      definition
    });

    scene.openGroups('outer', 'inner');
    const placed = placeDefinition(definition, beginPlacement()).definition;
    expect(placed.parentEl).toBe(inner);
    expect(placed.parentEl).not.toBe(outer);
    expect(placed.requireParent).toBe(true);
    // Same world position as at the top level.
    const probe = entityIn(inner, { position: placed.components.position });
    expect(
      new THREE.Vector3().setFromMatrixPosition(worldOf(probe))
    ).toMatchObject({ x: expect.closeTo(1, 9), z: expect.closeTo(2, 9) });
  });

  it('keeps an item that may not go into a group out of it: shapes, segments, the Starting View and generated items', () => {
    scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    for (const definition of [
      { components: { shape: '' } },
      { components: { 'street-segment': 'type: drive-lane' } },
      { components: { 'viewer-start': '' } },
      { class: ['autocreated'], components: {} },
      { class: 'autocreated clone', components: {} }
    ]) {
      expect(isGroupableItem(definition)).toBe(false);
      expect(beginPlacement({ groupable: isGroupableItem(definition) })).toBe(
        null
      );
    }
    expect(isGroupableItem({ mixin: 'tree3', components: {} })).toBe(true);
    expect(isGroupableItem({ class: ['user-group'], components: {} })).toBe(
      true
    );
  });

  it('refuses an item the open group would distort (scaled unevenly, the item turned against it), and allows one it would not', () => {
    entityIn(scene.root, {
      id: 'imported',
      cls: 'user-group',
      scale: '2 1 1'
    });
    scene.openGroups('imported');
    expect(
      placeDefinition(
        { components: { position: '0 0 0', rotation: '0 30 0' } },
        beginPlacement()
      )
    ).toEqual({ refusal: groupMessage('placementDistorts') });
    expect(
      placeDefinition({ components: { position: '0 0 0' } }, beginPlacement())
        .definition.components.scale
    ).toEqual({ x: 0.5, y: 1, z: 1 });
  });

  it('refuses a turned item placed into an unscaled group when the street container itself is scaled unevenly (fails without the distortion check)', () => {
    scene.root.setAttribute('scale', '2 1 1');
    entityIn(scene.root, { id: 'level', cls: 'user-group' });
    scene.openGroups('level');
    expect(
      placeDefinition(
        { components: { position: '0 0 0', rotation: '0 30 0' } },
        beginPlacement()
      )
    ).toEqual({ refusal: groupMessage('placementDistorts') });
  });

  it('refuses a placement whose group has gone, rather than placing it at the top level', () => {
    const { inner } = scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    const ticket = beginPlacement();
    inner.remove();
    expect(placeDefinition({ components: {} }, ticket)).toEqual({
      refusal: groupMessage('destinationGone')
    });
  });
});

describe('an entity created by the AI assistant', () => {
  it('is created inside the open group at the world position the assistant gave (fails if the position is read as local to the group)', async () => {
    const group = entityIn(scene.root, {
      id: 'scope',
      cls: 'user-group',
      position: '10 0 5',
      rotation: '0 90 0'
    });
    scene.openGroups('scope');
    await dispatchToolCall('entityCreate', { position: '12 0 5' });
    const created = group.lastElementChild;
    expect(created).not.toBe(null);
    const world = new THREE.Vector3().setFromMatrixPosition(worldOf(created));
    expect(world.x).toBeCloseTo(12, 9);
    expect(world.y).toBeCloseTo(0, 9);
    expect(world.z).toBeCloseTo(5, 9);
  });

  it('is refused, and reported as refused, where the group would distort it', async () => {
    entityIn(scene.root, { id: 'imported', cls: 'user-group', scale: '2 1 1' });
    scene.openGroups('imported');
    await expect(
      dispatchToolCall('entityCreate', { rotation: '0 30 0' })
    ).rejects.toThrow(groupMessage('placementDistorts'));
    expect(scene.creates()).toHaveLength(0);
  });

  it('puts a street it creates inside the open group at the world position it gave (fails if the street route skips placement)', async () => {
    const group = entityIn(scene.root, {
      id: 'scope',
      cls: 'user-group',
      position: '10 0 5',
      rotation: '0 90 0'
    });
    scene.openGroups('scope');
    // No component is registered; the street is checked against no schema.
    globalThis.AFRAME.components = {};
    // The tool then waits for the street to settle, which it never does here.
    vi.useFakeTimers();
    const done = dispatchToolCall('managedStreetCreate', {
      position: '12 0 5'
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    vi.useRealTimers();

    const [create] = scene.creates();
    expect(create[1].parentEl).toBe(group);
    expect(create[1].requireParent).toBe(true);
    const world = committedWorldPosition(scene.root, create);
    expect(world.x).toBeCloseTo(12, 9);
    expect(world.z).toBeCloseTo(5, 9);
  });

  it('with no group open, is created at the top level with the values given', async () => {
    await dispatchToolCall('entityCreate', { position: '12 0 5' });
    const [[, payload]] = scene.creates();
    expect(payload).toEqual({
      components: { position: '12 0 5', rotation: '0 0 0', scale: '1 1 1' }
    });
  });
});

describe('an upload that is still being read when the scope changes', () => {
  let finishAnalysis;

  beforeEach(() => {
    auth.currentUser = { uid: 'user-1' };
    useCurrentUploadStore.getState().clear();
    assetUpload.analyzeGltfFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAnalysis = () => resolve({ status: 'ok', externalRefs: [] });
        })
    );
  });

  const gltf = () =>
    new File(['{"asset":{"version":"2.0"}}'], 'model.gltf', {
      type: 'model/gltf+json'
    });

  it('is placed in the group open when it began, not the one open when the placeholder is made', async () => {
    // Signed out, so the flow ends once the placeholder is placed.
    delete auth.currentUser;
    const outer = entityIn(scene.root, { id: 'a', cls: 'user-group' });
    entityIn(scene.root, { id: 'b', cls: 'user-group' });
    scene.openGroups('a');
    // Held at the model check, before any placeholder exists.
    const uploading = uploadAndPlaceAsset(gltf(), '1 0 1');
    await vi.waitFor(() => expect(finishAnalysis).toBeTypeOf('function'));
    scene.openGroups('b');
    finishAnalysis();
    await vi.waitFor(() => expect(scene.creates()).toHaveLength(1));
    expect(scene.creates()[0][1].parentEl).toBe(outer);
    useCurrentUploadStore.getState().clear();
    uploading.catch(() => {});
  });

  it('with no position of its own, goes to the stand point of the group where it is when the model has been read, after the group was moved meanwhile (fails if the point is taken before the read)', async () => {
    delete auth.currentUser;
    const group = entityIn(scene.root, {
      id: 'a',
      cls: 'user-group',
      rotation: '0 25 0'
    });
    memberWithBox(group, [6, 1, 6], [8, 2, 9]);
    scene.openGroups('a');
    const uploading = uploadAndPlaceAsset(gltf());
    await vi.waitFor(() => expect(finishAnalysis).toBeTypeOf('function'));
    group.setAttribute('position', '10 0 -4');
    finishAnalysis();
    await vi.waitFor(() => expect(scene.creates()).toHaveLength(1));
    group.object3D.updateWorldMatrix(true, false);
    const stand = new THREE.Vector3(7, 1, 7.5).applyMatrix4(
      group.object3D.matrixWorld
    );
    expect(
      committedWorldPosition(scene.root, scene.creates()[0]).distanceTo(stand)
    ).toBeLessThan(1e-6);
    useCurrentUploadStore.getState().clear();
    uploading.catch(() => {});
  });

  it('is refused with an explanation when that group is removed meanwhile: nothing is created and nothing is uploaded (fails if the destination is read late or falls back to the top level)', async () => {
    const group = entityIn(scene.root, { id: 'a', cls: 'user-group' });
    scene.openGroups('a');
    const uploading = uploadAndPlaceAsset(gltf(), '1 0 1');
    await vi.waitFor(() => expect(finishAnalysis).toBeTypeOf('function'));
    group.remove();
    finishAnalysis();
    const result = await uploading;

    expect(result.entity).toBe(null);
    expect(scene.creates()).toHaveLength(0);
    expect(scene.root.children).toHaveLength(0);
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(useCurrentUploadStore.getState().isBusy()).toBe(false);
    expect(scene.notify.warningMessage).toHaveBeenCalledWith(
      groupMessage('destinationGone')
    );
  });
});

describe('an item a route may not put in the open group', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick();
  });
  afterEach(() => vi.useRealTimers());

  it('lands where the route puts it and the user is told it is outside the group', () => {
    scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    scene.inspector.execute('entitycreate', {
      components: { shape: '', position: '1 0 1' }
    });
    const [[, payload]] = scene.creates();
    expect(payload.parentEl).toBeUndefined();
    expect(scene.root.lastElementChild.hasAttribute('shape')).toBe(true);
    expect(scene.notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('placedAtTopLevel')
    );
  });

  it('says nothing when no group is open, when the item went into the group, or when redo brings it back; says it once when it lands outside (fails if the notice repeats on redo)', () => {
    const { inner } = scene.scopeGroups();
    scene.inspector.execute('entitycreate', {
      components: { shape: '' }
    });
    scene.openGroups('outer', 'inner');
    scene.inspector.execute('entitycreate', {
      parentEl: inner,
      requireParent: true,
      components: {}
    });
    expect(scene.notify.infoMessage).not.toHaveBeenCalled();

    scene.inspector.execute('entitycreate', {
      components: { shape: '' }
    });
    expect(scene.notify.infoMessage).toHaveBeenCalledTimes(1);
    tick();
    scene.inspector.history.undo();
    scene.inspector.history.redo();
    expect(scene.notify.infoMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the notice for an item added outside the open group', () => {
  function noticesFor(add) {
    tick();
    scene.notify.infoMessage.mockClear();
    add();
    return scene.notify.infoMessage.mock.calls.map(([text]) => text);
  }
  const create = (definition) => () =>
    scene.inspector.execute('entitycreate', definition);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    scene.scopeGroups();
    scene.openGroups('outer', 'inner');
  });
  afterEach(() => vi.useRealTimers());

  it('tells the user an item that could be grouped, put at the top level by its route, can be dragged into the group (fails if it says the item cannot go in a group)', () => {
    const draggable = [groupMessage('routePlacedAtTopLevel')];
    // The Geo panel's flattening box and an OSM upgrade's street, as their
    // routes create them: raw creates with no destination of their own.
    expect(
      noticesFor(
        create({
          'data-layer-name': 'Geo Flattening Shape',
          components: { scale: '20 5 40', 'geo-flatten': 'mode: mesh' }
        })
      )
    ).toEqual(draggable);
    expect(
      noticesFor(
        create({
          components: {
            position: '10 0.1 4',
            'managed-street': { sourceType: 'json-blob', synchronize: true }
          }
        })
      )
    ).toEqual(draggable);
    expect(
      noticesFor(() =>
        createReplayEntityFromManifest({ agents: [{ mode: 'car' }] })
      )
    ).toEqual(draggable);
    expect(
      scene.root.lastElementChild.hasAttribute('street-traffic-replay')
    ).toBe(true);
    expect(draggable[0]).toContain('drag it there in the Layers panel');
    expect(draggable[0]).not.toContain('cannot');
  });

  it('keeps "cannot go inside a group" for an item that cannot, and gives a 360° panorama its own reason with no invitation to drag it (fails if the notice ignores what the item is)', () => {
    expect(noticesFor(create({ components: { shape: '' } }))).toEqual([
      groupMessage('placedAtTopLevel')
    ]);
    expect(
      noticesFor(
        create({
          class: 'scene-backdrop',
          components: { scale: '-1 1 1' }
        })
      )
    ).toEqual([groupMessage('backdropAtTopLevel')]);
    expect(groupMessage('backdropAtTopLevel')).not.toContain('drag');
  });

  it('says "outside the open group" when the route put the item in another group, for either kind (fails if every such item is said to be at the top level)', () => {
    const other = entityIn(scene.root, { id: 'other', cls: 'user-group' });
    expect(
      noticesFor(create({ parentEl: other, components: { position: '1 0 1' } }))
    ).toEqual([groupMessage('routePlacedOutsideGroup')]);
    expect(
      noticesFor(create({ parentEl: other, components: { shape: '' } }))
    ).toEqual([groupMessage('placedOutsideGroup')]);
  });
});

describe('the Starting View, which the editor makes for the user', () => {
  let member;
  let selectSpy;
  const startingView = () => document.querySelector('[viewer-start]');
  const selectedStartingView = () =>
    selectSpy.mock.calls.some(([el]) => el && el === startingView());

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick();
    // Updates of the Starting View's own properties read A-Frame's
    // component registry, which this scene does not register.
    globalThis.AFRAME.components = {};
    const { inner } = scene.scopeGroups();
    member = entityIn(inner, { id: 'member' });
    scene.openGroups('outer', 'inner');
    selectSpy = vi.spyOn(scene.inspector, 'selectEntity');
  });
  afterEach(() => vi.useRealTimers());

  it('is made with a group open without a placement notice and without being selected, so the selection stays on the member (fails on a notice, or if creating it selects it)', () => {
    scene.inspector.selectedEntity = member;
    ensureViewerStartAtCurrentView();
    expect(startingView()).not.toBe(null);
    expect(startingView().parentNode).toBe(scene.root);
    expect(scene.notify.infoMessage).not.toHaveBeenCalled();
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(member);
  });

  it('for a thumbnail, is never selected with a group open, with or without a selection, made or moved (fails if creating or moving it selects it)', () => {
    // Nothing selected.
    ensureViewerStartAtCurrentView();
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(null);
    // Moved, with a member selected.
    scene.inspector.selectedEntity = member;
    ensureViewerStartAtCurrentView();
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(member);
    // Made again, with a member selected.
    startingView().remove();
    ensureViewerStartAtCurrentView();
    expect(startingView()).not.toBe(null);
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(member);
    expect(scene.notify.infoMessage).not.toHaveBeenCalled();
  });
});

it('keeps the world matrix of a placed item exactly, rotation and scale included', () => {
  const { inner } = scene.scopeGroups();
  scene.openGroups('outer', 'inner');
  const components = {
    position: '4 1 -3',
    rotation: '0 -90 0',
    scale: '-1 1 1'
  };
  const placed = placeDefinition({ components }, beginPlacement()).definition;
  const inGroup = entityIn(inner, placed.components);
  const atTop = entityIn(scene.root, components);
  expectMatrixClose(expect, worldOf(inGroup), worldOf(atTop));
});

describe('where the New group button puts a group', () => {
  it("with a turned, scaled group selected inside an open turned group, at the selected group's center in its parent's frame (fails if the origin, the world frame, the scale or the open group's center is used)", () => {
    const parent = entityIn(scene.root, {
      id: 'parent',
      cls: 'user-group',
      position: '-7 2 5',
      rotation: '0 -35 0'
    });
    // Elsewhere in the open group, so its center is not the selected group's.
    memberWithBox(parent, [-30, 0, -30], [-26, 2, -26], { id: 'other' });
    const g = entityIn(parent, {
      id: 'g',
      cls: 'user-group',
      position: '40 0 -10',
      rotation: '0 50 0',
      scale: '2 2 2'
    });
    memberWithBox(g, [6, 0, 8], [10, 2, 12]);
    scene.openGroups('parent');
    g.object3D.updateMatrix();
    const expected = new THREE.Vector3(8, 1, 10).applyMatrix4(
      g.object3D.matrix
    );

    const { parentEl, beforeEl, position } = newGroupPlacement(g);

    expect(parentEl).toBe(parent);
    expect(beforeEl).toBe(g);
    expect(position.x).toBeCloseTo(expected.x, 9);
    expect(position.y).toBeCloseTo(expected.y, 9);
    expect(position.z).toBeCloseTo(expected.z, 9);
  });

  it('with an ordinary item selected, directly above it at its position, and for a street segment above the whole street (fails if the anchor rule changed)', () => {
    const model = entityIn(scene.root, { id: 'model', position: '3 0 -2' });
    const street = entityIn(scene.root, { id: 'street', position: '5 0 9' });
    street.setAttribute('managed-street', '');
    const segment = entityIn(street, { id: 'segment' });
    segment.setAttribute('street-segment', '');

    expect(newGroupPlacement(model)).toEqual({
      parentEl: scene.root,
      beforeEl: model,
      position: { x: 3, y: 0, z: -2 }
    });
    expect(newGroupPlacement(segment)).toEqual({
      parentEl: scene.root,
      beforeEl: street,
      position: { x: 5, y: 0, z: 9 }
    });
  });

  it('with the Starting View, the panorama or generated content selected, first at the top level at the origin (fails if any of them anchors the group)', () => {
    const first = entityIn(scene.root, { id: 'first' });
    const start = entityIn(scene.root, { id: 'start', position: '0 30 40' });
    start.setAttribute('viewer-start', '');
    const backdrop = entityIn(scene.root, {
      id: 'pano',
      cls: 'scene-backdrop'
    });
    const generated = entityIn(scene.root, {
      id: 'generated',
      cls: 'autocreated',
      position: '8 0 8'
    });

    for (const el of [start, backdrop, generated]) {
      expect(newGroupPlacement(el)).toEqual({
        parentEl: scene.root,
        beforeEl: first,
        position: { x: 0, y: 0, z: 0 }
      });
    }
  });

  it('with an item that cannot go into a group selected inside the open group, first in that group at its center (fails if the item anchors the group)', () => {
    const open = entityIn(scene.root, { id: 'open', cls: 'user-group' });
    const member = memberWithBox(open, [2, 0, 2], [4, 2, 4], { id: 'm' });
    const pinned = entityIn(open, { id: 'pinned', position: '9 0 9' });
    pinned.setAttribute('data-transform-no-reparent', '');
    scene.openGroups('open');

    const { parentEl, beforeEl, position } = newGroupPlacement(pinned);

    expect(parentEl).toBe(open);
    expect(beforeEl).toBe(member);
    expect(position.x).toBeCloseTo(3, 9);
    expect(position.y).toBeCloseTo(1, 9);
    expect(position.z).toBeCloseTo(3, 9);
  });
});

describe('what the AI assistant is told about a group edit', () => {
  const NO_SCALE = 'Scaling is not available for this element.';
  const RULE = 'groups turn only about the vertical axis and are never scaled.';
  const SIZES = 'The items in it keep their own sizes.';
  const BOTH = `entityupdate executed. The item is now a group, so its tilt (rotation x 10, z 5) and scale (2 2 2) were removed; ${RULE} Its heading and position are unchanged. ${SIZES}`;

  function groupWithMember() {
    const group = entityIn(scene.root, { id: 'g', cls: 'user-group' });
    const member = entityIn(group, { id: 'm', scale: '1 2 1' });
    return { group, member };
  }

  it('is refused with the reason the editor showed, by chat and by MCP alike, and nothing changes (fails if the recorded reason is not passed out)', async () => {
    const { group } = groupWithMember();
    const args = { entityId: 'g', component: 'scale', value: '2 2 2' };
    await expect(dispatchToolCall('entityUpdate', args)).rejects.toThrow(
      `entityupdate refused: ${NO_SCALE}`
    );
    const { callToolAsMCPContent } =
      await import('@/editor/lib/mcp/dispatch.js');
    await expect(callToolAsMCPContent('entityUpdate', args)).rejects.toThrow(
      `entityupdate refused: ${NO_SCALE}`
    );
    expect(group.hasAttribute('scale')).toBe(false);
    expect(scene.inspector.history.undos).toHaveLength(0);
  });

  it('scales a member of a group as before, with no note, and one undo restores it exactly (fails if a member is treated as a group)', async () => {
    const { member } = groupWithMember();
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'm',
        component: 'scale',
        value: '2 2 2'
      })
    ).resolves.toBe('entityupdate executed');
    expect(member.getAttribute('scale')).toEqual({ x: 2, y: 2, z: 2 });
    scene.inspector.history.undo();
    expect(member.getAttribute('scale')).toEqual({ x: 1, y: 2, z: 1 });
  });

  it.each([
    [
      'a tilt and a scale',
      { rotation: '10 30 5', scale: '2 2 2' },
      null,
      BOTH,
      30
    ],
    [
      'a tilt',
      { rotation: '10 30 5' },
      null,
      `entityupdate executed. The item is now a group, so its tilt (rotation x 10, z 5) was removed; ${RULE} Its heading and position are unchanged.`,
      30
    ],
    [
      'a scale its mixin gave it',
      {},
      { scale: '2 2 2' },
      `entityupdate executed. The item is now a group, so its scale (2 2 2) was removed; ${RULE} Its heading and position are unchanged. ${SIZES}`,
      null
    ],
    [
      'a tilt past 90 degrees',
      { rotation: '170 30 0' },
      null,
      `entityupdate executed. The item is now a group, so its tilt (rotation x 170, z 0) was removed; ${RULE} It faces the same way and its position is unchanged; its rotation is now 0 -150 0.`,
      -150
    ],
    [
      // As A-Frame reads a rotation back from radians.
      'a tilt read back with float noise',
      { rotation: '10.000000000000002 -149.99999999999997 5' },
      null,
      `entityupdate executed. The item is now a group, so its tilt (rotation x 10, z 5) was removed; ${RULE} Its heading and position are unchanged.`,
      -150
    ]
  ])(
    'tells it what was removed when an item with %s becomes a group, and levels it facing the same way (fails without the note, if it is built from a read that was not copied, or if X and Z are zeroed keeping Y)',
    async (_, pose, mixin, expected, expectedY) => {
      const item = entityIn(scene.root, { id: 'item', ...pose });
      if (mixin) setFixtureMixin(item, mixin);
      await expect(
        dispatchToolCall('entityUpdate', {
          entityId: 'item',
          component: 'class',
          value: 'user-group'
        })
      ).resolves.toBe(expected);
      const r = item.getAttribute('rotation');
      if (expectedY === null) {
        expect(r).toBe(null);
      } else {
        expect(r).toEqual({ x: 0, y: expectedY, z: 0 });
      }
      // An item with no scale of its own shows the default.
      const scale = item.getAttribute('scale') ?? { x: 1, y: 1, z: 1 };
      expect(scale).toEqual({ x: 1, y: 1, z: 1 });
    }
  );

  it('adds no note to an ordinary turn of a group, nor to one within the tolerance (fails if every group edit gets a note)', async () => {
    groupWithMember();
    for (const value of ['0 50 0', '0.0005 50 0']) {
      await expect(
        dispatchToolCall('entityUpdate', {
          entityId: 'g',
          component: 'rotation',
          value
        })
      ).resolves.toBe('entityupdate executed');
    }
  });

  it('is told why removing the class from a group with members was refused', async () => {
    groupWithMember();
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'g',
        component: 'class',
        value: ''
      })
    ).rejects.toThrow(
      `entityupdate refused: ${groupMessage('ungroupWithMembers')}`
    );
  });

  it('is refused adding a scale component to a group (fails if adding a component is not judged)', async () => {
    groupWithMember();
    await expect(
      dispatchToolCall('componentAdd', {
        entityId: 'g',
        component: 'scale',
        value: '2 2 2'
      })
    ).rejects.toThrow(`componentadd refused: ${NO_SCALE}`);
  });

  it('reports the outcome of its own command, not of one run while it executes', async () => {
    const { group } = groupWithMember();
    entityIn(scene.root, { id: 'item', rotation: '10 30 5', scale: '2 2 2' });
    const history = scene.inspector.history;
    const original = history.execute.bind(history);
    let nested = false;
    vi.spyOn(history, 'execute').mockImplementation((cmd, name) => {
      if (!nested) {
        nested = true;
        scene.inspector.execute('entityupdate', {
          entity: group,
          component: 'scale',
          value: '2 2 2'
        });
      }
      return original(cmd, name);
    });
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'item',
        component: 'class',
        value: 'user-group'
      })
    ).resolves.toBe(BOTH);
  });

  it('tells it when a group it already had was levelled, without calling it newly a group (fails if every note says the item is now a group)', async () => {
    const g = entityIn(scene.root, {
      id: 'tilted-group',
      cls: 'user-group',
      rotation: '10 30 0',
      scale: '2 2 2'
    });
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'tilted-group',
        component: 'mixin',
        value: 'bar'
      })
    ).resolves.toBe(
      `entityupdate executed. This group's tilt (rotation x 10, z 0) and scale (2 2 2) were removed; ${RULE} Its heading and position are unchanged. ${SIZES}`
    );
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
  });

  it('leaves nothing behind for the next tool call when one throws, and a command run outside a tool call does not colour the next one', async () => {
    const { member } = groupWithMember();
    const history = scene.inspector.history;
    vi.spyOn(history, 'execute').mockImplementationOnce(() => {
      throw new Error('the command failed');
    });
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'm',
        component: 'position',
        value: '1 0 0'
      })
    ).rejects.toThrow('the command failed');

    const tilted = entityIn(scene.root, {
      id: 'tilted',
      rotation: '10 30 5'
    });
    scene.inspector.execute('entityupdate', {
      entity: tilted,
      component: 'class',
      value: 'user-group'
    });

    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'm',
        component: 'position',
        value: '2 0 0'
      })
    ).resolves.toBe('entityupdate executed');
    expect(member.getAttribute('position')).toEqual({ x: 2, y: 0, z: 0 });

    await expect(
      dispatchToolCall('componentAdd', {
        entityId: 'g',
        component: 'scale',
        value: '2 2 2'
      })
    ).rejects.toThrow(`componentadd refused: ${NO_SCALE}`);
  });
});
