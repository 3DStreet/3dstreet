import { assetsService } from '@shared/assets';

AFRAME.registerSystem('asset-fallback', {
  init() {
    this._retried = new Set();
    this._onModelError = this._onModelError.bind(this);
    this.el.addEventListener('model-error', this._onModelError);
  },

  remove() {
    this.el.removeEventListener('model-error', this._onModelError);
  },

  async _onModelError(e) {
    const entity = e.target;
    const assetId = entity.getAttribute('data-asset-id');
    const ownerUid = entity.getAttribute('data-asset-owner-uid');
    if (!assetId || !ownerUid) return;

    // One retry attempt per assetId per session — prevents loops if the fresh
    // URL also fails (URL unchanged, genuine 403, deleted asset, etc.).
    if (this._retried.has(assetId)) return;
    this._retried.add(assetId);

    const currentSrc = entity.getAttribute('gltf-model') || '';
    console.warn(
      `[asset-fallback] model-error on asset ${assetId} — fetching fresh URL`
    );

    let freshDoc;
    try {
      freshDoc = await assetsService.getAsset(assetId, ownerUid);
    } catch (err) {
      console.warn('[asset-fallback] could not fetch asset doc:', err);
      return;
    }

    if (!freshDoc) {
      console.warn(`[asset-fallback] asset ${assetId} not found in Firestore`);
      return;
    }

    const freshUrl = freshDoc.optimizedSourceUrl ?? freshDoc.storageUrl;
    if (!freshUrl) {
      console.warn(`[asset-fallback] asset ${assetId} has no usable URL`);
      return;
    }

    // Only retry if the URL has actually changed — if it's the same the 403
    // is not a stale-token problem and we should not loop.
    const currentUrl = currentSrc.replace(/^url\(|\)$/g, '');
    if (freshUrl === currentUrl) {
      console.warn(
        `[asset-fallback] fresh URL matches current — not a stale-token issue, giving up`
      );
      return;
    }

    console.log(
      `[asset-fallback] retrying asset ${assetId} with refreshed URL`
    );
    entity.setAttribute('gltf-model', `url(${freshUrl})`);
  }
});
