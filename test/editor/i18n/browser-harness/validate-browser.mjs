/**
 * Headless real-browser validation of the i18n catalogs (#656).
 *
 * Bundles the harness (entry.jsx) with esbuild, loads it in headless Chromium
 * via Playwright, switches locale en → es → pt-BR, and asserts the rendered
 * text actually changes and matches the translated catalogs. Writes a
 * screenshot per locale to scratchpad for visual evidence.
 *
 * Run: node test/editor/i18n/browser-harness/validate-browser.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../../..');
const OUT_DIR =
  process.env.I18N_SHOT_DIR ||
  '/tmp/claude-0/-home-user-3dstreet/feb210f4-ef9f-5cf1-b787-cf705cfb15c8/scratchpad';

// esbuild is vendored under storybook in this repo.
const esbuild = require(
  join(ROOT, 'node_modules/storybook/node_modules/esbuild')
);
const { chromium } = require('playwright');

const LOCALES_DIR = join(ROOT, 'src/editor/i18n/locales');
const enRaw = JSON.parse(readFileSync(join(LOCALES_DIR, 'en.json'), 'utf8'));
const es = JSON.parse(readFileSync(join(LOCALES_DIR, 'es.json'), 'utf8'));
const ptBR = JSON.parse(readFileSync(join(LOCALES_DIR, 'pt-BR.json'), 'utf8'));
const en = Object.fromEntries(
  Object.entries(enRaw).map(([id, d]) => [
    id,
    typeof d === 'string' ? d : d.defaultMessage
  ])
);

function pickProbes(catalog) {
  // Keys whose translation actually differs from English (so we can prove the
  // locale switch took effect, not just that English fell through).
  return Object.keys(catalog)
    .filter((id) => en[id] && catalog[id] && catalog[id] !== en[id])
    .slice(0, 8);
}

async function main() {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, 'entry.jsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    absWorkingDir: ROOT
  });
  const bundle = result.outputFiles[0].text;

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle}</script></body></html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="strings"] [data-key]');

  const failures = [];
  const checks = [
    ['en', en],
    ['es', es],
    ['pt-BR', ptBR]
  ];

  for (const [locale, catalog] of checks) {
    await page.selectOption('[data-testid="locale-select"]', locale);
    // Wait for a known probe to reflect the switch.
    const probes = locale === 'en' ? Object.keys(en).slice(0, 8) : pickProbes(catalog);
    for (const id of probes) {
      const expected = catalog[id] ?? en[id];
      const actual = await page
        .locator(`[data-key="${id}"]`)
        .innerText();
      if (actual.trim() !== String(expected).trim()) {
        failures.push(
          `[${locale}] "${id}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
      }
    }
    const shot = join(OUT_DIR, `i18n-harness-${locale.replace('/', '-')}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`[${locale}] verified ${probes.length} probe key(s); screenshot → ${shot}`);
  }

  await browser.close();

  if (errors.length) {
    console.error('Page errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (failures.length) {
    console.error('FAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  // Sanity: each translated catalog must contain at least a few real (differing)
  // translations, otherwise we proved nothing.
  for (const [locale, catalog] of [['es', es], ['pt-BR', ptBR]]) {
    const diffs = pickProbes(catalog).length;
    if (diffs < 3) {
      console.error(`[${locale}] only ${diffs} differing translations found — catalog looks empty/untranslated.`);
      process.exit(1);
    }
  }
  console.log('\n✅ i18n browser validation passed for en, es, pt-BR.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
