/**
 * Locale-aware number/price formatting (#656).
 *
 * These helpers are intentionally framework-agnostic (plain `Intl.NumberFormat`,
 * no react-intl context) because they run in shared components used by BOTH the
 * editor and the generator, and the generator has no IntlProvider. The active
 * locale is read from the same `locale` key the editor persists to
 * localStorage, falling back to the browser language, then English.
 *
 * Always format prices and large numbers through these — never hardcode
 * "$9.99" or "1,200.50", which are wrong in most locales (e.g. fr: "9,99 $",
 * "1 200,50").
 */

import { matchSupportedLocale, detectBrowserLocale } from '../i18n/locales';

/**
 * The locale to format numbers/prices in. Resolves to one of our SUPPORTED
 * locales — the same one the UI text renders in — so formatting never diverges
 * from the displayed language. An explicit stored choice wins; otherwise we
 * detect from the browser (vetted, falling back to English). We deliberately do
 * NOT return a raw, unmatched browser locale: that could format prices in a
 * different numbering system than the surrounding English copy.
 */
export function getActiveLocale() {
  try {
    const matched = matchSupportedLocale(localStorage.getItem('locale'));
    if (matched) return matched;
  } catch {
    // localStorage unavailable (private mode / SSR)
  }
  return detectBrowserLocale();
}

/**
 * Formats a money amount in the active locale. Whole amounts render without
 * cents ($10), fractional amounts keep them ($9.99). Falls back to a plain
 * "$amount" string if Intl throws (unknown locale/currency).
 */
export function formatCurrency(
  amount,
  { locale = getActiveLocale(), currency = 'USD', ...options } = {}
) {
  // Whole amounts read better without cents ($10); fractional amounts keep the
  // conventional two decimals ($9.99, $84.50).
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Prefer the narrow symbol ("$") over the code-y default ("US$") so
      // formatted prices read naturally, e.g. fr "9,99 $", es "9,99 $".
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      ...options
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

/**
 * Formats a number with locale-aware grouping/decimal separators.
 */
export function formatNumber(
  value,
  { locale = getActiveLocale(), ...options } = {}
) {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

// Short billing-period suffixes ("/mo", "/year"). Intl can format a number
// WITH a duration unit ("10 months") but has no currency-per-period compound,
// and the compact "/mo" convention is UI copy — so we keep a small curated
// table keyed by base language (es/pt/fr/en). Falls back to English.
const PERIOD_SUFFIX = {
  month: { en: '/mo', es: '/mes', pt: '/mês', fr: '/mois' },
  year: { en: '/year', es: '/año', pt: '/ano', fr: '/an' }
};

/**
 * Localized short billing-period suffix, e.g. 'month' → "/mo" (en), "/mois"
 * (fr), "/mês" (pt-BR). Pair with formatCurrency for "10 $/mois"-style prices.
 */
export function getPeriodSuffix(period, { locale = getActiveLocale() } = {}) {
  const base = String(locale).toLowerCase().split('-')[0];
  const map = PERIOD_SUFFIX[period] || {};
  return map[base] || map.en || '';
}
