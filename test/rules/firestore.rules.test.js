/**
 * Firestore rules tests — minimal regression coverage for the asset-update rule.
 *
 * Run via `npm run test:rules` (wraps the firestore emulator via
 * `firebase emulators:exec`). Not part of CI; run locally when touching
 * public/firestore.rules.
 *
 * Coverage:
 *   - Legacy image doc (no optimizedSourceSize/optimizedSourcePath) can be
 *     soft-deleted by its owner. Regression guard for the bug where the old
 *     equality-check rule rejected updates because comparing missing fields
 *     didn't behave like `null == null`.
 *   - Client cannot mutate `size` (quota-spoofing protection still works).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UID = 'user-abc';
const OTHER_UID = 'user-xyz';
const ASSET_ID = 'asset-1';

let testEnv;

function ownerDb() {
  return testEnv.authenticatedContext(UID).firestore();
}

function assetRef(db) {
  return doc(db, 'users', UID, 'assets', ASSET_ID);
}

// Mirrors a real AI-generated image doc as it appears in production: no
// optimizedSourceSize / optimizedSourcePath fields (those only exist on
// optimized GLB uploads).
const LEGACY_IMAGE_DOC = {
  assetId: ASSET_ID,
  userId: UID,
  type: 'image',
  category: 'ai-render',
  storagePath: `users/${UID}/assets/images/${ASSET_ID}.jpg`,
  storageUrl: 'https://example.test/img.jpg',
  size: 184782,
  mimeType: 'image/jpeg',
  filename: `${ASSET_ID}.jpg`,
  deleted: false
};

describe('firestore.rules — users/{uid}/assets/{assetId} update', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-3dstreet-rules',
      firestore: {
        rules: readFileSync(
          resolve(__dirname, '../../public/firestore.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 8080
      }
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed a legacy doc using the privileged context so rules are bypassed
    // on the initial write (matches reality: the doc existed before the
    // current rules were deployed).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(assetRef(ctx.firestore()), LEGACY_IMAGE_DOC);
    });
  });

  it('owner can soft-delete a legacy image doc that lacks optimizedSourceSize', async () => {
    await assertSucceeds(
      updateDoc(assetRef(ownerDb()), {
        deleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  it('blocks client from mutating size (quota spoofing)', async () => {
    await assertFails(updateDoc(assetRef(ownerDb()), { size: 1 }));
  });

  it('blocks non-owner from updating', async () => {
    const otherDb = testEnv.authenticatedContext(OTHER_UID).firestore();
    await assertFails(updateDoc(assetRef(otherDb), { deleted: true }));
  });
});
