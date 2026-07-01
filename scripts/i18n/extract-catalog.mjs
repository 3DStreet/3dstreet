#!/usr/bin/env node
/**
 * Seeds i18n keys for the runtime-populated Add Layer / model catalog (#1772).
 *
 * The Add Layer Panel and the model dropdown render cards whose `name` and
 * `description` come from `src/catalog.json` at runtime (via
 * `getGroupedMixinOptions`). Because those strings are data, not literals in the
 * source, `formatjs extract` cannot see them. This script walks catalog.json and
 * writes `catalog.<id>.name` / `catalog.<id>.description` entries into en.json so
 * the existing translate pipeline (`npm run i18n:translate`) can localize them.
 * At runtime `localizeCard()` looks these keys up by the same convention, with
 * the English catalog value as the fallback.
 *
 * This runs AFTER `formatjs extract` (which overwrites en.json wholesale), so it
 * is chained into the `i18n:extract` npm script. Idempotent: re-running only
 * refreshes the catalog.* keys and leaves everything else untouched.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EN_PATH = join(__dirname, '../../src/editor/i18n/locales/en.json');
const CATALOG_PATH = join(__dirname, '../../src/catalog.json');

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const en = JSON.parse(readFileSync(EN_PATH, 'utf8'));

let added = 0;
for (const item of catalog) {
  if (!item.id || item.display === 'none') continue;
  if (item.name) {
    en[`catalog.${item.id}.name`] = { defaultMessage: item.name };
    added++;
  }
  if (item.description) {
    en[`catalog.${item.id}.description`] = { defaultMessage: item.description };
    added++;
  }
}

// Re-sort with the same UTF-16 code-unit order formatjs uses (not
// localeCompare) so the merged catalog keys interleave without reordering the
// keys formatjs already wrote — keeps diffs minimal.
const sorted = Object.fromEntries(
  Object.entries(en).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
);
writeFileSync(EN_PATH, JSON.stringify(sorted, null, 2) + '\n');

console.log(`[i18n:extract:catalog] seeded ${added} catalog message(s)`);
