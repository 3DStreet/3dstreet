import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import path from 'path';

// Browser-mode config for A-Frame component tests. These run in a real
// Chromium (via Playwright) because the components are Custom Elements with a
// WebGL scene, which jsdom does not implement correctly.
//
// Separate from vitest.config.js (jsdom) because these run in a real browser.
// The JS deps (A-Frame, @vitest/browser, Playwright) are in devDependencies;
// the Chromium headless-shell binary is downloaded via `npm run test:setup`.
// A-Frame is loaded from a CDN build in the app itself, but the tests import
// the npm package so they can register the components in isolation.
export default defineConfig({
  test: {
    include: ['test/components/**/*.test.js'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Use the lightweight headless-shell binary (installed by test:setup)
      // instead of the full Chromium download.
      instances: [
        { browser: 'chromium', launch: { channel: 'chromium-headless-shell' } }
      ]
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
});
