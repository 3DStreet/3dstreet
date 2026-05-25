/**
 * Editor-side Assets panel. Thin shell around the shared AssetsPanelBody —
 * the body owns filters, upload, usage meter, and the grid; this wrapper
 * supplies the editor-specific glue: place-in-scene at ground-pick point
 * and the editor's drop-and-place upload (placeholder entity + scene cmd).
 */

import * as Sentry from '@sentry/react';
import { AssetsPanelBody } from '@shared/assets';
import {
  uploadAndPlaceAsset,
  placeCloudAsset
} from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import pickPointOnGroundPlane from '@/editor/lib/pick-point-on-ground-plane';
import { signIn } from '../../api';

const handlePlaceAsset = (asset) => {
  const position = pickPointOnGroundPlane({
    normalizedX: 0,
    normalizedY: -0.1,
    camera: AFRAME.INSPECTOR.camera
  });
  placeCloudAsset(asset, position);
};

const handleCopyParams = (item) => {
  if (!item.metadata) return;
  navigator.clipboard
    .writeText(JSON.stringify(item.metadata, null, 2))
    .catch((err) => console.error('Failed to copy parameters', err));
};

const openInGenerator = async (item, tabName) => {
  try {
    const imageUrl = item.fullImageURL || item.storageUrl || item.objectURL;
    if (!imageUrl) throw new Error('No valid image URL available');

    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    try {
      localStorage.setItem(
        'pendingAssetItem',
        JSON.stringify({
          imageDataUrl: dataUrl,
          id: item.id,
          metadata: item.metadata,
          timestamp: Date.now(),
          targetTab: tabName
        })
      );
    } catch (storageError) {
      console.error('pendingAssetItem setItem failed:', storageError);
      Sentry.captureException(storageError, {
        tags: { feature: 'asset_generator_handoff' },
        extra: { targetTab: tabName, payloadBytes: dataUrl?.length }
      });
      window.STREET?.notify?.errorMessage?.(
        'This image is too large to send to the generator. Try a smaller version.'
      );
      return;
    }

    window.open(`/generator/#${tabName}`, '_blank');
  } catch (error) {
    console.error('Failed to open generator with item:', error);
  }
};

const AssetsPanel = () => (
  <AssetsPanelBody
    placeable
    onPlaceAsset={handlePlaceAsset}
    onUpload={(file) => uploadAndPlaceAsset(file)}
    onCopyParams={handleCopyParams}
    onUseForGenerator={(item) => openInGenerator(item, 'modify')}
    onUseForVideo={(item) => openInGenerator(item, 'video')}
    onSignIn={() => signIn()}
  />
);

export default AssetsPanel;
