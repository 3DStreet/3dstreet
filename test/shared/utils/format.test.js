import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatCurrency,
  formatNumber,
  getActiveLocale,
  getPeriodSuffix
} from '../../../src/shared/utils/format.js';

// Intl uses non-breaking / narrow-no-break spaces (U+00A0, U+202F) for
// grouping and before currency symbols; normalize them for stable assertions.
const norm = (s) => s.replace(/\s/g, ' ');

describe('format utils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('formatCurrency', () => {
    it('formats USD in English with a leading symbol', () => {
      expect(formatCurrency(10, { locale: 'en' })).toBe('$10');
      expect(formatCurrency(9.99, { locale: 'en' })).toBe('$9.99');
    });

    it('uses locale-specific separators and symbol placement', () => {
      expect(norm(formatCurrency(9.99, { locale: 'es' }))).toBe('9,99 $');
      expect(norm(formatCurrency(9.99, { locale: 'fr' }))).toBe('9,99 $');
    });

    it('omits cents for whole amounts but keeps them otherwise', () => {
      expect(formatCurrency(84, { locale: 'en' })).toBe('$84');
      expect(formatCurrency(84.5, { locale: 'en' })).toBe('$84.50');
    });
  });

  describe('formatNumber', () => {
    it('groups large numbers per locale', () => {
      expect(norm(formatNumber(1200.5, { locale: 'en' }))).toBe('1,200.5');
      expect(norm(formatNumber(1200.5, { locale: 'fr' }))).toBe('1 200,5');
    });
  });

  describe('getPeriodSuffix', () => {
    it('localizes the month suffix', () => {
      expect(getPeriodSuffix('month', { locale: 'en' })).toBe('/mo');
      expect(getPeriodSuffix('month', { locale: 'fr' })).toBe('/mois');
      expect(getPeriodSuffix('month', { locale: 'pt-BR' })).toBe('/mês');
      expect(getPeriodSuffix('month', { locale: 'es-MX' })).toBe('/mes');
    });

    it('localizes the year suffix', () => {
      expect(getPeriodSuffix('year', { locale: 'en' })).toBe('/year');
      expect(getPeriodSuffix('year', { locale: 'fr' })).toBe('/an');
    });

    it('falls back to English for unknown locales', () => {
      expect(getPeriodSuffix('month', { locale: 'de' })).toBe('/mo');
    });
  });

  describe('getActiveLocale', () => {
    const setLanguages = (languages) =>
      Object.defineProperty(window.navigator, 'languages', {
        value: languages,
        configurable: true
      });

    it('prefers a supported stored locale', () => {
      localStorage.setItem('locale', 'pt-BR');
      expect(getActiveLocale()).toBe('pt-BR');
    });

    it('detects a supported locale from the browser when none stored', () => {
      setLanguages(['fr-FR']);
      expect(getActiveLocale()).toBe('fr');
    });

    it('never returns an unmatched browser locale (would mismatch the UI)', () => {
      setLanguages(['de-DE', 'ar-SA']);
      expect(getActiveLocale()).toBe('en');
    });

    it('ignores an unsupported stored value', () => {
      localStorage.setItem('locale', 'zz');
      setLanguages(['en-US']);
      expect(getActiveLocale()).toBe('en');
    });
  });
});
