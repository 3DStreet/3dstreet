import { describe, it, expect } from 'vitest';
import { formatSharedMessage } from '../../../src/shared/i18n/sharedMessages.js';
import { SUPPORTED_LOCALE_CODES } from '../../../src/shared/i18n/locales.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SHARED_MESSAGES is hand-maintained — it is deliberately outside the formatjs
 * extraction pipeline (see the module header), so nothing else catches a new
 * entry that only got an English string. Parsing the source is the cheapest way
 * to enumerate ids without exporting the table itself.
 */
const SOURCE = readFileSync(
  resolve(__dirname, '../../../src/shared/i18n/sharedMessages.js'),
  'utf8'
);
const TABLE = SOURCE.slice(
  SOURCE.indexOf('const SHARED_MESSAGES = {'),
  SOURCE.indexOf('export function formatSharedMessage')
);
const IDS = [...TABLE.matchAll(/^ {2}([a-zA-Z0-9_]+): \{/gm)].map((m) => m[1]);

const LOCALES = SUPPORTED_LOCALE_CODES;

describe('sharedMessages', () => {
  it('finds the message table', () => {
    expect(IDS.length).toBeGreaterThan(100);
  });

  it.each(LOCALES)('has a %s string for every id', (locale) => {
    const untranslated = IDS.filter((id) => {
      const translated = formatSharedMessage(id, null, { locale });
      const english = formatSharedMessage(id, null, { locale: 'en' });
      // A locale that falls through to DEFAULT_LOCALE returns the English
      // string. Identical text is legitimate for some short labels, so only
      // flag it when the entry has no key for this locale at all.
      const start = TABLE.indexOf(`  ${id}: {`);
      const chunk = TABLE.slice(start, TABLE.indexOf('\n  },', start));
      const key = locale === 'en' ? 'en:' : `'${locale}':`;
      const hasKey = chunk.includes(key) || chunk.includes(`${locale}:`);
      return !hasKey && translated === english;
    });
    expect(untranslated).toEqual([]);
  });

  it('interpolates values into a template', () => {
    expect(
      formatSharedMessage('reoptimizeDone', {
        size: '11.6 MB',
        saved: '101 MB'
      })
    ).toBe('Reoptimized — 11.6 MB (saved 101 MB).');
  });

  it('returns the id unchanged for an unknown message', () => {
    expect(formatSharedMessage('nope-not-a-message')).toBe(
      'nope-not-a-message'
    );
  });
});
