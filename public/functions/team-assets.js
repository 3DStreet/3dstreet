/**
 * Team asset library (#1267 Phase 4, docs/team-assets.md). Pure rules in
 * team-assets-utils.js.
 *
 * A team asset belongs to the team, like a team scene: leaving the team
 * never takes it away. Members add one of their own assets to the library;
 * the files are copied server-side (original, optimized variant or streaming
 * RAD, thumbnail), so nothing is uploaded, optimized or converted again.
 *
 * Data (Admin SDK writes only):
 *   orgs/{orgId}/assets/{assetId}  the asset doc, in the personal schema
 *                                  (storagePath/Url, optimizedSource*,
 *                                  thumbnail*, type, name, size, bounds...)
 *                                  plus orgId, addedBy, addedByName,
 *                                  addedFrom { assetId, ownerUid }
 *   orgs/{orgId}/meta/usage        { bytesUsed } (originals only, like the
 *                                  personal quota)
 *   Storage orgs/{orgId}/assets/{assetId}/{copyId}/{file}
 *
 * Scenes reference a team asset like a personal one, with the owner key
 * `org:<orgId>` in data-asset-owner-uid (src/shared/assets/assetOwner.js),
 * so replacing its file reaches every scene on its next load.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { OrgError, callable, requireAuth } = require('./orgs.js');
const {
  teamStorageLimit,
  FILE_FIELDS,
  teamAssetCopies,
  contentFieldsOf,
  teamAssetRefusal,
  downloadUrl
} = require('./team-assets-utils.js');

const db = () => admin.firestore();
const orgRef = (orgId) => db().collection('orgs').doc(orgId);
const teamAssetRef = (orgId, assetId) => orgRef(orgId).collection('assets').doc(assetId);
const usageRef = (orgId) => orgRef(orgId).collection('meta').doc('usage');
const userAssetRef = (uid, assetId) =>
  db().collection('users').doc(uid).collection('assets').doc(assetId);

const ACTIVE_JOB_STATUSES = ['queued', 'running', 'saving'];

/** The caller's role in an active org, checked for `action`. */
async function requireTeamRole({ uid, orgId, action, addedBy }) {
  if (typeof orgId !== 'string' || !orgId) throw new OrgError('invalid-argument');
  const [org, member] = await Promise.all([
    orgRef(orgId).get(),
    orgRef(orgId).collection('members').doc(uid).get()
  ]);
  if (!org.exists) throw new OrgError('org-not-found');
  if (!member.exists) throw new OrgError('not-member');
  if (org.data().status !== 'active') throw new OrgError('org-suspended');
  const role = member.data().role;
  const refusal = teamAssetRefusal({ role, action, addedBy, uid });
  if (refusal) throw new OrgError(refusal);
  return { org: org.data(), member: member.data() };
}

/** The user's asset to copy from: theirs, not deleted, done converting. */
async function readSourceAsset(uid, assetId) {
  if (typeof assetId !== 'string' || !assetId) throw new OrgError('invalid-argument');
  const snapshot = await userAssetRef(uid, assetId).get();
  if (!snapshot.exists || snapshot.data().deleted) throw new OrgError('asset-not-found');
  const asset = snapshot.data();
  // A splat being converted to its streaming form: the team would keep the
  // slow original, since the conversion writes back to the personal asset.
  if (asset.type === 'splat' && !asset.optimizedSourceUrl) {
    const jobs = await db()
      .collection('users')
      .doc(uid)
      .collection('generationJobs')
      .where('assetId', '==', assetId)
      .get();
    if (jobs.docs.some((job) => ACTIVE_JOB_STATUSES.includes(job.data().status))) {
      throw new OrgError('asset-converting');
    }
  }
  return asset;
}

async function checkStorage({ org, orgId, addedBytes }) {
  const usage = await usageRef(orgId).get();
  const bytesUsed = usage.exists ? Number(usage.data().bytesUsed) || 0 : 0;
  if (addedBytes > 0 && bytesUsed + addedBytes > teamStorageLimit(org.plan, org.seats)) {
    throw new OrgError('team-storage-full');
  }
}

/**
 * Copy the source asset's files into the team asset's folder; returns the
 * doc fields for them (paths and URLs). A missing thumbnail is not fatal.
 */
async function copyFiles({ source, uid, orgId, assetId }) {
  const copies = teamAssetCopies(source, {
    uid,
    orgId,
    assetId,
    copyId: crypto.randomUUID()
  });
  if (!copies) throw new OrgError('asset-not-found');
  const bucket = admin.storage().bucket();
  const fields = {};
  for (const copy of copies) {
    try {
      const target = bucket.file(copy.to);
      await bucket.file(copy.from).copy(target);
      // A token of its own: the personal file's token must not open it.
      const token = crypto.randomUUID();
      await target.setMetadata({
        metadata: { firebaseStorageDownloadTokens: token, assetId, orgId }
      });
      fields[copy.field] = copy.to;
      fields[copy.urlField] = downloadUrl(bucket.name, copy.to, token);
    } catch (error) {
      if (copy.field === 'thumbnailPath') {
        console.warn(`team-assets: thumbnail copy failed for ${assetId}:`, error.message);
        continue;
      }
      console.error(`team-assets: copy failed ${copy.from} -> ${copy.to}`, error);
      throw new OrgError('asset-not-found');
    }
  }
  return fields;
}

