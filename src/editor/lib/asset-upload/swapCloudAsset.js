/**
 * Repoint every entity in the scene that references one cloud asset at
 * another. Used after "Copy to my library": the copy is a new doc under the
 * viewer's own uid, and the scene should load it instead of the original it
 * was copied from — otherwise the copy sits unused in the gallery while the
 * scene keeps depending on another user's asset.
 *
 * Every matching entity is swapped, not just the one whose panel opened the
 * modal: a scene with the same model placed several times should not end up
 * half migrated. GLB only, matching copyAssetToLibrary.
 *
 * Goes through one MultiCommand of entityupdate commands, like the upload
 * finalize in uploadAndPlaceAsset.js, so the editor marks the scene dirty and
 * the whole swap is one undo step.
 *
 * @param {{ assetId: string, ownerUid: string }} source - The referenced asset.
 * @param {object} copy - The new asset doc (from copyAssetToLibrary).
 * @returns {number} How many entities were repointed.
 */

import { getServedUrl } from '@shared/assets';

export function swapCloudAssetInScene(source, copy) {
  if (!source?.assetId || !source?.ownerUid || !copy?.assetId) return 0;
  const servedUrl = getServedUrl(copy);
  if (!servedUrl) return 0;
  const scene = AFRAME.scenes[0];
  if (!scene || !AFRAME.INSPECTOR) return 0;

  const entities = [
    ...scene.querySelectorAll(
      `[gltf-model][data-asset-id="${source.assetId}"]` +
        `[data-asset-owner-uid="${source.ownerUid}"]`
    )
  ];
  if (!entities.length) return 0;

  const updates = entities.flatMap((entity) => [
    [
      'entityupdate',
      {
        entity,
        component: 'gltf-model',
        value: `url(${servedUrl})`,
        noSelectEntity: true
      }
    ],
    [
      'entityupdate',
      {
        entity,
        component: 'data-asset-id',
        value: copy.assetId,
        noSelectEntity: true
      }
    ],
    [
      'entityupdate',
      {
        entity,
        component: 'data-asset-owner-uid',
        value: copy.userId,
        noSelectEntity: true
      }
    ]
  ]);
  AFRAME.INSPECTOR.execute('multi', updates, 'Copy asset to my library');
  return entities.length;
}
