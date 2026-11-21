/**
 * Team asset library (#1267 Phase 4, docs/team-assets.md): pure rules, no
 * Firebase. Used by team-assets.js and unit-tested in
 * test/core/team-assets-utils.test.js.
 */

const MB = 1000 * 1000;
const GB = 1000 * MB;

/** Per-seat storage of a team's library, by plan (the personal limits). */
const STORAGE_PER_SEAT = { PRO: 5 * GB, MAX: 25 * GB };

/** A team's library limit: its plan's personal storage limit per seat. */
function teamStorageLimit(plan, seats) {
  const perSeat = STORAGE_PER_SEAT[plan] || STORAGE_PER_SEAT.PRO;
  return perSeat * Math.max(1, Number(seats) || 1);
}

/** The file fields of an asset doc: each Storage path with its served URL. */
const FILE_FIELDS = [
  { path: 'storagePath', url: 'storageUrl' },
  { path: 'optimizedSourcePath', url: 'optimizedSourceUrl' },
  { path: 'thumbnailPath', url: 'thumbnailUrl' }
];

/**
 * The Storage copies that put a user's asset (its files under
 * users/{uid}/...) into a team's library: [{ field, urlField, from, to }].
 * Each copy lands in its own folder (`copyId`), so replacing a team asset's
 * file never overwrites the bytes an older scene still points at. Refuses
 * (returns null) a path outside the user's own folder.
 */
function teamAssetCopies(asset, { uid, orgId, assetId, copyId }) {
  const copies = [];
  for (const { path, url } of FILE_FIELDS) {
    const from = asset[path];
    if (!from) continue;
    if (typeof from !== 'string' || !from.startsWith(`users/${uid}/`) || from.includes('..')) {
      return null;
    }
    const name = from.split('/').pop();
    copies.push({
      field: path,
      urlField: url,
      from,
      to: `orgs/${orgId}/assets/${assetId}/${copyId}/${name}`
    });
  }
  return copies.some((c) => c.field === 'storagePath') ? copies : null;
}

/**
 * The fields a team asset takes from the user's asset it was made from:
 * what describes the content, never its owner, files or deletion state.
 */
const CONTENT_FIELDS = [
  'type',
  'category',
  'name',
  'filename',
  'originalFilename',
  'mimeType',
  'size',
  'optimizedSourceSize',
  'optimizationMetadata',
  'bounds',
  'attribution',
  'width',
  'height',
  'duration'
];

function contentFieldsOf(asset) {
  const fields = {};
  for (const key of CONTENT_FIELDS) {
    if (asset[key] !== undefined) fields[key] = asset[key];
  }
  return fields;
}

/**
 * Why `role` can't change a team asset, or null. Seats (owner, admin,
 * member) add assets and replace their file; owners and admins remove any,
 * members only those they added.
 */
function teamAssetRefusal({ role, action, addedBy, uid }) {
  if (!['owner', 'admin', 'member'].includes(role)) return 'not-editor';
  if (action === 'remove' && role === 'member' && addedBy !== uid) {
    return 'not-manager';
  }
  return null;
}

/** Download URL for a Storage object with a token (emulator-aware). */
function downloadUrl(bucketName, path, token) {
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const host = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

module.exports = {
  STORAGE_PER_SEAT,
  teamStorageLimit,
  FILE_FIELDS,
  teamAssetCopies,
  contentFieldsOf,
  teamAssetRefusal,
  downloadUrl
};
