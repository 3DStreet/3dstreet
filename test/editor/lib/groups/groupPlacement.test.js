import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { httpsCallable } from 'firebase/functions';
import { auth } from '@shared/services/firebase.js';
import * as assetUpload from '@shared/asset-upload';
import {
  beginPlacement,
  placeDefinition
} from '@/editor/lib/groups/groupPlacement.js';
import { isGroupableItem } from '@/editor/lib/groups/groupModel.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { uploadAndPlaceAsset } from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { dispatchToolCall } from '@/editor/lib/commands/registry.js';
import { createReplayEntityFromManifest } from '@/editor/components/elements/AddLayerPanel/createLayerFunctions.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  committedWorldPosition,
  entityIn,
  mountPlacementScene
} from './_placementHarness.js';
import { expectMatrixClose, worldOf } from './_entityElement.js';

vi.mock('@shared/asset-upload', async (importOriginal) => ({
  ...(await importOriginal()),
  analyzeGltfFile: vi.fn()
}));

let scene;

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
    // Past any notice an earlier test gave: repeats are held back briefly.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60000);
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
    vi.setSystemTime(Date.now() + 60000);
    scene.inspector.history.undo();
    scene.inspector.history.redo();
    expect(scene.notify.infoMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('the notice for an item added outside the open group', () => {
  // The notices each create gives, past any earlier one: a repeat of the same
  // text is held back briefly.
  function noticesFor(add) {
    vi.setSystemTime(Date.now() + 60000);
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
