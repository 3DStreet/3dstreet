import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import * as THREE from 'three';
import AssetsPanel from '@/editor/components/scenegraph/AssetsPanel.jsx';
import AssetDeepLinkModal from '@/editor/components/AssetDeepLinkModal.jsx';
import AppMenu from '@/editor/components/scenegraph/AppMenu.jsx';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  captureFileInputs,
  committedWorldPosition,
  entityIn,
  memberWithBox,
  mountPlacementScene
} from '../lib/groups/_placementHarness.js';

// The editor's other ways of adding an asset: the Assets panel (place a
// library asset, upload a file), the asset deep-link modal and the File menu's
// Import. The shared panel body and modal are replaced by stand-ins that hand
// the test the callbacks the editor gives them; the menu renders without its
// popup layer. Everything behind those callbacks is real.

const given = {};
vi.mock('@shared/assets', async (importOriginal) => ({
  ...(await importOriginal()),
  AssetsPanelBody: (props) => {
    given.panel = props;
    return null;
  },
  AssetDetailModal: (props) => {
    given.modal = props;
    return null;
  }
}));

vi.mock('radix-ui', () => {
  // A stand-in for every menu part: its children, clickable.
  // eslint-disable-next-line react/prop-types
  const Pass = ({ children, onClick }) => (
    <div onClick={onClick}>{children}</div>
  );
  const Menubar = new Proxy({}, { get: () => Pass });
  return { Menubar };
});

let scene;

