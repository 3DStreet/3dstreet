import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatCurrency,
  formatNumber,
  getActiveLocale
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

  describe('getActiveLocale', () => {
    it('prefers the stored locale', () => {
      localStorage.setItem('locale', 'pt-BR');
      expect(getActiveLocale()).toBe('pt-BR');
    });
  });
});
