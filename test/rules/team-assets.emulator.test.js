/**
 * Emulator-backed tests for the team asset library (#1267 Phase 4,
 * team-assets.js): adding a member's asset (server-side file copies),
 * replacing its file, removing it, and the refusals.
 *
 * Runs under `npm run test:rules` (Firestore and Storage emulators).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

let db;
let bucket;
let teamAssets;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;

async function setup({ role = 'member', plan = 'PRO', seats = 2 } = {}) {
  const orgId = `org-${uniq()}`;
  const uid = `user-${uniq()}`;
  await db
    .doc(`orgs/${orgId}`)
    .set({ name: 'Team', plan, seats, status: 'active' });
  await db
    .doc(`orgs/${orgId}/members/${uid}`)
    .set({ uid, role, displayName: 'Ana' });
  return { orgId, uid };
}

/** A personal asset with real files in Storage. */
async function personalAsset(
  uid,
  { type = 'mesh', optimized = true, extra = {} } = {}
) {
  const assetId = `asset-${uniq()}`;
  const base = `users/${uid}/assets/meshes/${assetId}`;
  const files = {
    storagePath: `${base}.glb`,
    thumbnailPath: `${base}-thumb.jpg`,
    ...(optimized && { optimizedSourcePath: `${base}-opt.glb` })
  };
  for (const path of Object.values(files)) {
    await bucket.file(path).save(Buffer.from(`bytes of ${path}`), {
      metadata: {
        metadata: { firebaseStorageDownloadTokens: 'personal-token' }
      }
    });
  }
  await db.doc(`users/${uid}/assets/${assetId}`).set({
    assetId,
    userId: uid,
    type,
    category: 'upload',
    name: 'Bench',
    originalFilename: 'bench.glb',
    size: 1000,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    visibility: 'public',
    deleted: false,
    ...files,
    storageUrl: 'https://personal/url',
    ...extra
  });
  return assetId;
}

const teamAsset = async (orgId, assetId) =>
  (await db.doc(`orgs/${orgId}/assets/${assetId}`).get()).data();
const contentOf = async (path) =>
  (await bucket.file(path).download())[0].toString();

describe('team asset library (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'demo-3dstreet-rules',
        storageBucket: 'demo-3dstreet-rules.appspot.com'
      });
    }
    db = admin.firestore();
    bucket = admin.storage().bucket('demo-3dstreet-rules.appspot.com');
    teamAssets = functionsRequire('./team-assets.js');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it("copies a member's asset and its files into the team's library", async () => {
    const { orgId, uid } = await setup();
    const sourceId = await personalAsset(uid);
    const { assetId } = await teamAssets.addAssetToTeam({
      uid,
      orgId,
      assetId: sourceId
    });
    const asset = await teamAsset(orgId, assetId);
    expect(asset).toMatchObject({
      assetId,
      orgId,
      type: 'mesh',
      name: 'Bench',
      size: 1000,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      addedBy: uid,
      addedByName: 'Ana',
      addedFrom: { assetId: sourceId, ownerUid: uid },
      deleted: false
    });
    expect(asset.userId).toBeUndefined();
    expect(asset.visibility).toBeUndefined();
    for (const [path, url] of [
      ['storagePath', 'storageUrl'],
      ['optimizedSourcePath', 'optimizedSourceUrl'],
      ['thumbnailPath', 'thumbnailUrl']
    ]) {
      expect(asset[path]).toMatch(
        new RegExp(`^orgs/${orgId}/assets/${assetId}/`)
      );
      expect(asset[url]).toContain(encodeURIComponent(asset[path]));
      expect(asset[url]).not.toContain('personal-token');
    }
    expect(await contentOf(asset.storagePath)).toContain('.glb');
    // The personal asset is untouched.
    expect(
      (await db.doc(`users/${uid}/assets/${sourceId}`).get()).data().deleted
    ).toBe(false);
  });

  it('refuses viewers, deleted or foreign assets, a converting splat and a full library', async () => {
    const viewer = await setup({ role: 'viewer' });
    const viewerAsset = await personalAsset(viewer.uid);
    await expect(
      teamAssets.addAssetToTeam({ ...viewer, assetId: viewerAsset })
    ).rejects.toMatchObject({ reason: 'not-editor' });

    const { orgId, uid } = await setup();
    const other = await setup();
    const othersAsset = await personalAsset(other.uid);
    await expect(
      teamAssets.addAssetToTeam({ uid, orgId, assetId: othersAsset })
    ).rejects.toMatchObject({ reason: 'asset-not-found' });

    const deleted = await personalAsset(uid, { extra: { deleted: true } });
    await expect(
      teamAssets.addAssetToTeam({ uid, orgId, assetId: deleted })
    ).rejects.toMatchObject({ reason: 'asset-not-found' });

    const splat = await personalAsset(uid, { type: 'splat', optimized: false });
    await db
      .collection(`users/${uid}/generationJobs`)
      .add({ assetId: splat, status: 'running', kind: 'splat-rad' });
    await expect(
      teamAssets.addAssetToTeam({ uid, orgId, assetId: splat })
    ).rejects.toMatchObject({ reason: 'asset-converting' });

    await db
      .doc(`orgs/${orgId}/meta/usage`)
      .set({ bytesUsed: 10 * 1000 * 1000 * 1000 - 10 });
    const big = await personalAsset(uid);
    await expect(
      teamAssets.addAssetToTeam({ uid, orgId, assetId: big })
    ).rejects.toMatchObject({ reason: 'team-storage-full' });
  });

  it('replaces the file in place, keeping the id and the team name', async () => {
    const { orgId, uid } = await setup();
    const { assetId } = await teamAssets.addAssetToTeam({
      uid,
      orgId,
      assetId: await personalAsset(uid)
    });
    await db
      .doc(`orgs/${orgId}/assets/${assetId}`)
      .update({ name: 'Team bench' });
    const before = await teamAsset(orgId, assetId);
    const newer = await personalAsset(uid, {
      optimized: false,
      extra: { size: 2000, originalFilename: 'bench-v2.glb' }
    });
    await teamAssets.replaceTeamAssetFile({
      uid,
      orgId,
      assetId,
      sourceAssetId: newer
    });
    const after = await teamAsset(orgId, assetId);
    expect(after).toMatchObject({
      name: 'Team bench',
      size: 2000,
      originalFilename: 'bench-v2.glb',
      replacedBy: uid
    });
    expect(after.storagePath).not.toBe(before.storagePath);
    expect(after.optimizedSourcePath).toBeUndefined();
    expect(after.optimizedSourceUrl).toBeUndefined();
    // The old file stays for scenes that still point at it.
    expect(await contentOf(before.storagePath)).toBeTruthy();

    const image = await personalAsset(uid, { type: 'image' });
    await expect(
      teamAssets.replaceTeamAssetFile({
        uid,
        orgId,
        assetId,
        sourceAssetId: image
      })
    ).rejects.toMatchObject({ reason: 'asset-type-mismatch' });
  });

  it('members remove what they added; managers remove anything', async () => {
    const { orgId, uid } = await setup();
    const { assetId } = await teamAssets.addAssetToTeam({
      uid,
      orgId,
      assetId: await personalAsset(uid)
    });
    const other = `user-${uniq()}`;
    await db
      .doc(`orgs/${orgId}/members/${other}`)
      .set({ uid: other, role: 'member' });
    await expect(
      teamAssets.removeTeamAsset({ uid: other, orgId, assetId })
    ).rejects.toMatchObject({ reason: 'not-manager' });
    await db.doc(`orgs/${orgId}/members/${other}`).update({ role: 'admin' });
    await teamAssets.removeTeamAsset({ uid: other, orgId, assetId });
    expect(await teamAsset(orgId, assetId)).toMatchObject({
      deleted: true,
      deletedBy: other
    });
    await expect(
      teamAssets.removeTeamAsset({ uid, orgId, assetId })
    ).rejects.toMatchObject({ reason: 'asset-not-found' });
  });
});

