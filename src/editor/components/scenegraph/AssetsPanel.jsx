/**
 * Editor-side Assets panel. Thin shell around the shared AssetsPanelBody —
 * the body owns filters, upload, usage meter, and the grid; this wrapper
 * supplies the editor-specific glue: place-in-scene at ground-pick point
 * and the editor's drop-and-place upload (placeholder entity + scene cmd).
 */

import { AssetsPanelBody } from '@shared/assets';
import {
  uploadAndPlaceAsset,
  placeCloudAsset
} from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import {
  openInGenerator,
  focusSnapshotScene
} from '@/editor/lib/asset-modal-handlers.js';
import pickPointOnGroundPlane from '@/editor/lib/pick-point-on-ground-plane';
import { signIn } from '../../api';
import useStore from '@/store';

const handlePlaceAsset = (asset) => {
  const position = pickPointOnGroundPlane({
    normalizedX: 0,
    normalizedY: -0.1,
    camera: AFRAME.INSPECTOR.camera
  });
  placeCloudAsset(asset, position);
};

const AssetsPanel = () => (
  <AssetsPanelBody
    placeable
    onPlaceAsset={handlePlaceAsset}
    onUpload={(file) => uploadAndPlaceAsset(file)}
    onUseForGenerator={(item) => openInGenerator(item, 'image')}
    onUseForVideo={(item) => openInGenerator(item, 'video')}
    onFocusScene={focusSnapshotScene}
    onSignIn={() => signIn()}
    onUpgrade={() => useStore.getState().startCheckout('storage')}
  />
);

export default AssetsPanel;
