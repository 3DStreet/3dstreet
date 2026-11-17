/**
 * Image provider mix (public/functions/provider-routing.js): weights from
 * config/providerRouting plus a consecutive-failure breaker. Only the pure
 * decision logic is tested here; the Firestore reads are thin wrappers.
 */
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  chooseProvider,
  normalizeWeights,
  breakerState,
  DEFAULT_WEIGHTS,
  TRIP_STREAK,
  PROBE_MS
} = require('../../public/functions/provider-routing.js');

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
// Outcomes newest-last for readability; breakerState sorts by time.
const runs = (provider, results, { endAgo = 1 * MIN } = {}) =>
  results.map((ok, i) => ({
    provider,
    ok,
    at: NOW - endAgo - (results.length - 1 - i) * MIN
  }));
const fails = (n) => Array(n).fill(false);

describe('normalizeWeights', () => {
  it('defaults when the model has no entry', () => {
    expect(normalizeWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
  });
  it('normalizes to a sum of 1', () => {
    expect(normalizeWeights({ replicate: 1, fal: 1 })).toEqual({
      replicate: 0.5,
      fal: 0.5
    });
    expect(normalizeWeights({ replicate: 80, fal: 20 })).toEqual({
      replicate: 0.8,
      fal: 0.2
    });
  });
  it('treats a missing provider as 0', () => {
    expect(normalizeWeights({ fal: 1 })).toEqual({ replicate: 0, fal: 1 });
  });
  it('pins one provider from a bare string', () => {
    expect(normalizeWeights('fal')).toEqual({ replicate: 0, fal: 1 });
  });
  it.each([
    ['bogus'],
    [{ replicate: -1, fal: 1 }],
    [{ replicate: 0, fal: 0 }],
    [{ fal: '1' }],
    [42]
  ])('rejects %j', (entry) => {
    expect(normalizeWeights(entry)).toBeNull();
  });
});

describe('breakerState', () => {
  it('counts only the trailing failure run', () => {
    const s = breakerState([...runs('replicate', [false, true, false, false])]);
    expect(s.replicate.streak).toBe(2);
    expect(s.fal).toEqual({ streak: 0, lastAt: null });
  });
});

describe('chooseProvider', () => {
  const w = { replicate: 0.8, fal: 0.2 };

  it('splits by weight when both providers are healthy', () => {
    expect(
      chooseProvider({ weights: w, outcomes: [], now: NOW, rand: 0.79 })
        .provider
    ).toBe('replicate');
    expect(
      chooseProvider({ weights: w, outcomes: [], now: NOW, rand: 0.8 }).provider
    ).toBe('fal');
  });

  it('routes away from a provider after TRIP_STREAK consecutive failures', () => {
    const outcomes = runs('replicate', [true, ...fails(TRIP_STREAK)]);
    expect(chooseProvider({ weights: w, outcomes, now: NOW, rand: 0 })).toEqual(
      {
        provider: 'fal',
        reason: 'breaker:replicate'
      }
    );
  });

  it('does not trip below the streak threshold', () => {
    const outcomes = runs('replicate', fails(TRIP_STREAK - 1));
    expect(
      chooseProvider({ weights: w, outcomes, now: NOW, rand: 0 }).provider
    ).toBe('replicate');
  });

  it('sends one probe to a tripped provider once PROBE_MS has passed', () => {
    const outcomes = runs('replicate', fails(TRIP_STREAK), {
      endAgo: PROBE_MS
    });
    expect(
      chooseProvider({ weights: w, outcomes, now: NOW, rand: 0.99 })
    ).toEqual({
      provider: 'replicate',
      reason: 'probe'
    });
  });

  it('closes the breaker after a probe succeeds', () => {
    const outcomes = runs('replicate', [...fails(TRIP_STREAK), true]);
    expect(
      chooseProvider({ weights: w, outcomes, now: NOW, rand: 0 }).reason
    ).toBe('weighted');
  });

  it('trips fal the same way', () => {
    const outcomes = runs('fal', fails(TRIP_STREAK));
    expect(
      chooseProvider({ weights: w, outcomes, now: NOW, rand: 0.99 })
    ).toEqual({
      provider: 'replicate',
      reason: 'breaker:fal'
    });
  });

  it('falls back to the weights when both providers are tripped', () => {
    const outcomes = [
      ...runs('replicate', fails(TRIP_STREAK)),
      ...runs('fal', fails(TRIP_STREAK))
    ];
    expect(
      chooseProvider({ weights: w, outcomes, now: NOW, rand: 0.9 })
    ).toEqual({
      provider: 'fal',
      reason: 'weighted-both-tripped'
    });
  });

  it('honors a pinned provider even when it is tripped', () => {
    const outcomes = runs('fal', fails(10));
    expect(
      chooseProvider({
        weights: { replicate: 0, fal: 1 },
        outcomes,
        now: NOW,
        rand: 0
      })
    ).toEqual({
      provider: 'fal',
      reason: 'pinned'
    });
  });

  it('uses Replicate only when the config is unusable', () => {
    expect(
      chooseProvider({ weights: null, outcomes: [], now: NOW, rand: 0.99 })
        .provider
    ).toBe('replicate');
  });
});
