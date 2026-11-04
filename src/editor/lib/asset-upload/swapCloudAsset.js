/**
 * Repoint every entity in the scene that references one cloud asset at
 * another asset of the same type, in one undoable MultiCommand.
 *
 * Two callers:
 *   - "Copy to my library" (swapCloudAssetInScene): the copy is a new doc
 *     under the viewer's own uid, and the scene should load it instead of the
 *     original it was copied from — otherwise the copy sits unused in the
 *     gallery while the scene keeps depending on another user's asset.
 *   - "Replace" (#2142): the referenced asset is missing (deleted, purged, or
 *     from another Firebase project after a JSON import) or belongs to someone
 *     else, and the user picks a substitute from their own library.
 *
 * Every matching entity is swapped, not just the one whose panel opened the
 * modal: a scene with the same model placed several times should not end up
 * half migrated.
 *
 * Goes through one MultiCommand of entityupdate commands, like the upload
 * finalize in uploadAndPlaceAsset.js, so the editor marks the scene dirty and
 * the whole swap is one undo step.
 */

import { getServedUrl } from '@shared/assets';

/**
 * The cloud asset type an entity renders, read from its components rather
 * than the Firestore doc — a missing asset has no doc to ask.
 * @param {Element} entity
 * @returns {'mesh'|'splat'|'image'|null}
 */
export function getEntityAssetType(entity) {
  if (!entity?.hasAttribute) return null;
  if (entity.hasAttribute('splat')) return 'splat';
  if (entity.hasAttribute('gltf-model')) return 'mesh';
  if (entity.hasAttribute('material') || entity.tagName === 'A-IMAGE') {
    return 'image';
  }
  return null;
}

// The component updates that point one entity at a served URL.
function sourceUpdates(entity, type, servedUrl, target) {
  if (type === 'mesh') {
    return [
      {
        entity,
        component: 'gltf-model',
        value: `url(${servedUrl})`,
        noSelectEntity: true
      }
    ];
  }
  if (type === 'splat') {
    return [
      {
        entity,
        component: 'splat',
        property: 'src',
        value: servedUrl,
        noSelectEntity: true
      }
    ];
  }
  // Image plane: swap the texture, and keep the plane's width while matching
  // the new image's aspect ratio so it isn't stretched.
  const updates = [
    {
      entity,
      component: 'material',
      property: 'src',
      value: servedUrl,
      noSelectEntity: true
    }
  ];
  const w = target.width;
  const h = target.height;
  const planeWidth = Number(entity.getAttribute('geometry')?.width);
  if (w > 0 && h > 0 && planeWidth > 0) {
    updates.push({
      entity,
      component: 'geometry',
      property: 'height',
      value: planeWidth * (h / w),
      noSelectEntity: true
    });
  }
  return updates;
}

/**
 * @param {{ assetId: string, ownerUid: string }} source - The referenced asset.
 * @param {object} target - The asset to use instead: an asset doc
 *   ({ assetId, userId, ... }) or a gallery display item ({ id, userId, ... }).
 * @param {object} [options]
 * @param {string} [options.label] - Undo history label.
 * @returns {number} How many entities were repointed.
 */
export function replaceCloudAssetInScene(source, target, { label } = {}) {
  const targetId = target?.assetId ?? target?.id;
  const targetOwner = target?.userId ?? target?.ownerUid;
  if (!source?.assetId || !source?.ownerUid || !targetId || !targetOwner) {
    return 0;
  }
  const servedUrl = getServedUrl(target);
  if (!servedUrl) return 0;
  const scene = AFRAME.scenes[0];
  if (!scene || !AFRAME.INSPECTOR) return 0;

  const entities = [
    ...scene.querySelectorAll(
      `[data-asset-id="${source.assetId}"]` +
        `[data-asset-owner-uid="${source.ownerUid}"]`
    )
  ].filter((entity) => {
    const type = getEntityAssetType(entity);
    // Never put a model on an image plane (or vice versa): only entities
    // that render the target's type are repointed.
    return type && (!target.type || type === target.type);
  });
  if (!entities.length) return 0;

  const dims = {
    width: target.width ?? target.metadata?.width,
    height: target.height ?? target.metadata?.height
  };

  const updates = entities.flatMap((entity) =>
    [
      // Identity first, so a load error on the new URL is retried by
      // asset-fallback-system against the new doc, not the old one.
      {
        entity,
        component: 'data-asset-id',
        value: targetId,
        noSelectEntity: true
      },
      {
        entity,
        component: 'data-asset-owner-uid',
        value: targetOwner,
        noSelectEntity: true
      },
      ...sourceUpdates(entity, getEntityAssetType(entity), servedUrl, dims)
    ].map((payload) => ['entityupdate', payload])
  );
  AFRAME.INSPECTOR.execute('multi', updates, label || 'Replace asset');
  return entities.length;
}

/**
 * After "Copy to my library": repoint the scene at the copy. GLB only,
 * matching copyAssetToLibrary.
 * @param {{ assetId: string, ownerUid: string }} source
 * @param {object} copy - The new asset doc (from copyAssetToLibrary).
 * @returns {number} How many entities were repointed.
 */
export function swapCloudAssetInScene(source, copy) {
  if (!copy) return 0;
  return replaceCloudAssetInScene(
    source,
    { ...copy, type: 'mesh' },
    { label: 'Copy asset to my library' }
  );
}
