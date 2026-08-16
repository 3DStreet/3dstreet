/**
 * Single source of truth for plan amounts shown in UpgradeModal +
 * paywallSurfaces feature lists. Keep these in sync with the server-side
 * allotments in public/functions/index.js (the PRICE_CONFIG token map in the
 * Stripe webhook) and the monthly refill allowances in
 * public/functions/token-management.js — those run in a separate Firebase
 * Functions deployment and can't share imports, so any change here means a
 * matching change there.
 *
 * Shape: PRICING[tier][cycle]. `pro` and `max` are the two paid tiers; MAX is
 * a superset of PRO (all Pro features plus more storage and tokens). Prices
 * mirror the public pricing page (3dstreet.com/pricing).
 *
 * Tokens are a monthly metered floor (PRO 100/mo, MAX 500/mo, no rollover) — the
 * same on monthly and annual. Annual's only advantage is the ~30% price discount;
 * there is no up-front token bonus on either cycle, so `tokens` is identical
 * across cycles within a tier.
 */

import { formatCurrency, getPeriodSuffix } from '@shared/utils/format';
import { formatSharedMessage } from '@shared/i18n/sharedMessages';

// Local so cycleDetail and the exposed yearlyTotal fields can't drift.
const PRO_YEARLY_TOTAL = 84;
const MAX_YEARLY_TOTAL = 420;

export const PRICING = {
  pro: {
    monthly: {
      pricePerMonth: 10,
      tokens: 100,
      // Getters so the copy/price/period reflect the CURRENT locale each
      // render, not whatever locale happened to be active when this module
      // first loaded (which is before the user could switch languages).
      get cycleDetail() {
        return formatSharedMessage('billedMonthly');
      }
    },
    yearly: {
      pricePerMonth: 7,
      yearlyTotal: PRO_YEARLY_TOTAL,
      tokens: 100,
      get cycleDetail() {
        return formatSharedMessage('billedYearly', {
          total: formatCurrency(PRO_YEARLY_TOTAL),
          period: getPeriodSuffix('year')
        });
      }
    }
  },
  max: {
    monthly: {
      pricePerMonth: 50,
      tokens: 500,
      get cycleDetail() {
        return formatSharedMessage('billedMonthly');
      }
    },
    yearly: {
      pricePerMonth: 35,
      yearlyTotal: MAX_YEARLY_TOTAL,
      tokens: 500,
      get cycleDetail() {
        return formatSharedMessage('billedYearly', {
          total: formatCurrency(MAX_YEARLY_TOTAL),
          period: getPeriodSuffix('year')
        });
      }
    }
  }
};

// sharedMessages id for the monthly-token feature line, used across the modal
// and surface registry feature lists. Exported as a constant so UpgradeModal
// can identify (and filter) the token line in any surface's featureIds — the
// tier-specific monthly floor is communicated on the price display row instead.
export const TOKEN_FEATURE_KEY = 'featTokensMonthly';

// One-time gen-token packs (#1374) — paid plans only, shown in BuyTokensModal.
// Pricing (v1): flat $0.10/token, no volume discount — matches the
// subscription per-token price exactly (PRO $10/100, MAX $50/500). Mirrors the
// server copy in public/functions/token-packs.js (separate deployment, can't
// share imports); test/shared/pricing-sync.test.js guards the two against
// drifting and enforces the flat rate. Purchased tokens are added to the
// balance and never clawed back by the monthly refill — but they do NOT stack
// on top of it (top-up-to-floor: a balance above the plan allowance absorbs
// the refill until spent back down), so UI copy must not claim stacking.
export const TOKEN_PACKS = [
  { id: 'starter', name: 'Starter', tokens: 100, price: 10 },
  { id: 'standard', name: 'Standard', tokens: 250, price: 25 },
  { id: 'power', name: 'Power', tokens: 500, price: 50 }
];
