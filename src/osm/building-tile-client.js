/**
 * Main-thread handle on the buildings worker (#1962 step F): lazy worker
 * spawn, one promise per requested tile, dispose(). Duplicate requests for
 * an in-flight tile share the same promise.
 */

export class BuildingTileClient {
  /**
   * @param {Object} options
   * @param {number} options.originLat scene geo anchor
   * @param {number} options.originLon
   * @param {Object} options.source resolved vector-tile source
   *   ({ urlTemplate, buildingLayer, heightKeys, minHeightKeys } — see
   *   resolveVectorTileSource in basemap-providers.js)
   */
  constructor({ originLat, originLon, source } = {}) {
    this.originLat = originLat;
    this.originLon = originLon;
    this.source = source || {};
    this.pending = new Map(); // key → { resolve, reject }
    this.worker = null;
  }

  _ensureWorker() {
    if (this.worker) return this.worker;
    // webpack 5 turns this into a proper worker chunk.
    this.worker = new Worker(
      new URL('./building-tiles.worker.js', import.meta.url)
    );
    this.worker.onmessage = ({ data }) => {
      const entry = this.pending.get(data?.key);
      if (!entry) return;
      this.pending.delete(data.key);
      if (data.type === 'tile') entry.resolve(data);
      else {
        entry.reject(
          Object.assign(new Error(data.message), { status: data.status })
        );
      }
    };
    this.worker.onerror = (event) => {
      // A worker-level failure (chunk load, uncaught throw) fails every
      // in-flight tile; per-tile errors come through onmessage instead.
      const error = new Error(event?.message || 'buildings worker error');
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
    return this.worker;
  }

  /** → Promise<{ positions, normals, colors, indices, buildingCount, fromCache }> */
  loadTile({ key, zoom, x, y }) {
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    let resolveFn, rejectFn;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    this.pending.set(key, { promise, resolve: resolveFn, reject: rejectFn });
    this._ensureWorker().postMessage({
      type: 'load',
      key,
      zoom,
      x,
      y,
      originLat: this.originLat,
      originLon: this.originLon,
      urlTemplate: this.source.urlTemplate,
      buildingLayer: this.source.buildingLayer,
      heightKeys: this.source.heightKeys,
      minHeightKeys: this.source.minHeightKeys
    });
    return promise;
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const error = new Error('disposed');
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
