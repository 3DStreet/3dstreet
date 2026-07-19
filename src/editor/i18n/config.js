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

// The canonical locale codes + browser-language matching live in @shared so the
// shared number/price formatter resolves the exact same locale (see #656).
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALE_CODES,
  detectBrowserLocale
} from '@shared/i18n/locales';

import {
  SUPPORTED_LOCALE_CODES as SUPPORTED_LOCALE_CODES_INTERNAL,
  detectBrowserLocale as detectBrowserLocaleInternal
} from '@shared/i18n/locales';
import { notifyLocaleChanged } from '@shared/i18n/sharedMessages';

/**
 * Locales we ship message catalogs for, with their endonym labels for the
 * language switcher. Codes must match SUPPORTED_LOCALE_CODES.
 */
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'fr', label: 'Français' }
];

const LOCALE_STORAGE_KEY = 'locale';

/**
 * Resolves the locale to use at startup: an explicit stored preference (set via
 * the language switcher) wins over browser detection.
 */
export function resolveInitialLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALE_CODES_INTERNAL.includes(stored)) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return detectBrowserLocaleInternal();
}

export function persistLocale(code) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  // Shared components (@shared/*) resolve their strings outside react-intl —
  // let them know the language changed so they re-render (see sharedMessages).
  notifyLocaleChanged();
}