describe('team library uploads (emulator)', () => {
  let quota;
  let dispatch;
  let orphans;
  beforeAll(() => {
    quota = functionsRequire('./asset-quota.js');
    dispatch = functionsRequire('./rad-dispatch.js');
    orphans = functionsRequire('./scheduled/asset-orphan-cleanup.js');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it("checks an upload against the team's storage, for seats only", async () => {
    const { orgId, uid } = await setup({ plan: 'MAX', seats: 2 });
    await db.doc(`orgs/${orgId}/meta/usage`).set({ bytesUsed: 1000 });
    const ok = await quota.teamUploadQuota({ uid, orgId, proposedBytes: 10 });
    expect(ok).toMatchObject({
      allowed: true,
      bytesUsed: 1000,
      planLimit: 50 * 1000 * 1000 * 1000,
      tier: 'MAX',
      membership: 'team',
      planName: 'MAX TEAM'
    });
    const full = await quota.teamUploadQuota({
      uid,
      orgId,
      proposedBytes: 50 * 1000 * 1000 * 1000
    });
    expect(full).toMatchObject({ allowed: false, reason: 'file_too_large' });
    const viewer = await setup({ role: 'viewer' });
    await expect(
      quota.teamUploadQuota({ ...viewer, proposedBytes: 1 })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it("queues a team splat's conversion as its uploader's job, with the team", async () => {
    const { orgId, uid } = await setup();
    await dispatch.dispatchSplatConversion({
      userId: uid,
      assetId: 'splat1',
      orgId,
      asset: {
        type: 'splat',
        storagePath: `orgs/${orgId}/assets/splat1/splat1.ply`
      }
    });
    const jobs = await db.collection(`users/${uid}/generationJobs`).get();
    expect(jobs.docs.map((d) => d.data())).toEqual([
      expect.objectContaining({
        kind: 'splat-rad',
        status: 'queued',
        assetId: 'splat1',
        orgId,
        plyPath: `orgs/${orgId}/assets/splat1/splat1.ply`
      })
    ]);
  });

  it("keeps a live team asset's folder and reclaims a folder without a doc", async () => {
    const { orgId, uid } = await setup();
    const { assetId } = await teamAssets.addAssetToTeam({
      uid,
      orgId,
      assetId: await personalAsset(uid)
    });
    const superseded = `orgs/${orgId}/assets/${assetId}/old/bench.glb`;
    const orphan = `orgs/${orgId}/assets/never-written/bench.glb`;
    for (const path of [superseded, orphan]) {
      await bucket.file(path).save(Buffer.from('x'));
    }
    await orphans.cleanup({
      dryRun: false,
      now: Date.now() + 48 * 60 * 60 * 1000
    });
    const exists = async (path) => (await bucket.file(path).exists())[0];
    const asset = await teamAsset(orgId, assetId);
    expect(await exists(asset.storagePath)).toBe(true);
    expect(await exists(superseded)).toBe(true);
    expect(await exists(orphan)).toBe(false);
  });
});
