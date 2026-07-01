/**
 * Canonical locale list + browser-language matching, shared by the editor's
 * i18n config and the shared number/price formatting utils (#656). Lives in
 * `@shared` so both the editor and the generator resolve the *same* supported
 * locale — important because the formatter must never format numbers in a
 * locale the UI text isn't actually rendered in (e.g. an unmatched `ar-SA`
 * browser would otherwise format prices in Eastern Arabic numerals next to
 * all-English copy).
 */

export const DEFAULT_LOCALE = 'en';

// Locale codes we ship message catalogs for. Keep in sync with SUPPORTED_LOCALES
// (labels) in the editor's i18n/config.js and the catalogs in i18n/locales/.
export const SUPPORTED_LOCALE_CODES = ['en', 'es', 'pt-BR', 'fr'];

/**
 * Maps a raw BCP-47 tag (e.g. from navigator.language or localStorage) to one
 * of our supported locale codes, or null if there is no reasonable match.
 * Region-insensitive for Spanish (any es-* → es) and French (fr-* → fr);
 * Brazilian Portuguese is preferred for any pt-* tag since that is the cohort
 * we are targeting.
 */
export function matchSupportedLocale(tag) {
  if (!tag) return null;
  const lower = String(tag).toLowerCase();
  if (SUPPORTED_LOCALE_CODES.includes(tag)) return tag;
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('en')) return 'en';
  return null;
}

/**
 * Detects the best supported locale from the browser's language preferences.
 * Always returns a supported code, falling back to DEFAULT_LOCALE.
 */
export function detectBrowserLocale() {
  try {
    const candidates = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const tag of candidates) {
      const match = matchSupportedLocale(tag);
      if (match) return match;
    }
  } catch {
    // navigator unavailable (SSR / tests) — fall through to default
  }
  return DEFAULT_LOCALE;
}
