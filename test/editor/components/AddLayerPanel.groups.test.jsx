import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import * as THREE from 'three';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { AddLayerPanel } from '@/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  captureFileInputs,
  committedWorldPosition,
  dispatchDrag,
  entityIn,
  groundUnder,
  mountPlacementScene
} from '../lib/groups/_placementHarness.js';
import { worldOf, worldOfDefinition } from '../lib/groups/_entityElement.js';

// The Add Layer panel as the editor renders it (real entity.js, commands,
// guard and upload pipeline; see _placementHarness). The ground point comes
// from the real picker.

let scene;
let root;
let inspector;
let notify;

beforeEach(() => {
  scene = mountPlacementScene();
  ({ root, inspector, notify } = scene);
  // A catalog model the Plants tab offers.
  const assets = document.createElement('a-assets');
  assets.innerHTML = '<a-mixin id="tree3" category="plants"></a-mixin>';
  document.body.append(assets);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPanel() {
  return render(
    <IntlProvider locale="en">
      <AddLayerPanel />
    </IntlProvider>
  );
}

function tab(label) {
  fireEvent.click(screen.getByText(label));
}

function card(name) {
  return screen.getByText(name).closest('[draggable]');
}

function preview() {
  return document.getElementById('previewEntity');
}

// A drop at client (x, y): the ground point the panel places it at.
const DROP = { clientX: 700, clientY: 500 };

function fileDrop(file) {
  // One upload at a time: the previous test drop is left unfinished.
  useCurrentUploadStore.getState().clear();
  dispatchDrag('dragover', document.body, {
    ...DROP,
    dataTransfer: { types: ['Files'], dropEffect: '' }
  });
  const previewWorld = preview().object3D.position.clone();
  dispatchDrag('drop', document.body, {
    ...DROP,
    dataTransfer: { types: ['Files'], files: [file], getData: () => '' }
  });
  return previewWorld;
}

function assetDrop(asset) {
  const types = ['application/x-3dstreet-asset'];
  dispatchDrag('dragover', document.body, {
    ...DROP,
    dataTransfer: { types, dropEffect: '' }
  });
  const previewWorld = preview().object3D.position.clone();
  dispatchDrag('drop', document.body, {
    ...DROP,
    dataTransfer: {
      types,
      files: [],
      getData: (type) => (type === types[0] ? JSON.stringify(asset) : '')
    }
  });
  return previewWorld;
}

function cardDrag(name) {
  const data = {};
  const dataTransfer = {
    setData: (type, value) => {
      data[type] = value;
    },
    getData: (type) => data[type] ?? '',
    setDragImage: () => {},
    files: []
  };
  dispatchDrag('dragstart', card(name), { dataTransfer });
  // The panel's drop surface over the viewport.
  const surface = [...document.body.children].find(
    (el) => el.tagName === 'DIV' && el.style.position === 'absolute'
  );
  dispatchDrag('dragover', surface, { ...DROP, dataTransfer });
  const previewWorld = preview()?.object3D.position.clone();
  dispatchDrag('drop', surface, { ...DROP, dataTransfer });
  return previewWorld;
}

const ASSET = {
  assetId: 'asset-7',
  ownerUid: 'owner-1',
  storageUrl: 'https://storage.example/asset-7.glb',
  name: 'Bench',
  type: 'mesh'
};

describe('placing from the Add Layer panel while a group is open', () => {
  it('commits every route where its preview showed, inside the open group, never at the group origin, even with the open group itself selected (fails for a route that writes the world point as the local position, or previews at the group)', async () => {
    const { inner } = scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    inspector.selectEntity(inner);
    renderPanel();
    const origin = new THREE.Vector3().setFromMatrixPosition(worldOf(inner));
    const routes = [];

    // A catalog model: hover shows the preview, the click places it.
    tab('🌿 Plants');
    fireEvent.mouseEnter(card('Tree'));
    const inView = groundUnder(scene.camera);
    const dropped = groundUnder(scene.camera, DROP.clientX, DROP.clientY);
    routes.push(['mixin card', preview().object3D.position.clone(), inView]);
    fireEvent.click(card('Tree'));

    // A card whose handler builds its own entity.
    tab('🔵 Shapes');
    fireEvent.mouseEnter(card('Asphalt Circle'));
    routes.push(['handler card', preview().object3D.position.clone(), inView]);
    fireEvent.click(card('Asphalt Circle'));

    tab('🌿 Plants');
    routes.push(['card drag', cardDrag('Tree'), dropped]);
    routes.push([
      'file drop',
      fileDrop(new File(['splat'], 'garden.spz')),
      dropped
    ]);
    routes.push(['asset card drop', assetDrop(ASSET), dropped]);

    const made = scene.creates();
    expect(made).toHaveLength(routes.length);
    made.forEach((create, i) => {
      const [route, previewWorld, ground] = routes[i];
      const [, payload] = create;
      expect(payload.parentEl, route).toBe(inner);
      expect(payload.requireParent, route).toBe(true);
      const world = committedWorldPosition(root, create);
      expect(world.distanceTo(previewWorld), route).toBeLessThan(1e-6);
      // Where the route aims, not a picker miss at the origin.
      expect(world.distanceTo(ground), route).toBeLessThan(1e-6);
      expect(world.distanceTo(origin), route).toBeGreaterThan(5);
    });
    // The handler's own rotation is kept as a world rotation.
    const circleWorld = worldOfDefinition(inner, made[1][1].components);
    const expected = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ')
    );
    const actual = new THREE.Quaternion();
    circleWorld.decompose(new THREE.Vector3(), actual, new THREE.Vector3());
    expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 9);
  });

  it('places into the innermost open group and the selected item does not matter; with no group open, each route keeps its own parent', () => {
    const { outer, inner } = scene.scopeGroups();
    const member = entityIn(inner, { id: 'member', position: '1 0 1' });
    inspector.selectEntity(member);
    renderPanel();
    tab('🌿 Plants');

    scene.openGroups('outer', 'inner');
    fireEvent.click(card('Tree'));
    cardDrag('Tree');
    fileDrop(new File(['splat'], 'a.spz'));
    assetDrop(ASSET);
    tab('🔵 Shapes');
    fireEvent.click(card('Asphalt Circle'));
    for (const [, payload] of scene.creates()) {
      expect(payload.parentEl).toBe(inner);
      expect(payload.parentEl).not.toBe(outer);
      expect(payload.requireParent).toBe(true);
    }

    scene.executed.length = 0;
    scene.closeGroups();
    inspector.selectEntity(null);
    tab('🌿 Plants');
    fireEvent.click(card('Tree'));
    cardDrag('Tree');
    fileDrop(new File(['splat'], 'b.spz'));
    assetDrop(ASSET);
    tab('🔵 Shapes');
    fireEvent.click(card('Asphalt Circle'));
    expect(scene.creates()).toHaveLength(5);
    for (const [, payload] of scene.creates()) {
      expect(payload.parentEl).toBeUndefined();
      expect(payload.requireParent).toBeUndefined();
    }
  });

  it('with a group open, places into the group rather than the street-prop holder of a selected segment inside it (fails if the holder rule applies inside a group)', () => {
    const { inner } = scene.scopeGroups();
    const street = entityIn(inner, { id: 'street', position: '10 0 0' });
    const segment = entityIn(street, {
      id: 'segment',
      cls: 'segment-parent-0'
    });
    inspector.selectEntity(segment);
    scene.openGroups('outer', 'inner');
    renderPanel();
    tab('🌿 Plants');
    fireEvent.click(card('Tree'));

    const [[, payload]] = scene.creates();
    expect(payload.parentEl).toBe(inner);
    expect(segment.querySelector('.custom-group')).toBe(null);
  });

  it('with a group open, shows where a dragged card will land even when no preview was showing (fails if the drag shows nothing)', () => {
    scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    renderPanel();
    tab('🌿 Plants');
    expect(preview()).toBe(null);
    const dataTransfer = {
      setData: () => {},
      getData: () => '',
      setDragImage: () => {},
      files: []
    };
    dispatchDrag('dragstart', card('Tree'), { dataTransfer });
    const surface = [...document.body.children].find(
      (el) => el.tagName === 'DIV' && el.style.position === 'absolute'
    );
    dispatchDrag('dragover', surface, { ...DROP, dataTransfer });
    const shown = preview()?.object3D.position;
    expect(shown).toBeDefined();
    expect(
      shown.distanceTo(groundUnder(scene.camera, DROP.clientX, DROP.clientY))
    ).toBeLessThan(1e-6);
  });

  it('adds a model beside a selected street segment, in its street-prop holder, when no group is open (fails if the base rule changes outside a group)', () => {
    const street = entityIn(root, { id: 'street', position: '10 0 0' });
    const segment = entityIn(street, {
      id: 'segment',
      cls: 'segment-parent-0'
    });
    segment.setAttribute('data-elevation-posY', '0.15');
    inspector.selectEntity(segment);
    renderPanel();
    tab('🌿 Plants');
    fireEvent.click(card('Tree'));

    const [[, payload]] = scene.creates();
    const holder = segment.querySelector('.custom-group');
    expect(holder).not.toBe(null);
    expect(payload.parentEl).toBe(holder);
    expect(payload.requireParent).toBeUndefined();
    expect(holder.parentNode.querySelector('[mixin="tree3"]')).not.toBe(null);
  });

  it('is one undo step per card click and per drag, and redo brings back the same item (fails if a route records two entries or makes a new id on redo)', () => {
    const { inner } = scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    renderPanel();
    tab('🌿 Plants');

    fireEvent.click(card('Tree'));
    expect(inspector.history.undos).toHaveLength(1);
    const clicked = inner.querySelector('[mixin="tree3"]');
    expect(clicked).not.toBe(null);
    const clickedId = clicked.id;

    cardDrag('Tree');
    expect(inspector.history.undos).toHaveLength(2);
    const dragged = [...inner.querySelectorAll('[mixin="tree3"]')].find(
      (el) => el.id !== clickedId
    );
    const draggedId = dragged.id;

    inspector.history.undo();
    inspector.history.undo();
    expect(inner.querySelector('[mixin="tree3"]')).toBe(null);
    inspector.history.redo();
    inspector.history.redo();
    expect(document.getElementById(clickedId).parentNode).toBe(inner);
    expect(document.getElementById(draggedId).parentNode).toBe(inner);
    expect(inspector.history.undos).toHaveLength(2);
  });

  it('refuses a card click into a group scaled unevenly and turned, and leaves the scene and history as they were (fails if the item is distorted or placed at the top level)', () => {
    const imported = entityIn(root, {
      id: 'imported',
      cls: 'user-group',
      position: '0 0 0',
      rotation: '0 30 0',
      scale: '2 1 1'
    });
    scene.openGroups('imported');
    renderPanel();
    tab('🌿 Plants');
    const before = document.body.querySelectorAll('[mixin="tree3"]').length;

    fireEvent.click(card('Tree'));

    expect(scene.creates()).toHaveLength(0);
    expect(inspector.history.undos).toHaveLength(0);
    expect(document.body.querySelectorAll('[mixin="tree3"]').length).toBe(
      before
    );
    expect(imported.children).toHaveLength(0);
    expect(notify.warningMessage).toHaveBeenCalledWith(
      groupMessage('placementDistorts')
    );
  });

  it('adds a panorama sphere at the top level, not into the open group, and says so (fails if the backdrop becomes a member)', () => {
    scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    vi.stubGlobal('prompt', () => 'https://example.com/pano.png');
    renderPanel();
    tab('⚙️ Custom');
    fireEvent.click(card('360° Panorama Sphere'));

    const [[, payload]] = scene.creates();
    expect(payload.parentEl).toBeUndefined();
    expect(payload.requireParent).toBeUndefined();
    const sphere = root.lastElementChild;
    expect(sphere.getAttribute('data-layer-name')).toBe(
      'Sphere Geometry • 360° Panorama'
    );
    expect(notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('placedAtTopLevel')
    );
  });

  it('puts an upload from a picker card into the group open when the card was clicked, whatever is open when the file is chosen', async () => {
    const { outer, inner } = scene.scopeGroups();
    scene.openGroups('outer', 'inner');
    renderPanel();
    const inputs = captureFileInputs();
    tab('⚙️ Custom');
    fireEvent.click(card('Upload 3D Model'));
    // The user closes the inner group while the file dialog is open.
    scene.openGroups('outer');
    await inputs[0].onchange({
      target: { files: [new File(['splat'], 'c.spz')] }
    });

    const [[, payload]] = scene.creates();
    expect(payload.parentEl).toBe(inner);
    expect(payload.parentEl).not.toBe(outer);
  });
});
