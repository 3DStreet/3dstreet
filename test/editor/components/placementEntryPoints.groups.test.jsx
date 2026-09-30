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
