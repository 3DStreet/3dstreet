/* global describe, it, afterEach */

/**
 * Team asset library (#1267 Phase 4): storage limit, file copies,
 * permissions.
 */

const assert = require('assert');
const {
  teamStorageLimit,
  teamAssetCopies,
  contentFieldsOf,
  teamAssetRefusal,
  downloadUrl
} = require('../../public/functions/team-assets-utils.js');

const GB = 1000 * 1000 * 1000;

describe('team-assets-utils', () => {
  afterEach(() => {
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  });

  it('gives a team its plan’s personal storage per seat', () => {
    assert.strictEqual(teamStorageLimit({ plan: 'PRO', seats: 3 }), 15 * GB);
    assert.strictEqual(teamStorageLimit({ plan: 'MAX', seats: 2 }), 50 * GB);
    assert.strictEqual(teamStorageLimit({ plan: 'UNKNOWN', seats: 0 }), 5 * GB);
    assert.strictEqual(
      teamStorageLimit({ plan: 'PRO', seats: null, storageLimitGb: 200 }),
      200 * GB
    );
  });

  it('copies every file of the asset into its own folder of the team', () => {
    const copies = teamAssetCopies(
      {
        storagePath: 'users/u1/assets/meshes/a.glb',
        optimizedSourcePath: 'users/u1/assets/meshes/a-opt.glb',
        thumbnailPath: 'users/u1/assets/meshes/a-thumb.jpg'
      },
      { uid: 'u1', orgId: 'o1', assetId: 't1', copyId: 'c1' }
    );
    assert.deepStrictEqual(
      copies.map((c) => [c.field, c.urlField, c.to]),
      [
        ['storagePath', 'storageUrl', 'orgs/o1/assets/t1/c1/a.glb'],
        [
          'optimizedSourcePath',
          'optimizedSourceUrl',
          'orgs/o1/assets/t1/c1/a-opt.glb'
        ],
        ['thumbnailPath', 'thumbnailUrl', 'orgs/o1/assets/t1/c1/a-thumb.jpg']
      ]
    );
  });

  it("refuses files outside the user's folder, or no original", () => {
    const ids = { uid: 'u1', orgId: 'o1', assetId: 't1', copyId: 'c1' };
    assert.strictEqual(
      teamAssetCopies({ storagePath: 'users/u2/assets/a.glb' }, ids),
      null
    );
    assert.strictEqual(
      teamAssetCopies({ storagePath: 'users/u1/../u2/a.glb' }, ids),
      null
    );
    assert.strictEqual(
      teamAssetCopies({ thumbnailPath: 'users/u1/assets/t.jpg' }, ids),
      null
    );
  });

  it('keeps what describes the content, never owner, files or deletion', () => {
    assert.deepStrictEqual(
      contentFieldsOf({
        type: 'mesh',
        name: 'Bench',
        size: 10,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        userId: 'u1',
        storagePath: 'users/u1/x',
        deleted: true,
        visibility: 'public'
      }),
      {
        type: 'mesh',
        name: 'Bench',
        size: 10,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] }
      }
    );
  });

  it('lets members replace only their own assets when the team says so', () => {
    const own = { memberEditScope: 'own' };
    const replace = (role, addedBy, org) =>
      teamAssetRefusal({ role, action: 'replace', addedBy, uid: 'u1', org });
    assert.strictEqual(replace('member', 'u2', null), null);
    assert.strictEqual(
      replace('member', 'u2', { memberEditScope: 'all' }),
      null
    );
    assert.strictEqual(replace('member', 'u2', own), 'own-only');
    assert.strictEqual(replace('member', 'u1', own), null);
    assert.strictEqual(replace('admin', 'u2', own), null);
    assert.strictEqual(replace('viewer', 'u1', own), 'not-editor');
  });

  it('lets seats add; managers remove any, members their own', () => {
    assert.strictEqual(
      teamAssetRefusal({ role: 'viewer', action: 'add' }),
      'not-editor'
    );
    assert.strictEqual(
      teamAssetRefusal({ role: 'member', action: 'add' }),
      null
    );
    assert.strictEqual(
      teamAssetRefusal({
        role: 'member',
        action: 'remove',
        addedBy: 'u2',
        uid: 'u1'
      }),
      'not-manager'
    );
    assert.strictEqual(
      teamAssetRefusal({
        role: 'member',
        action: 'remove',
        addedBy: 'u1',
        uid: 'u1'
      }),
      null
    );
    assert.strictEqual(
      teamAssetRefusal({
        role: 'admin',
        action: 'remove',
        addedBy: 'u2',
        uid: 'u1'
      }),
      null
    );
  });

  it('builds download URLs for production and the emulator', () => {
    assert.strictEqual(
      downloadUrl('b', 'orgs/o1/a b.glb', 't'),
      'https://firebasestorage.googleapis.com/v0/b/b/o/orgs%2Fo1%2Fa%20b.glb?alt=media&token=t'
    );
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    assert.ok(
      downloadUrl('b', 'x', 't').startsWith('http://127.0.0.1:9199/v0/b/b/o/x')
    );
  });
});
