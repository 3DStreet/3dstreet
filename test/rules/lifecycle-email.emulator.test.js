/**
 * Emulator-backed tests for sendLifecycleEmail (the parts the pure stop-rule
 * unit tests can't cover): the transactional claim + pending/sent/error audit
 * records, rollback on Postmark failure (including the dedupeKey regression),
 * emailPrefs suppression, broadcast unsubscribe footer, and concurrent-send
 * idempotency.
 *
 * Runs under `npm run test:rules`, which boots the firestore + auth emulators
 * via `firebase emulators:exec` (that sets FIRESTORE_EMULATOR_HOST /
 * FIREBASE_AUTH_EMULATOR_HOST for this process). Postmark is stubbed at the
 * global fetch level — no network.
 *
 * The module under test lives in public/functions (its own node_modules), so
 * firebase-admin must be THE SAME instance the module sees — hence
 * createRequire anchored there instead of top-level imports.
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

let sendLifecycleEmail;
let db;

// Minimal template; subject/body assertions key off these markers.
const TEMPLATE = {
  getSubject: (name) => `Test subject for ${name}`,
  getHtmlBody: (name) =>
    `<!DOCTYPE html><html><body><p>Hi ${name}</p></body></html>`,
  getTextBody: (name) => `Hi ${name}`
};

const okFetch = () =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ MessageID: 'pm-msg-1' })
  }));

const failFetch = () =>
  vi.fn(async () => ({
    ok: false,
    status: 500,
    text: async () => 'postmark 500'
  }));

let uidCounter = 0;
const makeUser = async () => {
  const uid = `lifecycle-test-${++uidCounter}`;
  await admin.auth().createUser({
    uid,
    email: `${uid}@example.test`,
    displayName: `Tester ${uidCounter}`
  });
  return uid;
};

const summaryDoc = async (uid) =>
  (await db.collection('emailLog').doc(uid).get()).data();

const sendRecords = async (uid) => {
  const snap = await db
    .collection('emailLog')
    .doc(uid)
    .collection('sends')
    .get();
  return snap.docs.map((d) => d.data());
};

describe('sendLifecycleEmail (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeTruthy();
    process.env.POSTMARK_API_KEY = 'test-server-token';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    ({ sendLifecycleEmail } = functionsRequire('./email/lifecycle-email.js'));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await Promise.all(admin.apps.map((app) => app.delete()));
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('happy path: sends, writes summary claim and a sent audit record', async () => {
    const uid = await makeUser();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendLifecycleEmail({
      db,
      uid,
      emailId: 'welcome',
      category: 'transactional',
      stream: 'outbound',
      template: TEMPLATE,
      rules: { onceEver: true }
    });

    expect(result).toMatchObject({ action: 'sent', messageId: 'pm-msg-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const summary = await summaryDoc(uid);
    expect(summary.emails.welcome.sentCount).toBe(1);
    expect(summary.emails.welcome.lastSentAt).toBeTruthy();
    expect(summary.categories.transactional.lastSentAt).toBeTruthy();

    const sends = await sendRecords(uid);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      emailId: 'welcome',
      stream: 'outbound',
      status: 'sent',
      messageId: 'pm-msg-1'
    });
  });

  it('dry run evaluates but claims and sends nothing', async () => {
    const uid = await makeUser();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendLifecycleEmail({
      db,
      uid,
      emailId: 'welcome',
      category: 'transactional',
      stream: 'outbound',
      template: TEMPLATE,
      rules: { onceEver: true },
      dryRun: true
    });

    expect(result.action).toBe('would-send');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await summaryDoc(uid)).toBeUndefined();
    expect(await sendRecords(uid)).toHaveLength(0);
  });

  it('broadcast: appends unsubscribe footer, routes to the stream, respects emailPrefs', async () => {
    const uid = await makeUser();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const first = await sendLifecycleEmail({
      db,
      uid,
      emailId: 'checkoutAbandoned1h',
      category: 'conversion',
      stream: 'conversion',
      template: TEMPLATE,
      dedupeKey: 'cs_1'
    });
    expect(first.action).toBe('sent');

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.MessageStream).toBe('conversion');
    expect(payload.HtmlBody).toContain('{{{ pm:unsubscribe_url }}}');
    expect(payload.TextBody).toContain('{{{ pm:unsubscribe_url }}}');
    // Footer must land inside the document, not after </body>
    expect(payload.HtmlBody.indexOf('pm:unsubscribe_url')).toBeLessThan(
      payload.HtmlBody.indexOf('</body>')
    );

    // Simulate the Postmark Subscription Change webhook having recorded an
    // opt-out for this stream; the next send must be skipped.
    await db
      .collection('emailPrefs')
      .doc(uid)
      .set({
        userId: uid,
        streams: { conversion: { suppressed: true } }
      });
    const second = await sendLifecycleEmail({
      db,
      uid,
      emailId: 'checkoutAbandoned1h',
      category: 'conversion',
      stream: 'conversion',
      template: TEMPLATE,
      dedupeKey: 'cs_2'
    });
    expect(second).toMatchObject({ action: 'skipped', reason: 'unsubscribed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back the claim on Postmark failure so a retry succeeds (dedupeKey regression)', async () => {
    const uid = await makeUser();

    // Prior successful send of the same emailId with a different dedupeKey —
    // the case where a set+merge rollback would leave the new key behind.
    vi.stubGlobal('fetch', okFetch());
    const args = {
      db,
      uid,
      emailId: 'failedPayment',
      category: 'transactional',
      stream: 'outbound',
      template: TEMPLATE
    };
    expect(
      (await sendLifecycleEmail({ ...args, dedupeKey: 'in_100' })).action
    ).toBe('sent');
    const before = await summaryDoc(uid);

    // Postmark fails for the new invoice → claim must be fully rolled back.
    vi.stubGlobal('fetch', failFetch());
    const failed = await sendLifecycleEmail({ ...args, dedupeKey: 'in_200' });
    expect(failed.action).toBe('error');

    const after = await summaryDoc(uid);
    expect(after.emails.failedPayment.sentCount).toBe(1);
    expect(Object.keys(after.emails.failedPayment.dedupeKeys)).toEqual([
      'in_100'
    ]);
    expect(after.emails.failedPayment.lastSentAt.toMillis()).toBe(
      before.emails.failedPayment.lastSentAt.toMillis()
    );

    const sends = await sendRecords(uid);
    expect(sends.map((s) => s.status).sort()).toEqual(['error', 'sent']);
    expect(sends.find((s) => s.status === 'error').error).toContain('500');

    // The whole point: the retry for in_200 must NOT be blocked.
    vi.stubGlobal('fetch', okFetch());
    const retried = await sendLifecycleEmail({ ...args, dedupeKey: 'in_200' });
    expect(retried.action).toBe('sent');
    const final = await summaryDoc(uid);
    expect(Object.keys(final.emails.failedPayment.dedupeKeys).sort()).toEqual([
      'in_100',
      'in_200'
    ]);
  });

  it('concurrent onceEver sends: exactly one email goes out', async () => {
    const uid = await makeUser();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const args = {
      db,
      uid,
      emailId: 'geoNotUsed',
      category: 'lifecycle',
      stream: 'lifecycle',
      template: TEMPLATE,
      rules: { onceEver: true }
    };
    const results = await Promise.all([
      sendLifecycleEmail({ ...args }),
      sendLifecycleEmail({ ...args })
    ]);

    const actions = results.map((r) => r.action).sort();
    expect(actions).toEqual(['sent', 'skipped']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await summaryDoc(uid)).emails.geoNotUsed.sentCount).toBe(1);
    expect(
      (await sendRecords(uid)).filter((s) => s.status === 'sent')
    ).toHaveLength(1);
  });

  it('unknown broadcast stream is rejected before any lookup', async () => {
    const result = await sendLifecycleEmail({
      db,
      uid: 'irrelevant',
      emailId: 'x',
      category: 'x',
      stream: 'not-a-stream',
      template: TEMPLATE
    });
    expect(result.action).toBe('error');
    expect(result.reason).toMatch(/unknown stream/);
  });

  // The daily tokenExhaustion sweep now routes through sendLifecycleEmail.
  // These cover the sweep-specific glue: the legacy notifyLog guard (sends
  // recorded before the emailLog migration), template selection, PRO skip via
  // stopIfPro, and that new sends land in emailLog — never notifyLog.
  describe('tokenExhaustion sweep (migrated to the lifecycle send service)', () => {
    let processEmailType;
    let EMAIL_TYPES;
    let freshUid;
    let legacyUid;
    let proUid;

    beforeAll(async () => {
      ({ processEmailType, EMAIL_TYPES } = functionsRequire(
        './scheduled/scheduledEmails.js'
      ));

      freshUid = await makeUser();
      legacyUid = await makeUser();
      proUid = await makeUser();

      await db
        .collection('tokenProfile')
        .doc(freshUid)
        .set({ genToken: 0, geoToken: 5 });
      await db
        .collection('tokenProfile')
        .doc(legacyUid)
        .set({ genToken: 3, geoToken: 0 });
      await db
        .collection('tokenProfile')
        .doc(proUid)
        .set({ genToken: 0, geoToken: 0 });

      // Send recorded under the pre-migration notifyLog tracking: this user
      // has no emailLog history but must never be emailed again.
      await db.collection('notifyLog').doc(legacyUid).set({
        userId: legacyUid,
        tokenExhaustionEmailSent: new Date()
      });

      await admin.auth().setCustomUserClaims(proUid, { plan: 'PRO' });
    });

    it('sends via sendLifecycleEmail, honoring legacy notifyLog and PRO skip', async () => {
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await processEmailType(
        db,
        'tokenExhaustion',
        EMAIL_TYPES.tokenExhaustion
      );

      expect(results.processed).toBe(3);
      expect(results.sent).toBe(1);
      expect(results.skipped.alreadySent).toBe(1); // legacy notifyLog guard
      expect(results.skipped.filtered).toBe(1); // PRO user

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.To).toBe(`${freshUid}@example.test`);
      expect(payload.MessageStream).toBe('outbound');
      expect(payload.Subject).toContain('AI tokens'); // genToken===0 wins template selection

      // New sends are tracked in emailLog, not notifyLog.
      const summary = await summaryDoc(freshUid);
      expect(summary.emails.tokenExhaustion.sentCount).toBe(1);
      expect(
        (await db.collection('notifyLog').doc(freshUid).get()).exists
      ).toBe(false);

      // The legacy-guarded user gets no emailLog claim either.
      expect(await summaryDoc(legacyUid)).toBeUndefined();
    });

    it('second sweep sends nothing: onceEver now blocks the fresh user too', async () => {
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await processEmailType(
        db,
        'tokenExhaustion',
        EMAIL_TYPES.tokenExhaustion
      );

      expect(results.sent).toBe(0);
      expect(results.skipped.alreadySent).toBe(2); // legacy guard + onceEver
      expect(results.skipped.filtered).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('dry run reports recipient and subject without claiming or sending', async () => {
      const uid = await makeUser();
      await db
        .collection('tokenProfile')
        .doc(uid)
        .set({ genToken: 5, geoToken: 0 });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await processEmailType(
        db,
        'tokenExhaustion',
        EMAIL_TYPES.tokenExhaustion,
        { dryRun: true }
      );

      const entry = results.wouldSend.find(
        (w) => w.email === `${uid}@example.test`
      );
      expect(entry).toBeTruthy();
      expect(entry.templateKey).toBe('geoTokenExhaustion');
      expect(entry.subject).toContain('geo tokens');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await summaryDoc(uid)).toBeUndefined();
    });
  });

  describe('welcome email (Auth onCreate trigger helper)', () => {
    let sendWelcomeEmailForUser;
    // The real trigger polls ~9s for the client's locale write (the signup
    // race); tests collapse the poll to a single immediate read.
    const fastLocaleWait = { localeWait: { attempts: 1, delayMs: 0 } };

    beforeAll(() => {
      ({ sendWelcomeEmailForUser } = functionsRequire(
        './email/lifecycle-triggers.js'
      ));
    });

    it('sends once on signup; a retried trigger is a no-op', async () => {
      const uid = await makeUser();
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const first = await sendWelcomeEmailForUser(db, uid, fastLocaleWait);
      expect(first.action).toBe('sent');
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.MessageStream).toBe('outbound');
      expect(payload.Subject).toContain('Welcome');
      expect((await summaryDoc(uid)).emails.welcome.sentCount).toBe(1);

      // Firebase retries onCreate on error; onceEver must absorb a re-fire.
      const second = await sendWelcomeEmailForUser(db, uid, fastLocaleWait);
      expect(second).toMatchObject({ action: 'skipped', reason: 'onceEver' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends in the locale the client captured at signup (detectedLocale)', async () => {
      const uid = await makeUser();
      await db
        .collection('socialProfile')
        .doc(uid)
        .set({ userId: uid, detectedLocale: 'es-MX' });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const result = await sendWelcomeEmailForUser(db, uid, fastLocaleWait);
      expect(result.action).toBe('sent');
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.Subject).toBe('¡Te damos la bienvenida a 3DStreet!');
      expect(payload.HtmlBody).toContain('¡Hola,');
      expect(payload.TextBody).toContain('El equipo de 3DStreet');

      // The audit record captures which locale actually went out.
      const sends = await sendRecords(uid);
      expect(sends[0].locale).toBe('es');
    });

    it('waits out the signup race: locale write landing after the first poll still wins', async () => {
      const uid = await makeUser();
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      // Simulate the client write landing between polls.
      setTimeout(() => {
        db.collection('socialProfile')
          .doc(uid)
          .set({ userId: uid, detectedLocale: 'fr' });
      }, 150);
      const result = await sendWelcomeEmailForUser(db, uid, {
        localeWait: { attempts: 5, delayMs: 100 }
      });
      expect(result.action).toBe('sent');
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.Subject).toBe('Bienvenue sur 3DStreet !');
    });
  });

  describe('locale resolution in the send service', () => {
    let TEMPLATES;

    beforeAll(() => {
      TEMPLATES = functionsRequire('./email/templates.js');
    });

    const send = (uid, overrides = {}) =>
      sendLifecycleEmail({
        db,
        uid,
        emailId: 'geoNotUsed',
        category: 'lifecycle',
        stream: 'lifecycle',
        template: TEMPLATES.geoNotUsed,
        ...overrides
      });

    it('explicit UI locale wins over detectedLocale, and the unsubscribe footer localizes', async () => {
      const uid = await makeUser();
      await db.collection('socialProfile').doc(uid).set({
        userId: uid,
        locale: 'fr',
        detectedLocale: 'es'
      });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      expect((await send(uid)).action).toBe('sent');
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.Subject).toBe('Placez votre rue sur une vraie carte');
      // Localized broadcast footer, placeholder intact, inside the document.
      expect(payload.HtmlBody).toContain('Se désinscrire');
      expect(payload.HtmlBody).toContain('{{{ pm:unsubscribe_url }}}');
      expect(payload.TextBody).toContain('{{{ pm:unsubscribe_url }}}');
      expect(payload.HtmlBody.indexOf('pm:unsubscribe_url')).toBeLessThan(
        payload.HtmlBody.indexOf('</body>')
      );
    });

    it('normalizes regioned tags (pt-PT → pt-BR) and defaults missing profiles to en', async () => {
      const ptUid = await makeUser();
      await db
        .collection('socialProfile')
        .doc(ptUid)
        .set({ userId: ptUid, detectedLocale: 'pt-PT' });
      const noProfileUid = await makeUser();
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      await send(ptUid);
      await send(noProfileUid);
      const [ptPayload, enPayload] = fetchMock.mock.calls.map((c) =>
        JSON.parse(c[1].body)
      );
      expect(ptPayload.Subject).toBe('Coloque sua rua em um mapa real');
      expect(enPayload.Subject).toBe('Put your street on a real map');
      expect(enPayload.HtmlBody).toContain('Unsubscribe');
    });

    it('an explicit locale param overrides profile resolution', async () => {
      const uid = await makeUser();
      await db
        .collection('socialProfile')
        .doc(uid)
        .set({ userId: uid, locale: 'fr' });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      await send(uid, { locale: 'es' });
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.Subject).toBe('Pon tu calle en un mapa real');
    });
  });

  describe('hourly lifecycle sweep (abandoned checkout, pricing nudge, geo not used)', () => {
    let runLifecycleSweeps;
    let abandonedUid; // open checkout, 2h old → gets checkoutAbandoned1h
    let convertedUid; // completed checkout → nothing
    let nudgeUid; // saw pricing 2d ago, never checked out → gets pricingPageNudge
    let checkedOutUid; // saw pricing, then started checkout → excluded from nudge
    let geoUid; // welcomed 4d ago, never used geo → gets geoNotUsed
    let geoUsedUid; // welcomed 4d ago, used geo → excluded
    let freshUid2; // welcomed 1d ago → outside the 3d window

    const ts = (agoMs) =>
      admin.firestore.Timestamp.fromMillis(Date.now() - agoMs);
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    beforeAll(async () => {
      ({ runLifecycleSweeps } = functionsRequire(
        './email/lifecycle-sweeps.js'
      ));

      [
        abandonedUid,
        convertedUid,
        nudgeUid,
        checkedOutUid,
        geoUid,
        geoUsedUid,
        freshUid2
      ] = await Promise.all(Array.from({ length: 7 }, makeUser));

      await db
        .collection('checkoutSessions')
        .doc('cs_abandoned')
        .set({
          userId: abandonedUid,
          status: 'open',
          createdAt: ts(2 * HOUR)
        });
      await db
        .collection('checkoutSessions')
        .doc('cs_converted')
        .set({
          userId: convertedUid,
          status: 'complete',
          createdAt: ts(2 * HOUR)
        });

      await db
        .collection('userSignals')
        .doc(nudgeUid)
        .set({
          userId: nudgeUid,
          lastPaymentModalAt: ts(2 * DAY)
        });
      await db
        .collection('userSignals')
        .doc(checkedOutUid)
        .set({
          userId: checkedOutUid,
          lastPaymentModalAt: ts(2 * DAY),
          lastCheckoutStartedAt: ts(1 * DAY)
        });

      const welcomeLog = (when) => ({
        emails: { welcome: { lastSentAt: when, sentCount: 1 } }
      });
      await db
        .collection('emailLog')
        .doc(geoUid)
        .set(welcomeLog(ts(4 * DAY)));
      await db
        .collection('emailLog')
        .doc(geoUsedUid)
        .set(welcomeLog(ts(4 * DAY)));
      await db
        .collection('emailLog')
        .doc(freshUid2)
        .set(welcomeLog(ts(1 * DAY)));
      await db
        .collection('tokenProfile')
        .doc(geoUsedUid)
        .set({
          userId: geoUsedUid,
          firstGeoActivatedAt: ts(3 * DAY)
        });
    });

    it('first pass sends exactly the three eligible emails on the right streams', async () => {
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await runLifecycleSweeps(db, {});

      expect(results.sweeps.checkoutAbandoned1h.sent).toBe(1);
      expect(results.sweeps.checkoutAbandoned72h).toEqual({ disabled: true });
      expect(results.sweeps.pricingPageNudge.sent).toBe(1);
      expect(results.sweeps.geoNotUsed.sent).toBe(1);
      expect(results.sent).toBe(3);
      expect(results.errors).toBe(0);

      const payloads = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
      const byTo = Object.fromEntries(payloads.map((p) => [p.To, p]));

      const abandoned = byTo[`${abandonedUid}@example.test`];
      expect(abandoned.MessageStream).toBe('conversion');
      expect(abandoned.HtmlBody).toContain('{{{ pm:unsubscribe_url }}}');

      const nudge = byTo[`${nudgeUid}@example.test`];
      expect(nudge.MessageStream).toBe('conversion');

      const geo = byTo[`${geoUid}@example.test`];
      expect(geo.MessageStream).toBe('lifecycle');
      expect(geo.HtmlBody).toContain('{{{ pm:unsubscribe_url }}}');

      // The excluded users got nothing.
      expect(byTo[`${convertedUid}@example.test`]).toBeUndefined();
      expect(byTo[`${checkedOutUid}@example.test`]).toBeUndefined();
      expect(byTo[`${geoUsedUid}@example.test`]).toBeUndefined();
      expect(byTo[`${freshUid2}@example.test`]).toBeUndefined();
    });

    it('second pass is idempotent: stop-rules absorb the hourly re-scan', async () => {
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await runLifecycleSweeps(db, {});

      expect(results.sent).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      // Within 7 days the conversion-category cooldown blocks the re-scan
      // first (it fires before the dedupeKey/notWithinDays checks); the
      // per-session dedupeKey remains the permanent guard once the category
      // window lapses. Geo has no category rule, so onceEver is its reason.
      expect(
        results.sweeps.checkoutAbandoned1h.skipped.categoryNotWithinDays
      ).toBe(1);
      expect(results.sweeps.pricingPageNudge.skipped.notWithinDays).toBe(1);
      expect(results.sweeps.geoNotUsed.skipped.onceEver).toBe(1);
    });

    it('dry run reports would-sends without claiming', async () => {
      const uid = await makeUser();
      await db
        .collection('checkoutSessions')
        .doc('cs_dry')
        .set({
          userId: uid,
          status: 'open',
          createdAt: ts(2 * HOUR)
        });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);

      const results = await runLifecycleSweeps(db, { dryRun: true });

      expect(results.sweeps.checkoutAbandoned1h.wouldSend).toContain(
        `${uid}@example.test`
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await summaryDoc(uid)).toBeUndefined();
    });
  });
});
