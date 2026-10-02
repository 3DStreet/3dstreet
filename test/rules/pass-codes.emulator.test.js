/**
 * Emulator-backed tests for Project Pass code redemption (#1922 follow-up):
 * redeemPassCodeForUser's code transaction + grantPass, against a real
 * Firestore emulator. Covers the use cap, one redemption per user, retry
 * safety, stacking on an existing pass and every rejection reason.
 *
 * Runs under `npm run test:rules` (firebase emulators:exec). firebase-admin
 * must be the instance public/functions sees — hence createRequire anchored
 * there (same as lifecycle-email.emulator.test.js).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

const DAY = 24 * 60 * 60 * 1000;
let db;
let redeemPassCodeForUser;
let seq = 0;

const mintCode = async (overrides = {}) => {
  const code = `TEST-${Date.now().toString(36).toUpperCase()}${++seq}`;
  await db
    .collection('passCodes')
    .doc(code)
    .set({
      product: 'project',
      days: 90,
      tokens: 300,
      maxUses: 2,
      uses: 0,
      active: true,
      redeemBy: admin.firestore.Timestamp.fromMillis(Date.now() + 365 * DAY),
      org: 'Test Org',
      ...overrides
    });
  return code;
};

const tokenProfile = async (uid) =>
  (await db.collection('tokenProfile').doc(uid).get()).data();
const codeDoc = async (code) =>
  (await db.collection('passCodes').doc(code).get()).data();

describe('redeemPassCodeForUser (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    ({ redeemPassCodeForUser } = functionsRequire('./pass-codes.js'));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await Promise.all(admin.apps.map((app) => app.delete()));
  });

  it('grants the pass, consumes one use and records the redemption', async () => {
    const code = await mintCode();
    const before = Date.now();
    const result = await redeemPassCodeForUser('pc-user-1', code.toLowerCase());

    expect(result.status).toBe('redeemed');
    expect(result.days).toBe(90);
    expect(result.proUntilMs).toBeGreaterThanOrEqual(before + 90 * DAY);

    const profile = await tokenProfile('pc-user-1');
    expect(profile.genToken).toBe(300);
    expect(profile.proUntil.toMillis()).toBe(result.proUntilMs);
    expect((await codeDoc(code)).uses).toBe(1);

    const redemption = (
      await db.collection('passRedemptions').doc(`${code}_pc-user-1`).get()
    ).data();
    expect(redemption).toMatchObject({ code, userId: 'pc-user-1', days: 90 });
    const log = (
      await db.collection('tokenLog').doc(`pass-${code}_pc-user-1`).get()
    ).data();
    expect(log).toMatchObject({ source: 'pass-code', passCode: code });
  });

  it('a second redemption by the same user changes nothing', async () => {
    const code = await mintCode();
    const first = await redeemPassCodeForUser('pc-user-2', code);
    const again = await redeemPassCodeForUser('pc-user-2', code);

    expect(again.status).toBe('already-redeemed');
    expect(again.proUntilMs).toBe(first.proUntilMs);
    expect((await tokenProfile('pc-user-2')).genToken).toBe(300);
    expect((await codeDoc(code)).uses).toBe(1);
  });

  it('enforces maxUses across users, including concurrent redemptions', async () => {
    const code = await mintCode({ maxUses: 2 });
    const results = await Promise.all(
      ['pc-cap-a', 'pc-cap-b', 'pc-cap-c'].map((uid) =>
        redeemPassCodeForUser(uid, code)
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['exhausted', 'redeemed', 'redeemed']);
    expect((await codeDoc(code)).uses).toBe(2);
  });

  it('stacks on an existing unexpired pass', async () => {
    const existing = Date.now() + 30 * DAY;
    await db
      .collection('tokenProfile')
      .doc('pc-user-3')
      .set({
        userId: 'pc-user-3',
        genToken: 50,
        geoToken: 3,
        proUntil: admin.firestore.Timestamp.fromMillis(existing)
      });
    const code = await mintCode();
    const result = await redeemPassCodeForUser('pc-user-3', code);

    expect(result.proUntilMs).toBe(existing + 90 * DAY);
    expect((await tokenProfile('pc-user-3')).genToken).toBe(350);
  });

  it('completes a half-finished redemption on retry', async () => {
    // Simulate a crash after the code transaction but before grantPass.
    const code = await mintCode();
    await db
      .collection('passRedemptions')
      .doc(`${code}_pc-user-4`)
      .set({ code, userId: 'pc-user-4', days: 90, tokens: 300 });

    const result = await redeemPassCodeForUser('pc-user-4', code);
    expect(result.status).toBe('already-redeemed');
    expect((await tokenProfile('pc-user-4')).genToken).toBe(300);
    expect((await codeDoc(code)).uses).toBe(0);
  });

  it('rejects malformed, unknown, inactive, expired and used-up codes', async () => {
    expect((await redeemPassCodeForUser('pc-x', 'no')).status).toBe(
      'invalid-code'
    );
    expect((await redeemPassCodeForUser('pc-x', 'NOPE-NOPE')).status).toBe(
      'not-found'
    );
    const inactive = await mintCode({ active: false });
    expect((await redeemPassCodeForUser('pc-x', inactive)).status).toBe(
      'inactive'
    );
    const expired = await mintCode({
      redeemBy: admin.firestore.Timestamp.fromMillis(Date.now() - DAY)
    });
    expect((await redeemPassCodeForUser('pc-x', expired)).status).toBe(
      'expired'
    );
    const used = await mintCode({ maxUses: 1, uses: 1 });
    expect((await redeemPassCodeForUser('pc-x', used)).status).toBe(
      'exhausted'
    );
    expect(await tokenProfile('pc-x')).toBeUndefined();
  });

  it('emails the recipient once, naming who the pass is from', async () => {
    process.env.POSTMARK_API_KEY = 'test-server-token';
    const uid = `pc-email-${Date.now()}`;
    await admin.auth().createUser({
      uid,
      email: `${uid}@example.test`,
      displayName: 'Ana'
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ MessageID: 'pm-pass-1' })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const code = await mintCode({ fromName: 'Prof. Smith, WSU' });
    const first = await redeemPassCodeForUser(uid, code);
    const again = await redeemPassCodeForUser(uid, code);

    expect(first.fromName).toBe('Prof. Smith, WSU');
    expect(again.status).toBe('already-redeemed');
    expect(again.fromName).toBe('Prof. Smith, WSU');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.To).toContain(`${uid}@example.test`);
    expect(body.Subject).toBe(
      'Prof. Smith, WSU sent you a 3DStreet Project Pass'
    );
    expect(body.TextBody).toContain('3 months of 3DStreet Pro');
    expect(body.MessageStream).toBe('outbound');
  });

  it('refuses subscribers and Pro-team users without using a seat', async () => {
    const code = await mintCode({ maxUses: 5 });

    const subscriber = `pc-sub-${Date.now()}`;
    await admin.auth().createUser({
      uid: subscriber,
      email: `${subscriber}@example.test`
    });
    await admin.auth().setCustomUserClaims(subscriber, { plan: 'MAX' });

    const teamUser = `pc-team-${Date.now()}`;
    await admin.auth().createUser({
      uid: teamUser,
      email: `${teamUser}@team.example.edu`
    });
    process.env.ALLOWED_PRO_TEAM_DOMAINS = JSON.stringify(['team.example.edu']);

    try {
      expect((await redeemPassCodeForUser(subscriber, code)).status).toBe(
        'already-pro'
      );
      expect((await redeemPassCodeForUser(teamUser, code)).status).toBe(
        'already-pro'
      );
    } finally {
      delete process.env.ALLOWED_PRO_TEAM_DOMAINS;
    }

    expect((await codeDoc(code)).uses).toBe(0);
    expect(await tokenProfile(subscriber)).toBeUndefined();
    expect(await tokenProfile(teamUser)).toBeUndefined();

    // A free account (cleared claim) can then redeem the same code.
    await admin.auth().setCustomUserClaims(subscriber, { plan: '' });
    expect((await redeemPassCodeForUser(subscriber, code)).status).toBe(
      'redeemed'
    );
  });
});
