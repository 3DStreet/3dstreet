const admin = require('firebase-admin');

// Provider mix for image models that run on more than one provider.
//
// A model with a `falFallback` (replicate-models.js) is split between
// Replicate and fal by weight, on purpose: the second path is exercised every
// day, so it is known-good when the first one breaks, and the SRE check sees
// both side by side. On top of the weights, a per-provider circuit breaker
// sends everything to the other provider after a run of consecutive failures.
//
// Weights live in Firestore doc `config/providerRouting` (admin-only; clients
// never read it), editable without a deploy:
//
//   { image: { 'nano-banana-pro': { replicate: 0.8, fal: 0.2 } } }
//
// A bare string pins one provider: { image: { 'nano-banana-pro': 'fal' } }.
// A missing doc/entry uses DEFAULT_WEIGHTS; a read error or a malformed entry
// falls back to Replicate only, so a bad edit or a Firestore blip can never
// take generation down.
//
// Breaker: outcomes come from generationLog (the terminal processor writes one
// row per finished job, with provider + modelId). Failures surface
// asynchronously (the job is accepted, then fails), so the breaker reads
// recent outcomes rather than submit results. Volume is a handful of renders
// per provider per day, too few for a failure *rate*, so it trips on a
// STREAK: TRIP_STREAK consecutive failures. While tripped, the provider gets
// no traffic except one probe request once PROBE_MS has passed since its last
// attempt; a probe success closes the breaker.

const DEFAULT_WEIGHTS = { replicate: 0.8, fal: 0.2 };
const PROVIDERS = ['replicate', 'fal'];
const TRIP_STREAK = 3;
const PROBE_MS = 15 * 60 * 1000;
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 30 * 1000;

/**
 * Normalize a routing-doc entry to { replicate, fal } weights summing to 1.
 * Returns null for anything unusable.
 */
function normalizeWeights(entry) {
  if (entry === undefined || entry === null) return { ...DEFAULT_WEIGHTS };
  if (typeof entry === 'string') {
    return PROVIDERS.includes(entry)
      ? Object.fromEntries(PROVIDERS.map((p) => [p, p === entry ? 1 : 0]))
      : null;
  }
  if (typeof entry !== 'object') return null;
  const w = {};
  for (const p of PROVIDERS) {
    const v = entry[p] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    w[p] = v;
  }
  const total = w.replicate + w.fal;
  if (total <= 0) return null;
  return { replicate: w.replicate / total, fal: w.fal / total };
}

/**
 * Breaker state per provider from this model's recent outcomes.
 *
 * @param {Array<{provider: string, ok: boolean, at: number}>} outcomes
 * @returns {{[provider: string]: {streak: number, lastAt: number|null}}}
 */
function breakerState(outcomes) {
  const state = {};
  for (const p of PROVIDERS) {
    const rows = outcomes.filter((o) => o.provider === p).sort((a, b) => b.at - a.at);
    let streak = 0;
    for (const r of rows) {
      if (r.ok) break;
      streak++;
    }
    state[p] = { streak, lastAt: rows.length ? rows[0].at : null };
  }
  return state;
}

/**
 * Pick a provider. Pure (no I/O) so it is unit tested directly.
 *
 * @param {Object} args
 * @param {{replicate: number, fal: number}|null} args.weights - normalized,
 *   or null for "Replicate only" (bad config)
 * @param {Array} args.outcomes - see breakerState
 * @param {number} args.now - ms
 * @param {number} args.rand - [0, 1)
 * @returns {{provider: 'replicate'|'fal', reason: string}}
 */
function chooseProvider({ weights, outcomes, now, rand }) {
  if (!weights) return { provider: 'replicate', reason: 'bad-config' };

  const state = breakerState(outcomes);
  const tripped = (p) => state[p].streak >= TRIP_STREAK;
  const probeDue = (p) => state[p].lastAt === null || now - state[p].lastAt >= PROBE_MS;
  const enabled = PROVIDERS.filter((p) => weights[p] > 0);

  // One provider pinned: honor it, breaker or not; there's nowhere to go.
  if (enabled.length === 1) return { provider: enabled[0], reason: 'pinned' };

  const healthy = enabled.filter((p) => !tripped(p));
  if (healthy.length === 1) {
    const down = enabled.find((p) => p !== healthy[0]);
    // Let one request through to test whether the tripped provider recovered.
    if (probeDue(down)) return { provider: down, reason: 'probe' };
    return { provider: healthy[0], reason: `breaker:${down}` };
  }
  // Both healthy, or both tripped (nothing better to do): use the weights.
  const provider = rand < weights.replicate ? 'replicate' : 'fal';
  return { provider, reason: healthy.length ? 'weighted' : 'weighted-both-tripped' };
}

let docCache = { at: 0, doc: null, ok: true };
let outcomeCache = { at: 0, rows: [] };

async function readRoutingDoc() {
  if (Date.now() - docCache.at < CACHE_MS) return docCache;
  try {
    const snap = await admin.firestore().collection('config').doc('providerRouting').get();
    docCache = { at: Date.now(), doc: snap.exists ? snap.data() : null, ok: true };
  } catch (err) {
    console.error('providerRouting read failed; routing to Replicate only:', err.message);
    docCache = { at: Date.now(), doc: null, ok: false };
  }
  return docCache;
}

// Recent image outcomes, all models (one range query on the auto-indexed
// createdAt; filtered by model in memory — a few hundred rows at most).
async function readRecentOutcomes() {
  if (Date.now() - outcomeCache.at < CACHE_MS) return outcomeCache.rows;
  let rows = [];
  try {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const snap = await admin
      .firestore()
      .collection('generationLog')
      .where('createdAt', '>=', since)
      .get();
    rows = snap.docs
      .map((d) => d.data())
      .filter((d) => d.generationType === 'image' && d.createdAt?.toMillis)
      .map((d) => ({
        modelId: d.modelId || null,
        provider: d.provider,
        ok: d.status === 'succeeded',
        at: d.createdAt.toMillis()
      }));
  } catch (err) {
    // No outcomes = breaker closed; the weights still apply.
    console.error('generationLog read for provider breaker failed:', err.message);
  }
  outcomeCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Which provider an image model should be submitted to right now.
 *
 * @param {string|null} modelId - REPLICATE_MODELS key
 * @param {Object|null} modelConfig - its config entry
 * @returns {Promise<{provider: 'replicate'|'fal', reason: string}>}
 */
async function getImageProviderRoute(modelId, modelConfig) {
  if (!modelId || !modelConfig?.falFallback) {
    return { provider: 'replicate', reason: 'single-provider' };
  }
  const { doc, ok } = await readRoutingDoc();
  const weights = ok ? normalizeWeights(doc?.image?.[modelId]) : null;
  if (!weights) {
    if (ok) console.error(`providerRouting.image.${modelId} is malformed; routing to Replicate only`);
    return { provider: 'replicate', reason: 'bad-config' };
  }
  const outcomes = (await readRecentOutcomes()).filter((o) => o.modelId === modelId);
  return chooseProvider({ weights, outcomes, now: Date.now(), rand: Math.random() });
}

// Tests only.
function _resetProviderRoutingCache() {
  docCache = { at: 0, doc: null, ok: true };
  outcomeCache = { at: 0, rows: [] };
}

module.exports = {
  getImageProviderRoute,
  chooseProvider,
  normalizeWeights,
  breakerState,
  DEFAULT_WEIGHTS,
  TRIP_STREAK,
  PROBE_MS,
  _resetProviderRoutingCache
};
