/**
 * Internationalization (i18n) configuration for the 3DStreet editor.
 *
 * This module is the single source of truth for which locales exist and how we
 * detect the user's preferred language. See GitHub issue #656 for the rationale:
 * i18n is a cheap acquisition/activation experiment (es + pt-BR) measured in
 * PostHog against the English baseline. The locale cohort is still tracked in
 * PostHog (see store.js / index.jsx); shipping is gated by merging this branch,
 * not by a runtime flag.
 */

export const DEFAULT_LOCALE = 'en';

/**
 * Locales we ship message catalogs for. The first entry must be DEFAULT_LOCALE.
 * `label` is shown in the language switcher (in the language's own name so it
 * is recognizable regardless of the current UI language).
 */
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt-BR', label: 'Português (Brasil)' }
];

export const SUPPORTED_LOCALE_CODES = SUPPORTED_LOCALES.map((l) => l.code);

const LOCALE_STORAGE_KEY = 'locale';

/**
 * Maps a raw BCP-47 tag (e.g. from navigator.language) to one of our supported
 * locale codes, or null if there is no reasonable match. Region-insensitive for
 * Spanish (any es-* → es); Brazilian Portuguese is preferred for any pt-* tag
 * since that is the cohort we are targeting (#656).
 */
function matchSupportedLocale(tag) {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (SUPPORTED_LOCALE_CODES.includes(tag)) return tag;
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('en')) return 'en';
  return null;
}

/**
 * Detects the best supported locale from the browser's language preferences.
 * Falls back to DEFAULT_LOCALE when nothing matches.
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

/**
 * Resolves the locale to use at startup: an explicit stored preference (set via
 * the language switcher) wins over browser detection.
 */
export function resolveInitialLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALE_CODES.includes(stored)) return stored;
  } catch {
    // ignore storage errors
  }
  return detectBrowserLocale();
}

export function persistLocale(code) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
}
