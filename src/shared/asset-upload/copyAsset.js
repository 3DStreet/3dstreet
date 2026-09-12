/**
 * Copy another user's asset into the signed-in user's own library.
 *
 * A saved scene references cloud models by owner + asset id, and Save As
 * copies only the scene JSON: every model in the copy still loads from the
 * original owner's Storage. That is fine for a remix, but the forker cannot
 * touch those assets (details modal is read-only for non-owners, and the
 * Firestore update rule refuses them) and they vanish if the owner deletes
 * them. This is the explicit "make it mine" step: download the original and
 * run it through the ordinary upload path, so the copy is optimized by the
 * current pipeline, counts against the copier's quota, and gets its own
 * thumbnail and doc. Only GLB today: copying a splat would re-run the paid
 * server-side RAD job.
 *
 * Provenance is kept on the new doc as `copiedFrom: { assetId, ownerUid }`.
 * The source doc's attribution (author / license / source, possibly edited
 * by the owner) is carried over instead of re-extracting from the file.
 *
 * @param {object} asset - The source Firestore asset doc (public-readable).
 * @param {object} [opts]
 * @param {(stage: string) => void} [opts.onStatus] - uploadAsset's stages,
 *   preceded by 'downloading'.
 * @returns {Promise<{ok: boolean, assetId?: string, error?: string,
 *   cancelled?: boolean}>} uploadAsset's result shape; never throws for the
 *   expected failures (offline, quota, busy) — they come back as `error`.
 */

import { uploadAsset } from './uploadAsset.js';

export async function copyAssetToLibrary(asset, { onStatus } = {}) {
  if (!asset?.assetId || !asset?.userId || !asset?.storageUrl) {
    return { ok: false, error: 'This asset cannot be copied.' };
  }
  if (asset.type === 'splat') {
    return { ok: false, error: 'Splats cannot be copied yet.' };
  }

  onStatus?.('downloading');
  let blob;
  try {
    const response = await fetch(asset.storageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (err) {
    // Same failure surface as reoptimizeAsset: an opaque "Failed to fetch"
    // here is nearly always the bucket's CORS config, not the network.
    console.error('[copyAsset] download failed', err);
    return { ok: false, error: 'Could not download the original.' };
  }

  const filename = asset.originalFilename || asset.filename || 'model.glb';
  const file = new File([blob], filename, {
    type: blob.type || 'model/gltf-binary'
  });

  return uploadAsset(file, {
    onStatus,
    metadata: {
      ...(asset.name ? { name: asset.name } : {}),
      copiedFrom: { assetId: asset.assetId, ownerUid: asset.userId }
    },
    attribution: asset.attribution ?? null
  });
}
