/**
 * Cross-deployment drift guard for the plan token amounts.
 *
 * The tier/cycle/token mapping is duplicated across the frontend bundle and the
 * Cloud Functions deployment, which can't share imports:
 *   - PRICING                (src/shared/components/UpgradeModal/pricing.js) — UI
 *   - PRICE_CONFIG           (public/functions/index.js)        — Stripe webhook grant
 *   - *_MONTHLY_ALLOWANCE    (public/functions/token-management.js) — monthly refill
 *
 * Nothing fails at build time if one drifts from the others; the user just sees
 * a token count that doesn't match what they're granted. This test reads the
 * functions source as text (so it doesn't have to import firebase-admin) and
 * asserts every source agrees on PRO=100 / MAX=500. If you change a token
 * amount, update all three and this test confirms they stayed in sync.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PRICING } from '@shared/components/UpgradeModal/pricing';

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('plan token amounts stay in sync across deployments', () => {
  it('PRICING uses one monthly floor per tier (annual carries no token bonus)', () => {
    // The discount-only model: tokens are identical across cycles within a tier.
    expect(PRICING.pro.monthly.tokens).toBe(PRICING.pro.yearly.tokens);
    expect(PRICING.max.monthly.tokens).toBe(PRICING.max.yearly.tokens);
    // Max is a superset of Pro, so its allowance must be the larger one.
    expect(PRICING.max.monthly.tokens).toBeGreaterThan(
      PRICING.pro.monthly.tokens
    );
  });

  it('token-management.js refill allowances match PRICING', () => {
    const src = read('public/functions/token-management.js');
    const pro = Number(src.match(/PRO_MONTHLY_ALLOWANCE\s*=\s*(\d+)/)?.[1]);
    const max = Number(src.match(/MAX_MONTHLY_ALLOWANCE\s*=\s*(\d+)/)?.[1]);

    expect(pro).toBe(PRICING.pro.monthly.tokens);
    expect(max).toBe(PRICING.max.monthly.tokens);
  });

  it('Stripe webhook PRICE_CONFIG grants match PRICING for every tier', () => {
    const src = read('public/functions/index.js');
    // Pull each { tier: 'PRO'|'MAX', ... tokens: N } entry from PRICE_CONFIG.
    const entries = [
      ...src.matchAll(/tier:\s*'(PRO|MAX)'[^}]*?tokens:\s*(\d+)/g)
    ].map((m) => ({ tier: m[1], tokens: Number(m[2]) }));

    // Sanity: we found all four (PRO/MAX × monthly/annual) entries.
    expect(entries).toHaveLength(4);

    const expected = {
      PRO: PRICING.pro.monthly.tokens,
      MAX: PRICING.max.monthly.tokens
    };
    for (const { tier, tokens } of entries) {
      expect(tokens).toBe(expected[tier]);
    }
  });
});
