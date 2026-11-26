/**
 * Emulator-backed tests for a team's contract terms and payments
 * (org-contracts.js, docs/orgs.md#contract-terms).
 *
 * Runs under `npm run test:rules`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

let db;
let contracts;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;
const DAY = 24 * 60 * 60 * 1000;

async function newOrg(status = 'active') {
  const orgId = `org-${uniq()}`;
  await db.doc(`orgs/${orgId}`).set({
    name: 'Metro',
    plan: 'MAX',
    seats: 5,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await db.doc(`orgs/${orgId}/members/u1`).set({ uid: 'u1', role: 'owner' });
  return orgId;
}

const payment = (paidThrough, extra = {}) => ({
  amount: 200000,
  currency: 'usd',
  paidAt: Date.now(),
  paidThrough,
  reference: 'INV-1',
  ...extra
});

describe('team contracts (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    contracts = functionsRequire('./org-contracts.js');
  });

  it('saves terms, refuses unknown fields and missing teams', async () => {
    const orgId = await newOrg();
    await contracts.updateContract({
      orgId,
      actorUid: 'staff',
      patch: {
        billingSource: 'invoice',
        price: { amount: 200000, currency: 'usd', interval: 'year' },
        autoRenew: true
      }
    });
    const contract = (await db.doc(`orgContracts/${orgId}`).get()).data();
    expect(contract).toMatchObject({
      billingSource: 'invoice',
      autoRenew: true,
      updatedBy: 'staff'
    });
    await expect(
      contracts.updateContract({ orgId, patch: { paidUntil: 1 } })
    ).rejects.toMatchObject({ reason: 'unknown-field' });
    await expect(
      contracts.updateContract({
        orgId: 'missing',
        patch: { autoRenew: true }
      })
    ).rejects.toMatchObject({ reason: 'org-not-found' });
  });

  it('a payment extends paid-through, never shortens it, and reactivates', async () => {
    const orgId = await newOrg('suspended');
    const later = Date.now() + 365 * DAY;
    const first = await contracts.recordPayment({
      orgId,
      actorUid: 'staff',
      payment: payment(later)
    });
    expect(first).toMatchObject({ paidThrough: later, reactivated: true });
    expect((await db.doc(`orgs/${orgId}`).get()).data().status).toBe('active');

    const second = await contracts.recordPayment({
      orgId,
      actorUid: 'staff',
      payment: payment(Date.now() + 30 * DAY)
    });
    expect(second).toMatchObject({ paidThrough: later, reactivated: false });

    const [team] = (await contracts.listTeams()).filter(
      (t) => t.orgId === orgId
    );
    expect(team).toMatchObject({
      memberCount: 1,
      status: 'active',
      contract: { paidThrough: later }
    });
    expect(team.payments).toHaveLength(2);
    await expect(
      contracts.recordPayment({
        orgId,
        payment: payment(later, { amount: 0.5 })
      })
    ).rejects.toMatchObject({ reason: 'invalid-payment' });
  });
});
