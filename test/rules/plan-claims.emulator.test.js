/**
 * setPlanClaim against the Auth emulator: a plan write keeps the user's
 * other claims (admin, beta). Runs under `npm run test:rules`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');
let setPlanClaim;

describe('setPlanClaim', () => {
  beforeAll(() => {
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: process.env.GCLOUD_PROJECT || 'demo-3dstreet-rules'
      });
    }
    ({ setPlanClaim } = functionsRequire('./plan-claims.js'));
  });
  afterAll(() => Promise.all(admin.apps.map((app) => app.delete())));

  it('changes the plan and keeps the other claims', async () => {
    const { uid } = await admin.auth().createUser({});
    const claims = async () => (await admin.auth().getUser(uid)).customClaims;

    await setPlanClaim(uid, 'PRO'); // no claims yet
    expect(await claims()).toEqual({ plan: 'PRO' });

    await admin
      .auth()
      .setCustomUserClaims(uid, { admin: true, beta: true, plan: 'MAX' });
    await setPlanClaim(uid, '');
    expect(await claims()).toEqual({ admin: true, beta: true, plan: '' });
  });
});
