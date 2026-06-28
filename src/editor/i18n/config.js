import posthog from 'posthog-js';

/**
 * Internationalization (i18n) configuration for the 3DStreet editor.
 *
 * This module is the single source of truth for which locales exist, how we
 * detect the user's preferred language, and whether the localization feature
 * is enabled at all. See GitHub issue #656 for the rationale: i18n ships
 * behind a flag as a cheap acquisition/activation experiment (es + pt-BR),
 * measured in PostHog against the English baseline.
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

/**
 * PostHog feature flag key that gates the localization experiment. While the
 * flag is off the UI stays English-only (the switcher is hidden and any
 * non-English stored preference is ignored), so wrapping strings in
 * react-intl is always safe regardless of rollout state.
 */
export const I18N_FEATURE_FLAG = 'localization';

const LOCALE_STORAGE_KEY = 'locale';

/**
 * Returns true when the localization experiment is active for this session.
 *
 * Resolution order (first match wins):
 *   1. URL override   ?i18n=true / ?i18n=false   (handy for QA + screenshots)
 *   2. localStorage    i18nEnabled = 'true'|'false'
 *   3. PostHog feature flag (production rollout control)
 *
 * PostHog is not initialized in development (see analytics/posthog.js), so the
 * URL / localStorage overrides are the way to exercise the feature locally.
 */
export function isI18nEnabled() {
  try {
    const param = new URLSearchParams(window.location.search).get('i18n');
    if (param === 'true') return true;
    if (param === 'false') return false;

    const stored = localStorage.getItem('i18nEnabled');
    if (stored === 'true') return true;
    if (stored === 'false') return false;

    return posthog.isFeatureEnabled?.(I18N_FEATURE_FLAG) === true;
  } catch {
    return false;
  }
}

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
 * Resolves the locale to use at startup. When the experiment is disabled we
 * always return English so the app is unaffected. Otherwise an explicit stored
 * preference wins over browser detection.
 */
export function resolveInitialLocale() {
  if (!isI18nEnabled()) return DEFAULT_LOCALE;
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
