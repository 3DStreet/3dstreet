/**
 * Separate vitest config for Firestore emulator tests (rules + the lifecycle
 * email send service).
 *
 * Uses the `node` env (no jsdom / React mocks) and points at test/rules.
 * Invoked via `npm run test:rules`, which wraps this in
 * `firebase emulators:exec --only firestore,auth` so the emulators are up.
 *
 * fileParallelism is off because every test file shares the one emulator
 * instance and the rules tests call clearFirestore() between cases — run in
 * parallel they wipe each other's documents mid-test.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rules/**/*.test.js'],
    testTimeout: 15000,
    fileParallelism: false
  }
});
