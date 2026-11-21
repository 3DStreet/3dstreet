/**
 * Editor-side Assets panel. Thin shell around the shared AssetsPanelBody —
 * the body owns filters, upload, usage meter, and the grid; this wrapper
 * supplies the editor-specific glue: place-in-scene at ground-pick point
 * and the editor's drop-and-place upload (placeholder entity + scene cmd).
 */

import { AssetsPanelBody, teamAssetOwner } from '@shared/assets';
import { uploadAsset } from '@shared/asset-upload';
import { assetAllowedInScene } from '@/editor/lib/asset-upload/teamSceneAssets.js';
import {
  uploadAndPlaceAsset,
  placeCloudAsset
} from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import {
  openInGenerator,
  focusSnapshotScene
} from '@/editor/lib/asset-modal-handlers.js';
import { viewCenterPoint } from '@/editor/lib/groups/groupPlacement.js';
import { signIn } from '../../api';
import useStore from '@/store';

const handlePlaceAsset = (asset) => {
  const position = viewCenterPoint(AFRAME.INSPECTOR.camera);
  placeCloudAsset(asset, position);
};

/**
 * Upload into the library on screen (#1267 Phase 4). Placed in the scene
 * when the scene can use that library's assets; in a team scene, a
 * personal (or another team's) upload only lands in its library.
 */
const handleUpload = (file, { orgId = null } = {}) => {
  // Any non-team key stands for a personal asset here.
  const owner = orgId ? teamAssetOwner(orgId) : 'personal';
  if (assetAllowedInScene(owner)) {
    return uploadAndPlaceAsset(file, undefined, undefined, undefined, {
      orgId
    });
  }
  return uploadAsset(file, { orgId }).then((res) => {
    if (!res.ok && res.error) STREET.notify.errorMessage(res.error);
  });
};

const AssetsPanel = () => {
  // A team scene opens its team's library first (#1267 Phase 4).
  const sceneOrgId = useStore((state) => state.sceneOrgId);
  return (
    <AssetsPanelBody
      defaultLibrary={sceneOrgId || null}
      sceneOrgId={sceneOrgId || null}
      placeable
      onPlaceAsset={handlePlaceAsset}
      onUpload={handleUpload}
      onUseForGenerator={(item) => openInGenerator(item, 'image')}
      onUseForVideo={(item) => openInGenerator(item, 'video')}
      onFocusScene={focusSnapshotScene}
      onSignIn={() => signIn()}
      onUpgrade={() => useStore.getState().startCheckout('storage')}
    />
  );
};

export default AssetsPanel;
