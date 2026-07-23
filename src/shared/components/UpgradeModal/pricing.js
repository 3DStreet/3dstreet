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

// Feature-list copy used across the modal and surface registry. Uses the
// Pro monthly figure (the baseline both paid tiers include); the tier-specific
// monthly token floor is communicated on the price display row.
export const TOKEN_FEATURE_LINE = `${PRICING.pro.monthly.tokens} AI generation tokens / month`;
