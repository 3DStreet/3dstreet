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

const FALLBACK_LOCALE = 'en';

export function getActiveLocale() {
  try {
    const stored = localStorage.getItem('locale');
    if (stored) return stored;
  } catch {
    // localStorage unavailable (private mode / SSR)
  }
  try {
    return navigator.language || FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
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
