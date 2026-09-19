// Scene asset load tracker (#2009). Pure bookkeeping, no A-Frame: the
// asset-load-status system feeds it scene events and the editor subscribes.
//
// Two classes of load:
// - Deterministic entries (GLBs via gltf-model / gltf-part, textures): each
//   ends in exactly one of loaded / error / timed-out, so the scene reaches a
//   definitive state and the global indicator is a real progress count.
// - Streams (splats, 3D tiles): load continuously by design. They are never
//   part of the count; they only carry an active/idle activity flag.
//
// Entries are keyed by whatever the caller passes (an entity element for
// models and streams, a string such as `texture:<asset id>` for textures) and
// are replaced, never mutated, so React's useSyncExternalStore can compare
// them by identity. Subscribers are notified once per microtask, however many
// changes landed in between.

export const LOAD_STATUS = Object.freeze({
  PENDING: 'pending',
  LOADED: 'loaded',
  ERROR: 'error',
  TIMED_OUT: 'timed-out'
});

// Matches batch-models' LOAD_TIMEOUT_MS: past this a pending load is reported
// as timed out, but a late model-loaded / model-error still settles it.
export const DEFAULT_TIMEOUT_MS = 30000;

export const EMPTY_ASSET_LOAD_SUMMARY = Object.freeze({
  total: 0,
  pending: 0,
  loaded: 0,
  error: 0,
  timedOut: 0,
  settled: 0,
  progress: 1,
  done: false,
  streams: 0,
  streamsActive: 0,
  failures: Object.freeze([])
});

export class AssetLoadTracker {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now] clock, for tests
   * @param {(key: any) => boolean} [options.isAlive] tick() forgets entries
   *   whose key is no longer alive (an entity removed from the document).
   */
  constructor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now(),
    isAlive = () => true
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.isAlive = isAlive;
    this.entries = new Map();
    this.streams = new Map();
    this.listeners = new Set();
    this.summary = EMPTY_ASSET_LOAD_SUMMARY;
    this.summaryStale = false;
    this.notifyScheduled = false;
  }

  /**
   * A deterministic load started (or restarted) for `key`.
   * @param {any} key
   * @param {{kind?: string, src?: string, label?: string}} [meta]
   */
  begin(key, meta = {}) {
    if (key == null) return;
    const prev = this.entries.get(key);
    this.entries.set(key, {
      key,
      kind: meta.kind || (prev && prev.kind) || 'model',
      src: meta.src ?? (prev ? prev.src : undefined),
      label: meta.label ?? (prev ? prev.label : undefined),
      status: LOAD_STATUS.PENDING,
      startedAt: this.now(),
      settledAt: null
    });
    this.changed();
  }

  /**
   * A deterministic load finished. Unknown keys are ignored: a batched
   * duplicate that never started its own download re-emits model-loaded
   * without a matching begin.
   * @param {any} key
   * @param {'loaded'|'error'} status
   * @returns {boolean} whether anything changed
   */
  settle(key, status) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (status !== LOAD_STATUS.LOADED && status !== LOAD_STATUS.ERROR) {
      throw new Error(`AssetLoadTracker.settle: bad status "${status}"`);
    }
    if (entry.status === status) return false;
    this.entries.set(key, { ...entry, status, settledAt: this.now() });
    this.changed();
    return true;
  }

  /**
   * A streaming source reported activity. Registers the stream on first call.
   * @param {any} key
   * @param {boolean} active
   * @param {{kind?: string, label?: string}} [meta]
   */
  setStreaming(key, active, meta = {}) {
    if (key == null) return;
    const prev = this.streams.get(key);
    active = !!active;
    if (
      prev &&
      prev.active === active &&
      (!meta.kind || prev.kind === meta.kind)
    ) {
      return;
    }
    this.streams.set(key, {
      key,
      streaming: true,
      kind: meta.kind || (prev && prev.kind) || 'stream',
      label: meta.label ?? (prev ? prev.label : undefined),
      active,
      updatedAt: this.now()
    });
    this.changed();
  }

  /** Drop everything known about `key` (entity removed). */
  forget(key) {
    const had = this.entries.delete(key);
    const hadStream = this.streams.delete(key);
    if (had || hadStream) this.changed();
  }

  /** Drop everything (new scene). */
  reset() {
    if (this.entries.size === 0 && this.streams.size === 0) return;
    this.entries.clear();
    this.streams.clear();
    this.changed();
  }

  /**
   * Current state for `key`: a deterministic entry, else a stream record
   * (`streaming: true`), else null. Stable identity until the next change.
   */
  get(key) {
    return this.entries.get(key) || this.streams.get(key) || null;
  }

  /**
   * Periodic maintenance: time out stale pending loads and forget keys that
   * are no longer alive. Call about once a second.
   * @returns {boolean} whether anything changed
   */
  tick() {
    const now = this.now();
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (!this.isAlive(key)) {
        this.entries.delete(key);
        changed = true;
        continue;
      }
      if (
        entry.status === LOAD_STATUS.PENDING &&
        now - entry.startedAt >= this.timeoutMs
      ) {
        this.entries.set(key, {
          ...entry,
          status: LOAD_STATUS.TIMED_OUT,
          settledAt: now
        });
        changed = true;
      }
    }
    for (const key of this.streams.keys()) {
      if (!this.isAlive(key)) {
        this.streams.delete(key);
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  /**
   * Aggregate counts. Same object until something changes.
   * @returns {typeof EMPTY_ASSET_LOAD_SUMMARY}
   */
  getSummary() {
    if (!this.summaryStale) return this.summary;
    let pending = 0;
    let loaded = 0;
    let error = 0;
    let timedOut = 0;
    const failures = [];
    for (const entry of this.entries.values()) {
      switch (entry.status) {
        case LOAD_STATUS.PENDING:
          pending++;
          break;
        case LOAD_STATUS.LOADED:
          loaded++;
          break;
        case LOAD_STATUS.ERROR:
          error++;
          failures.push(entry);
          break;
        case LOAD_STATUS.TIMED_OUT:
          timedOut++;
          failures.push(entry);
          break;
      }
    }
    const total = this.entries.size;
    const settled = total - pending;
    let streamsActive = 0;
    for (const stream of this.streams.values()) {
      if (stream.active) streamsActive++;
    }
    this.summary = Object.freeze({
      total,
      pending,
      loaded,
      error,
      timedOut,
      settled,
      progress: total === 0 ? 1 : settled / total,
      done: total > 0 && pending === 0,
      streams: this.streams.size,
      streamsActive,
      failures: Object.freeze(failures)
    });
    this.summaryStale = false;
    return this.summary;
  }

  /**
   * @param {() => void} listener called (once per microtask) after changes
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  changed() {
    this.summaryStale = true;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of Array.from(this.listeners)) {
        try {
          listener();
        } catch (err) {
          console.error('[asset-load-tracker] listener failed', err);
        }
      }
    });
  }
}
