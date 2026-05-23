/**
 * Separate vitest config for Firestore rules tests.
 *
 * Uses the `node` env (no jsdom / React mocks) and points at test/rules.
 * Invoked via `npm run test:rules`, which wraps this in
 * `firebase emulators:exec --only firestore` so the emulator is up.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rules/**/*.test.js'],
    testTimeout: 15000
  }
});
