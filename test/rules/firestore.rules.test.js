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
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
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

describe('firestore.rules — users/{uid}/assets/{assetId} read (visibility)', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-3dstreet-rules-read',
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

  async function seed(extra = {}) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(assetRef(ctx.firestore()), {
        ...LEGACY_IMAGE_DOC,
        ...extra
      });
    });
  }

  function foreignDb() {
    return testEnv.authenticatedContext(OTHER_UID).firestore();
  }

  it('owner can read their own asset regardless of visibility', async () => {
    await seed({ visibility: 'private' });
    await assertSucceeds(getDoc(assetRef(ownerDb())));
  });

  it('foreign user can read a public asset', async () => {
    await seed({ visibility: 'public' });
    await assertSucceeds(getDoc(assetRef(foreignDb())));
  });

  it('foreign user can read an unlisted asset (assetId known)', async () => {
    await seed({ visibility: 'unlisted' });
    await assertSucceeds(getDoc(assetRef(foreignDb())));
  });

  it('foreign user cannot read a private asset', async () => {
    await seed({ visibility: 'private' });
    await assertFails(getDoc(assetRef(foreignDb())));
  });

  it('foreign user can read a legacy doc missing the visibility field (defaults to public)', async () => {
    await seed(); // LEGACY_IMAGE_DOC has no visibility field
    await assertSucceeds(getDoc(assetRef(foreignDb())));
  });
});

describe('firestore.rules — users/{uid}/assets/{assetId} create + update (visibility)', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-3dstreet-rules-write',
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
  });

  it('owner can create with visibility: public', async () => {
    await assertSucceeds(
      setDoc(assetRef(ownerDb()), {
        ...LEGACY_IMAGE_DOC,
        visibility: 'public'
      })
    );
  });

  it('owner can create without a visibility field (legacy shape)', async () => {
    await assertSucceeds(setDoc(assetRef(ownerDb()), LEGACY_IMAGE_DOC));
  });

  it('rejects create with an invalid visibility value', async () => {
    await assertFails(
      setDoc(assetRef(ownerDb()), {
        ...LEGACY_IMAGE_DOC,
        visibility: 'bogus'
      })
    );
  });

  it('owner can toggle visibility public → private', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(assetRef(ctx.firestore()), {
        ...LEGACY_IMAGE_DOC,
        visibility: 'public'
      });
    });
    await assertSucceeds(
      updateDoc(assetRef(ownerDb()), { visibility: 'private' })
    );
  });

  it('rejects update setting visibility to an invalid value', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(assetRef(ctx.firestore()), {
        ...LEGACY_IMAGE_DOC,
        visibility: 'public'
      });
    });
    await assertFails(updateDoc(assetRef(ownerDb()), { visibility: 'bogus' }));
  });
});