/** Add one of the caller's assets to a team's library. */
async function addAssetToTeam({ uid, orgId, assetId: sourceAssetId }) {
  const { org, member } = await requireTeamRole({ uid, orgId, action: 'add' });
  const source = await readSourceAsset(uid, sourceAssetId);
  await checkStorage({ org, orgId, addedBytes: Number(source.size) || 0 });
  const assetId = crypto.randomUUID();
  const files = await copyFiles({ source, uid, orgId, assetId });
  await teamAssetRef(orgId, assetId).set({
    ...contentFieldsOf(source),
    ...files,
    assetId,
    orgId,
    addedBy: uid,
    addedByName: member.displayName || member.email || null,
    addedFrom: { assetId: sourceAssetId, ownerUid: uid },
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { orgId, assetId };
}

/**
 * Replace a team asset's file with one of the caller's assets of the same
 * type. The team asset keeps its id and name, so every scene using it shows
 * the new file on its next load. The previous files stay: scenes opened by
 * people outside the team still point at them.
 */
async function replaceTeamAssetFile({ uid, orgId, assetId, sourceAssetId }) {
  const { org } = await requireTeamRole({ uid, orgId, action: 'replace' });
  if (typeof assetId !== 'string' || !assetId) throw new OrgError('invalid-argument');
  const current = await teamAssetRef(orgId, assetId).get();
  if (!current.exists || current.data().deleted) throw new OrgError('asset-not-found');
  const source = await readSourceAsset(uid, sourceAssetId);
  if (source.type !== current.data().type) throw new OrgError('asset-type-mismatch');
  await checkStorage({
    org,
    orgId,
    addedBytes: (Number(source.size) || 0) - (Number(current.data().size) || 0)
  });
  const files = await copyFiles({ source, uid, orgId, assetId });
  // eslint-disable-next-line no-unused-vars -- the team's name stays
  const { name, ...content } = contentFieldsOf(source);
  const cleared = {};
  for (const { path, url } of FILE_FIELDS) {
    if (!files[path]) {
      cleared[path] = FieldValue.delete();
      cleared[url] = FieldValue.delete();
    }
  }
  if (source.optimizedSourceSize === undefined) {
    cleared.optimizedSourceSize = FieldValue.delete();
  }
  await teamAssetRef(orgId, assetId).update({
    ...content,
    ...cleared,
    ...files,
    replacedBy: uid,
    replacedFrom: { assetId: sourceAssetId, ownerUid: uid },
    updatedAt: FieldValue.serverTimestamp()
  });
  return { orgId, assetId };
}

/**
 * Remove an asset from the library (soft delete; the weekly GC purges its
 * files after 30 days). Scenes still using it keep their saved URL until
 * then.
 */
async function removeTeamAsset({ uid, orgId, assetId }) {
  if (typeof orgId !== 'string' || !orgId) throw new OrgError('invalid-argument');
  if (typeof assetId !== 'string' || !assetId) throw new OrgError('invalid-argument');
  const current = await teamAssetRef(orgId, assetId).get();
  if (!current.exists || current.data().deleted) throw new OrgError('asset-not-found');
  await requireTeamRole({
    uid,
    orgId,
    action: 'remove',
    addedBy: current.data().addedBy
  });
  await teamAssetRef(orgId, assetId).update({
    deleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: uid,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { orgId, assetId };
}

/**
 * Firestore trigger: keep orgs/{orgId}/meta/usage.bytesUsed, counting the
 * originals' `size` of assets not deleted (like users/{uid}/meta/usage).
 */
const onTeamAssetWritten = functions.firestore
  .document('orgs/{orgId}/assets/{assetId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    const sizeBefore = before && !before.deleted ? Number(before.size) || 0 : 0;
    const sizeAfter = after && !after.deleted ? Number(after.size) || 0 : 0;
    const delta = sizeAfter - sizeBefore;
    if (delta === 0) return null;
    // Never below zero, like users/{uid}/meta/usage (asset-quota.js).
    await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(usageRef(context.params.orgId));
      const current = snapshot.exists ? Number(snapshot.data().bytesUsed) || 0 : 0;
      tx.set(
        usageRef(context.params.orgId),
        { bytesUsed: Math.max(0, current + delta), lastUpdated: FieldValue.serverTimestamp() },
        { merge: true }
      );
    });
    return null;
  });

const orgAddAsset = callable((data, context) =>
  addAssetToTeam({ uid: requireAuth(context), orgId: data.orgId, assetId: data.assetId })
);

const orgReplaceAssetFile = callable((data, context) =>
  replaceTeamAssetFile({
    uid: requireAuth(context),
    orgId: data.orgId,
    assetId: data.assetId,
    sourceAssetId: data.sourceAssetId
  })
);

const orgRemoveAsset = callable((data, context) =>
  removeTeamAsset({ uid: requireAuth(context), orgId: data.orgId, assetId: data.assetId })
);

module.exports = {
  addAssetToTeam,
  replaceTeamAssetFile,
  removeTeamAsset,
  onTeamAssetWritten,
  orgAddAsset,
  orgReplaceAssetFile,
  orgRemoveAsset
};