beforeEach(() => {
  scene = mountPlacementScene();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ASSET = {
  assetId: 'asset-7',
  ownerUid: 'owner-1',
  storageUrl: 'https://storage.example/asset-7.glb',
  name: 'Bench',
  type: 'mesh'
};

function withIntl(ui) {
  return render(<IntlProvider locale="en">{ui}</IntlProvider>);
}

async function upload(fn) {
  useCurrentUploadStore.getState().clear();
  await fn();
}

describe('adding assets from the library, a link and the File menu while a group is open', () => {
  it('places a library asset, an upload and a deep-linked asset in the innermost open group, and with none open where they always went', async () => {
    const { inner } = scene.scopeGroups();
    withIntl(<AssetsPanel />);
    window.location.hash = '#asset:owner-1/asset-7';
    withIntl(<AssetDeepLinkModal />);

    scene.openGroups('outer', 'inner');
    given.panel.onPlaceAsset(ASSET);
    await upload(() => given.panel.onUpload(new File(['s'], 'a.spz')));
    given.modal.onPlace(ASSET);
    expect(scene.creates()).toHaveLength(3);
    for (const [, payload] of scene.creates()) {
      expect(payload.parentEl).toBe(inner);
      expect(payload.requireParent).toBe(true);
    }

    scene.executed.length = 0;
    scene.closeGroups();
    given.panel.onPlaceAsset(ASSET);
    await upload(() => given.panel.onUpload(new File(['s'], 'b.spz')));
    given.modal.onPlace(ASSET);
    expect(scene.creates()).toHaveLength(3);
    for (const [, payload] of scene.creates()) {
      expect(payload.parentEl).toBeUndefined();
      expect(payload.requireParent).toBeUndefined();
    }
  });

  it('places a library asset in view at the ground the view is centred on, and where the view meets no ground, below the group center rather than at its origin', () => {
    const { inner } = scene.scopeGroups();
    // Members well away from the group origin, bottom at y = 1 in its frame.
    memberWithBox(inner, [6, 1, 6], [8, 2, 9], { id: 'member' });
    withIntl(<AssetsPanel />);
    scene.openGroups('outer', 'inner');

    given.panel.onPlaceAsset(ASSET);
    const inView = committedWorldPosition(scene.root, scene.creates()[0]);
    expect(inView.y).toBeCloseTo(0, 9);

    scene.lookUp();
    given.panel.onPlaceAsset(ASSET);
    const fallback = committedWorldPosition(scene.root, scene.creates()[1]);
    const stand = new THREE.Vector3(7, 1, 7.5).applyMatrix4(
      inner.object3D.matrixWorld
    );
    const origin = new THREE.Vector3().setFromMatrixPosition(
      inner.object3D.matrixWorld
    );
    expect(fallback.distanceTo(stand)).toBeLessThan(1e-6);
    expect(fallback.distanceTo(origin)).toBeGreaterThan(5);
  });

  it('imports a file from the File menu into the group open when Import was chosen, whatever is open when the file is picked (fails if the destination is read when the file arrives)', async () => {
    const { outer, inner } = scene.scopeGroups();
    const inputs = captureFileInputs();
    // Read by other menu items as the menu renders.
    globalThis.STREET.utils = {
      getCurrentSceneId: () => null,
      getAuthorId: () => null
    };
    withIntl(<AppMenu currentUser={null} />);
    scene.openGroups('outer', 'inner');
    fireEvent.click(screen.getByText('Import...'));
    scene.openGroups('outer');
    await upload(() =>
      inputs[0].onchange({ target: { files: [new File(['s'], 'c.spz')] } })
    );
    const [[, payload]] = scene.creates();
    expect(payload.parentEl).toBe(inner);
    expect(payload.parentEl).not.toBe(outer);

    // With no group open at the click, it goes to the top level.
    scene.executed.length = 0;
    scene.closeGroups();
    fireEvent.click(screen.getByText('Import...'));
    scene.openGroups('outer', 'inner');
    await upload(() =>
      inputs[1].onchange({ target: { files: [new File(['s'], 'd.spz')] } })
    );
    const [[, plain]] = scene.creates();
    expect(plain.parentEl).toBeUndefined();
  });
});

describe('an upload or import with no position of its own while a group is open', () => {
  let inputs;
  let file = 0;
  const nextFile = () => new File(['s'], `f${++file}.spz`);

  beforeEach(() => {
    inputs = captureFileInputs();
    // Read by other menu items as the menu renders.
    globalThis.STREET.utils = {
      getCurrentSceneId: () => null,
      getAuthorId: () => null
    };
    withIntl(<AssetsPanel />);
    withIntl(<AppMenu currentUser={null} />);
  });

  const uploadFromPanel = () => upload(() => given.panel.onUpload(nextFile()));
  const chooseImport = () => fireEvent.click(screen.getByText('Import...'));
  const pickImportedFile = () =>
    upload(() =>
      inputs[inputs.length - 1].onchange({ target: { files: [nextFile()] } })
    );
  const lastCreate = () => scene.creates()[scene.creates().length - 1];
  const committed = () => committedWorldPosition(scene.root, lastCreate());
  const worldOfLocal = (groupEl, x, y, z) => {
    groupEl.object3D.updateWorldMatrix(true, false);
    return new THREE.Vector3(x, y, z).applyMatrix4(
      groupEl.object3D.matrixWorld
    );
  };
  const origin = (groupEl) =>
    new THREE.Vector3().setFromMatrixPosition(groupEl.object3D.matrixWorld);

  it('goes to the center of the open group, on the bottom of its members, from the Upload button and from File › Import, not to the scene origin (fails if it lands at the world origin)', async () => {
    const { inner } = scene.scopeGroups();
    // Members well away from the group origin, bottom at y = 1 in its frame.
    memberWithBox(inner, [6, 1, 6], [8, 2, 9], { id: 'member' });
    scene.openGroups('outer', 'inner');
    const stand = worldOfLocal(inner, 7, 1, 7.5);

    await uploadFromPanel();
    expect(lastCreate()[1].parentEl).toBe(inner);
    expect(committed().distanceTo(stand)).toBeLessThan(1e-6);
    expect(committed().distanceTo(origin(inner))).toBeGreaterThan(5);
    expect(committed().length()).toBeGreaterThan(5);

    chooseImport();
    await pickImportedFile();
    expect(lastCreate()[1].parentEl).toBe(inner);
    expect(committed().distanceTo(stand)).toBeLessThan(1e-6);
  });

  it('goes to the stored center of an empty open group, and without one to its origin, where its marker is (fails if the stored center is ignored, or an empty group falls back to the world origin)', async () => {
    const outer = entityIn(scene.root, {
      id: 'outer',
      cls: 'user-group',
      rotation: '0 30 0'
    });
    const empty = entityIn(outer, {
      id: 'empty',
      cls: 'user-group',
      position: '12 0 -7'
    });
    scene.openGroups('outer', 'empty');

    empty.components['group-center'] = {
      data: { pinned: true, pin: { x: 3, y: 0, z: 4 } }
    };
    await uploadFromPanel();
    expect(lastCreate()[1].parentEl).toBe(empty);
    expect(committed().distanceTo(worldOfLocal(empty, 3, 0, 4))).toBeLessThan(
      1e-6
    );

    delete empty.components['group-center'];
    await uploadFromPanel();
    expect(committed().distanceTo(origin(empty))).toBeLessThan(1e-6);
    expect(committed().length()).toBeCloseTo(Math.hypot(12, 7), 6);
  });

  it('goes where the group is when the imported file arrives, after the group was moved (fails if the point is taken when Import is chosen)', async () => {
    const { inner } = scene.scopeGroups();
    memberWithBox(inner, [6, 1, 6], [8, 2, 9], { id: 'member' });
    scene.openGroups('outer', 'inner');
    const before = worldOfLocal(inner, 7, 1, 7.5);

    chooseImport();
    inner.setAttribute('position', '60 0 -20');
    await pickImportedFile();
    const after = worldOfLocal(inner, 7, 1, 7.5);
    expect(after.distanceTo(before)).toBeGreaterThan(9);
    expect(committed().distanceTo(after)).toBeLessThan(1e-6);
  });

  it('with no group open, goes to the scene origin at the top level, as always (fails if the group default reaches outside an open group)', async () => {
    const { inner } = scene.scopeGroups();
    memberWithBox(inner, [6, 1, 6], [8, 2, 9], { id: 'member' });

    await uploadFromPanel();
    chooseImport();
    await pickImportedFile();
    expect(scene.creates()).toHaveLength(2);
    for (const [, payload] of scene.creates()) {
      expect(payload.components.position).toBe('0 0 0');
      expect(payload.parentEl).toBeUndefined();
    }
  });

  it('follows every group around the open one: a scaled group inside a turned one (fails if only the transform of the open group itself is used)', async () => {
    const outer = entityIn(scene.root, {
      id: 'outer',
      cls: 'user-group',
      position: '-10 0 5',
      rotation: '0 30 0'
    });
    const inner = entityIn(outer, {
      id: 'inner',
      cls: 'user-group',
      position: '20 0 -8',
      scale: '2 2 2'
    });
    memberWithBox(inner, [6, 1, 6], [8, 2, 9], { id: 'member' });
    scene.openGroups('outer', 'inner');

    await uploadFromPanel();
    const [, payload] = lastCreate();
    expect(payload.parentEl).toBe(inner);
    expect(committed().distanceTo(worldOfLocal(inner, 7, 1, 7.5))).toBeLessThan(
      1e-6
    );
    // Recomposed under the group, the item sits at the stand point in its frame.
    expect(payload.components.position).toMatchObject({
      x: expect.closeTo(7, 6),
      y: expect.closeTo(1, 6),
      z: expect.closeTo(7.5, 6)
    });
  });
});

describe('View › Set as Starting View', () => {
  it('with a group open, makes and then moves the Starting View with the member kept selected and no group notice; with none open, selects it (fails if the menu, the create or the move selects it)', () => {
    const { inner } = scene.scopeGroups();
    const member = memberWithBox(inner, [6, 1, 6], [8, 2, 9], {
      id: 'member'
    });
    // Read by other menu items as the menu renders.
    globalThis.STREET.utils = {
      getCurrentSceneId: () => null,
      getAuthorId: () => null
    };
    // Updates of the Starting View's own properties read A-Frame's
    // component registry, which this scene does not register.
    globalThis.AFRAME.components = {};
    const selectSpy = vi.spyOn(scene.inspector, 'selectEntity');
    const startingView = () => document.querySelector('[viewer-start]');
    const selectedStartingView = () =>
      selectSpy.mock.calls.some(([el]) => el && el === startingView());
    withIntl(<AppMenu currentUser={null} />);

    scene.openGroups('outer', 'inner');
    scene.inspector.selectedEntity = member;
    fireEvent.click(screen.getByText('Set as Starting View'));
    expect(startingView()).not.toBe(null);
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(member);
    fireEvent.click(screen.getByText('Set as Starting View'));
    expect(selectedStartingView()).toBe(false);
    expect(scene.inspector.selectedEntity).toBe(member);
    expect(scene.notify.successMessage).toHaveBeenCalledTimes(2);
    expect(scene.notify.successMessage).toHaveBeenCalledWith(
      'Starting View set to current camera view'
    );
    expect(scene.notify.infoMessage).not.toHaveBeenCalled();

    scene.closeGroups();
    fireEvent.click(screen.getByText('Set as Starting View'));
    expect(scene.inspector.selectedEntity).toBe(startingView());
  });
});
