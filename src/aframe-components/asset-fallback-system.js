import { assetsService } from '@shared/assets';

AFRAME.registerSystem('asset-fallback', {
  init() {
    // assetId → URLs already tried this session. Bounds retries to the asset's distinct URLs
    // (served/optimized, then the Firebase original), so a URL that keeps failing never loops.
    this._tried = new Map();
    this._exhausted = new Set();
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

    const currentSrc = entity.getAttribute('gltf-model') || '';
    const currentUrl = currentSrc.replace(/^url\(|\)$/g, '');
    let tried = this._tried.get(assetId);
    if (!tried) this._tried.set(assetId, (tried = new Set()));
    tried.add(currentUrl);
    // Every candidate URL already failed (or the doc fetch did): nothing left to try.
    if (this._exhausted.has(assetId)) return;

    console.warn(
      `[asset-fallback] model-error on asset ${assetId} — fetching fresh URL`
    );

    let freshDoc;
    try {
      freshDoc = await assetsService.getAsset(assetId, ownerUid);
    } catch (err) {
      console.warn('[asset-fallback] could not fetch asset doc:', err);
      this._exhausted.add(assetId);
      return;
    }

    if (!freshDoc) {
      console.warn(`[asset-fallback] asset ${assetId} not found in Firestore`);
      this._exhausted.add(assetId);
      return;
    }

    // Preferred URL first (a refreshed download token, or an optimized variant produced
    // since the scene was saved), then the Firebase original. The original is never deleted
    // while the asset lives, so it covers an unreachable off-bucket optimized variant
    // (e.g. a progressive model on the Needle CDN, #1990). A URL equal to the failing one is
    // not a stale-token problem and is skipped rather than retried.
    const freshUrl = [freshDoc.optimizedSourceUrl, freshDoc.storageUrl].find(
      (url) => url && !tried.has(url)
    );
    if (!freshUrl) {
      console.warn(
        `[asset-fallback] asset ${assetId} has no untried URL — giving up`
      );
      this._exhausted.add(assetId);
      return;
    }

    const kind =
      freshUrl === freshDoc.storageUrl && freshDoc.optimizedSourceUrl
        ? 'original'
        : 'refreshed';
    console.warn(`[asset-fallback] retrying asset ${assetId} with ${kind} URL`);
    entity.setAttribute('gltf-model', `url(${freshUrl})`);
  }
});
