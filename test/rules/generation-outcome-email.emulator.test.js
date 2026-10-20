/**
 * Emulator-backed tests for sendGenerationOutcomeEmail's retry policy: a
 * permanent Postmark recipient rejection is final (and remembered), transient
 * failures retry up to MAX_NOTIFY_ATTEMPTS, and outcomes older than the 24h
 * staleness cutoff are retired unsent — success emails included.
 *
 * Runs under `npm run test:rules` (see lifecycle-email.emulator.test.js for
 * the emulator + createRequire setup this mirrors). Postmark is stubbed at the
 * global fetch level.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi
} from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

let sendGenerationOutcomeEmail;
let db;

const okFetch = () =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ MessageID: 'pm-msg-1' })
  }));

const inactiveRecipientFetch = () =>
  vi.fn(async () => ({
    ok: false,
    status: 422,
    text: async () =>
      JSON.stringify({ ErrorCode: 406, Message: 'Inactive recipient' })
  }));

const serverErrorFetch = () =>
  vi.fn(async () => ({
    ok: false,
    status: 500,
    text: async () => 'postmark 500'
  }));

let uidCounter = 0;
const makeUser = async () => {
  const uid = `outcome-test-${++uidCounter}`;
  await admin.auth().createUser({ uid, email: `${uid}@example.test` });
  return uid;
};

let jobCounter = 0;
const makeJob = async (uid, overrides = {}) => {
  const { notify, ...rest } = overrides;
  const ref = db
    .collection('users')
    .doc(uid)
    .collection('generationJobs')
    .doc(`job-${++jobCounter}`);
  await ref.set({
    status: 'succeeded',
    kind: 'image',
    providerJobId: 'prov-1',
    completedAt: admin.firestore.Timestamp.now(),
    ...rest,
    notify: { email: true, pending: true, ...notify }
  });
  return ref;
};

const notifyOf = async (ref) => (await ref.get()).data().notify;

describe('sendGenerationOutcomeEmail retry policy (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeTruthy();
    process.env.POSTMARK_API_KEY = 'test-server-token';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    ({ sendGenerationOutcomeEmail } = functionsRequire(
      './scheduled/scheduledEmails.js'
    ));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await Promise.all(admin.apps.map((app) => app.delete()));
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a fresh success email', async () => {
    const uid = await makeUser();
    const job = await makeJob(uid);
    vi.stubGlobal('fetch', okFetch());
    expect((await sendGenerationOutcomeEmail(db, uid, job)).action).toBe(
      'sent'
    );
    const notify = await notifyOf(job);
    expect(notify.pending).toBe(false);
    expect(notify.sentAt).toBeTruthy();
  });

  it('permanent rejection is final and skips later jobs without calling Postmark', async () => {
    const uid = await makeUser();
    const job = await makeJob(uid);
    vi.stubGlobal('fetch', inactiveRecipientFetch());
    expect((await sendGenerationOutcomeEmail(db, uid, job)).action).toBe(
      'undeliverable'
    );
    const notify = await notifyOf(job);
    expect(notify.pending).toBe(false);
    expect(notify.error).toMatch(/^undeliverable/);
    const prefs = (await db.collection('emailPrefs').doc(uid).get()).data();
    expect(prefs.undeliverable.code).toBe(406);

    const fetchSpy = okFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const job2 = await makeJob(uid);
    expect((await sendGenerationOutcomeEmail(db, uid, job2)).action).toBe(
      'undeliverable'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await notifyOf(job2)).pending).toBe(false);
  });

  it('transient failure restores pending and counts the attempt', async () => {
    const uid = await makeUser();
    const job = await makeJob(uid);
    vi.stubGlobal('fetch', serverErrorFetch());
    expect((await sendGenerationOutcomeEmail(db, uid, job)).action).toBe(
      'error'
    );
    const notify = await notifyOf(job);
    expect(notify.pending).toBe(true);
    expect(notify.attempts).toBe(1);
  });

  it('gives up after MAX_NOTIFY_ATTEMPTS transient failures', async () => {
    const uid = await makeUser();
    const job = await makeJob(uid, { notify: { attempts: 4 } });
    vi.stubGlobal('fetch', serverErrorFetch());
    expect((await sendGenerationOutcomeEmail(db, uid, job)).action).toBe(
      'error'
    );
    const notify = await notifyOf(job);
    expect(notify.pending).toBe(false);
    expect(notify.attempts).toBe(5);
    expect(notify.error).toMatch(/^gave up after 5 attempts/);
  });

  it('retires a stale success email unsent', async () => {
    const uid = await makeUser();
    const job = await makeJob(uid, {
      completedAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 25 * 60 * 60 * 1000
      )
    });
    const fetchSpy = okFetch();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await sendGenerationOutcomeEmail(db, uid, job)).action).toBe(
      'suppressed'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await notifyOf(job)).pending).toBe(false);
  });
});
