import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALE_CODES,
  detectBrowserLocale,
  resolveInitialLocale,
  persistLocale
} from '../../../src/editor/i18n/config.js';

function setLanguages(languages) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true
  });
}

describe('i18n config', () => {
  beforeEach(() => {
    localStorage.clear();
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

  describe('resolveInitialLocale', () => {
    it('uses a stored preference when present', () => {
      persistLocale('pt-BR');
      setLanguages(['es-MX']);
      expect(resolveInitialLocale()).toBe('pt-BR');
    });

    it('falls back to browser detection with no stored preference', () => {
      setLanguages(['es-AR']);
      expect(resolveInitialLocale()).toBe('es');
    });

    it('ignores an unsupported stored preference', () => {
      localStorage.setItem('locale', 'zz');
      setLanguages(['en']);
      expect(resolveInitialLocale()).toBe('en');
    });
  });

  it('supports exactly en, es, pt-BR', () => {
    expect(SUPPORTED_LOCALE_CODES).toEqual(['en', 'es', 'pt-BR']);
  });
});
