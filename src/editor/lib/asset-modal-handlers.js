/**
 * Editor-specific cross-app handoff to the generator. Used by AssetsPanel
 * (grid) and AssetInfoPanel (per-entity Details button) so both surfaces
 * behave identically when the user clicks Modify / Create Video on an image.
 *
 * Stays here (not in @shared/assets) because the generator app routes these
 * actions in-page (tab switch + ModifyTab.setImagePrompt), not via the
 * /generator/#tab URL + localStorage handoff this helper performs.
 */

import * as Sentry from '@sentry/react';
import Events from './Events';
import { encodeCameraStateToParam } from './cameraUtils.js';

/**
 * Take the user back to where a snapshot was captured (#1605). If the
 * snapshot belongs to the currently open scene, glide the camera to the
 * captured pose (event → EditorControls.focusCameraState, mirroring the
 * focus-on-entity pattern). Otherwise open the scene in a new tab — same as
 * the plain scene link — with the pose as a `?camera=` hash param that
 * set-loader-from-hash applies as the load fly-in target.
 */
export const focusSnapshotScene = (item) => {
  const sceneId = item?.metadata?.sceneId;
  const cameraState = item?.metadata?.cameraState;
  if (!cameraState) return;

  if (!sceneId || sceneId === STREET.utils.getCurrentSceneId()) {
    Events.emit('cameraposefocus', cameraState);
    return;
  }

  const cameraParam = encodeCameraStateToParam(cameraState);
  const cameraSuffix = cameraParam
    ? `?camera=${encodeURIComponent(cameraParam)}`
    : '';
  window.open(`/#/scenes/${sceneId}${cameraSuffix}`, '_blank');
};

export const openInGenerator = async (item, tabName) => {
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
