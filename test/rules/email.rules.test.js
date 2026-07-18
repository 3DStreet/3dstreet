/**
 * Firestore rules tests — lifecycle email collections.
 *
 * Run via `npm run test:rules` (wraps the firestore emulator via
 * `firebase emulators:exec`). Not part of CI; run locally when touching
 * public/firestore.rules.
 *
 * Coverage: emailLog/{uid} (+ sends), emailPrefs/{uid}, and
 * checkoutSessions/{id} are cloud-functions-only. userSignals/{uid} allows
 * exactly one client write shape — the owner's own lastPaymentModalAt with
 * the server clock — and nothing else.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
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
    ['emailPrefs', ['emailPrefs', uid]],
    ['checkoutSessions', ['checkoutSessions', `cs_test_${uid}`]]
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

  describe('userSignals — narrow owner-only client write', () => {
    const signalDoc = (db, uid) => doc(db, 'userSignals', uid);

    it('owner can write { userId, lastPaymentModalAt: serverTimestamp } and read it back', async () => {
      const db = testEnv.authenticatedContext(UID).firestore();
      await assertSucceeds(
        setDoc(
          signalDoc(db, UID),
          { userId: UID, lastPaymentModalAt: serverTimestamp() },
          { merge: true }
        )
      );
      await assertSucceeds(getDoc(signalDoc(db, UID)));
      // Repeat write (update path) must also pass — the modal fires this on
      // every open.
      await assertSucceeds(
        setDoc(
          signalDoc(db, UID),
          { userId: UID, lastPaymentModalAt: serverTimestamp() },
          { merge: true }
        )
      );
    });

    it('update cannot touch lastCheckoutStartedAt (server-owned field)', async () => {
      // Seed a server-written doc (Admin SDK bypasses rules).
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'userSignals', UID), {
          userId: UID,
          lastCheckoutStartedAt: Timestamp.now()
        });
      });
      const db = testEnv.authenticatedContext(UID).firestore();
      // Merging only the allowed field over the server doc is fine…
      await assertSucceeds(
        setDoc(
          signalDoc(db, UID),
          { userId: UID, lastPaymentModalAt: serverTimestamp() },
          { merge: true }
        )
      );
      // …but writing the server-owned field is not.
      await assertFails(
        setDoc(
          signalDoc(db, UID),
          {
            userId: UID,
            lastPaymentModalAt: serverTimestamp(),
            lastCheckoutStartedAt: serverTimestamp()
          },
          { merge: true }
        )
      );
    });

    it('rejects a client-chosen timestamp (must be request.time)', async () => {
      const db = testEnv.authenticatedContext(UID).firestore();
      await assertFails(
        setDoc(
          signalDoc(db, UID),
          {
            userId: UID,
            lastPaymentModalAt: Timestamp.fromMillis(Date.now() - 86400000)
          },
          { merge: true }
        )
      );
    });

    it('rejects writes to another user, extra fields, deletes, and anon access', async () => {
      const other = testEnv.authenticatedContext(OTHER_UID).firestore();
      await assertFails(
        setDoc(
          signalDoc(other, UID),
          { userId: UID, lastPaymentModalAt: serverTimestamp() },
          { merge: true }
        )
      );
      await assertFails(getDoc(signalDoc(other, UID)));

      const own = testEnv.authenticatedContext(UID).firestore();
      await assertFails(
        setDoc(
          signalDoc(own, UID),
          {
            userId: UID,
            lastPaymentModalAt: serverTimestamp(),
            isAdmin: true
          },
          { merge: true }
        )
      );
      await assertFails(deleteDoc(signalDoc(own, UID)));

      const anon = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(signalDoc(anon, UID)));
    });
  });
});
