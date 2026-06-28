import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// posthog is imported by config.js; stub it so feature-flag resolution is
// deterministic in tests.
vi.mock('posthog-js', () => ({
  default: { isFeatureEnabled: vi.fn(() => false) }
}));

import posthog from 'posthog-js';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALE_CODES,
  detectBrowserLocale,
  resolveInitialLocale,
  isI18nEnabled,
  persistLocale
} from '../../../src/editor/i18n/config.js';

function setLanguages(languages) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true
  });
}

function setSearch(search) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    configurable: true
  });
}

describe('i18n config', () => {
  beforeEach(() => {
    localStorage.clear();
    setSearch('');
    posthog.isFeatureEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectBrowserLocale', () => {
    it('maps any Spanish region to es', () => {
      setLanguages(['es-MX', 'en']);
      expect(detectBrowserLocale()).toBe('es');
    });

    it('maps any Portuguese region to pt-BR', () => {
      setLanguages(['pt-PT']);
      expect(detectBrowserLocale()).toBe('pt-BR');
    });

    it('falls back to English when nothing matches', () => {
      setLanguages(['fr-FR', 'de']);
      expect(detectBrowserLocale()).toBe(DEFAULT_LOCALE);
    });

    it('respects preference order', () => {
      setLanguages(['en-US', 'es-ES']);
      expect(detectBrowserLocale()).toBe('en');
    });
  });

  describe('isI18nEnabled', () => {
    it('is off by default', () => {
      expect(isI18nEnabled()).toBe(false);
    });

    it('honors the ?i18n=true URL override', () => {
      setSearch('?i18n=true');
      expect(isI18nEnabled()).toBe(true);
    });

    it('honors the ?i18n=false URL override over the flag', () => {
      posthog.isFeatureEnabled.mockReturnValue(true);
      setSearch('?i18n=false');
      expect(isI18nEnabled()).toBe(false);
    });

    it('honors the localStorage override', () => {
      localStorage.setItem('i18nEnabled', 'true');
      expect(isI18nEnabled()).toBe(true);
    });

    it('falls back to the PostHog feature flag', () => {
      posthog.isFeatureEnabled.mockReturnValue(true);
      expect(isI18nEnabled()).toBe(true);
    });
  });

  describe('resolveInitialLocale', () => {
    it('forces English when the experiment is disabled', () => {
      setLanguages(['es-MX']);
      expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
    });

    it('uses a stored preference when enabled', () => {
      setSearch('?i18n=true');
      persistLocale('pt-BR');
      expect(resolveInitialLocale()).toBe('pt-BR');
    });

    it('falls back to browser detection when enabled with no stored pref', () => {
      setSearch('?i18n=true');
      setLanguages(['es-AR']);
      expect(resolveInitialLocale()).toBe('es');
    });

    it('ignores an unsupported stored preference', () => {
      setSearch('?i18n=true');
      localStorage.setItem('locale', 'zz');
      setLanguages(['en']);
      expect(resolveInitialLocale()).toBe('en');
    });
  });

  it('supports exactly en, es, pt-BR', () => {
    expect(SUPPORTED_LOCALE_CODES).toEqual(['en', 'es', 'pt-BR']);
  });
});
