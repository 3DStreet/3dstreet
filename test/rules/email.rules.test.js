/**
 * Firestore rules tests — emailLog + emailPrefs are cloud-functions-only.
 *
 * Run via `npm run test:rules` (wraps the firestore emulator via
 * `firebase emulators:exec`). Not part of CI; run locally when touching
 * public/firestore.rules.
 *
 * Coverage: neither the owner nor another user can read or write the
 * lifecycle email collections (emailLog/{uid}, its sends subcollection,
 * emailPrefs/{uid}). Only the Admin SDK (Cloud Functions) touches them.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UID = 'user-abc';
const OTHER_UID = 'user-xyz';

let testEnv;

describe('firestore.rules — emailLog + emailPrefs (cloud-only)', () => {
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

  const paths = (uid) => [
    ['emailLog summary', ['emailLog', uid]],
    ['emailLog send record', ['emailLog', uid, 'sends', 'send-1']],
    ['emailPrefs', ['emailPrefs', uid]]
  ];

  it('denies the owner read and write on all email collections', async () => {
    const db = testEnv.authenticatedContext(UID).firestore();
    for (const [label, segments] of paths(UID)) {
      const ref = doc(db, ...segments);
      await assertFails(getDoc(ref), `${label}: owner read should fail`);
      await assertFails(
        setDoc(ref, { userId: UID }),
        `${label}: owner write should fail`
      );
    }
  });

  it('denies another authenticated user read and write', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    for (const [label, segments] of paths(UID)) {
      const ref = doc(db, ...segments);
      await assertFails(getDoc(ref), `${label}: other-user read should fail`);
      await assertFails(
        setDoc(ref, { suppressed: true }),
        `${label}: other-user write should fail`
      );
    }
  });

  it('denies unauthenticated access', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    for (const [label, segments] of paths(UID)) {
      const ref = doc(db, ...segments);
      await assertFails(getDoc(ref), `${label}: anon read should fail`);
    }
  });
});
