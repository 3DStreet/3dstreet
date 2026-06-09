/**
 * Quota Audit — dry run, read-only.
 *
 * Iterates every users/{uid}/assets/* doc, sums non-deleted `size` bytes per
 * user, resolves their plan from custom claims, and writes a CSV of who would
 * be over each plan limit if quota enforcement landed today.
 *
 * Usage:
 *   gcloud auth application-default login   # one-time
 *   node scripts/quota-audit.js --project=dev-3dstreet [--out=quota-audit.csv]
 *
 * Or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 *
 * Output columns:
 *   uid, plan, planLimitMB, bytesUsed, usedMB, assetCount, missingSizeCount,
 *   wouldExceedFree, wouldExceedPro, wouldExceedTeam
 *
 * Notes:
 *   - Reads only. Does not write to Firestore.
 *   - `missingSizeCount` counts asset docs with no/zero size — those are the
 *     V1-era leftovers that wouldn't move the live quota counter.
 *   - Soft-deleted docs (deleted: true) are excluded from the size sum.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const projectId = args.project || process.env.GCLOUD_PROJECT || 'dev-3dstreet';
const outPath = path.resolve(args.out || 'quota-audit.csv');

const MB = 1000 * 1000;
const GB = 1000 * MB;
const PLAN_LIMITS = {
  FREE: 100 * MB,
  PRO: 5 * GB,
  TEAM: 25 * GB,
  MAX: 25 * GB
};

admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();

async function resolvePlan(uid) {
  try {
    const u = await auth.getUser(uid);
    const c = u.customClaims || {};
    if (c.plan === 'MAX' || c.plan === 'TEAM') return 'TEAM';
    if (c.plan === 'PRO') return 'PRO';
  } catch {
    /* user may not exist in Auth — fall through */
  }
  return 'FREE';
}

async function listUserIds() {
  // Users with assets are the only ones that can hit quota — walk the
  // assets collectionGroup, dedupe by parent uid. Cheaper than enumerating
  // all Firebase Auth users.
  const snap = await db
    .collectionGroup('assets')
    .select('size', 'deleted')
    .get();
  const byUser = new Map();
  for (const doc of snap.docs) {
    // path: users/{uid}/assets/{assetId}
    const segs = doc.ref.path.split('/');
    const uid = segs[1];
    const data = doc.data() || {};
    const size = Number(data.size) || 0;
    const deleted = data.deleted === true;
    const entry = byUser.get(uid) || { bytes: 0, count: 0, missing: 0 };
    if (!deleted) {
      entry.count++;
      if (size > 0) entry.bytes += size;
      else entry.missing++;
    }
    byUser.set(uid, entry);
  }
  return byUser;
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

(async () => {
  console.log(`[quota-audit] project=${projectId} out=${outPath}`);
  console.log('[quota-audit] scanning assets collectionGroup…');
  const byUser = await listUserIds();
  console.log(`[quota-audit] ${byUser.size} users with assets`);

  const rows = [];
  let i = 0;
  for (const [uid, entry] of byUser) {
    i++;
    if (i % 50 === 0) console.log(`[quota-audit] ${i}/${byUser.size}`);
    const plan = await resolvePlan(uid);
    const planLimit = PLAN_LIMITS[plan];
    rows.push({
      uid,
      plan,
      planLimitMB: (planLimit / MB).toFixed(0),
      bytesUsed: entry.bytes,
      usedMB: (entry.bytes / MB).toFixed(2),
      assetCount: entry.count,
      missingSizeCount: entry.missing,
      wouldExceedFree: entry.bytes > PLAN_LIMITS.FREE ? 1 : 0,
      wouldExceedPro: entry.bytes > PLAN_LIMITS.PRO ? 1 : 0,
      wouldExceedTeam: entry.bytes > PLAN_LIMITS.TEAM ? 1 : 0
    });
  }

  rows.sort((a, b) => b.bytesUsed - a.bytesUsed);

  const headers = Object.keys(
    rows[0] || {
      uid: '',
      plan: '',
      planLimitMB: '',
      bytesUsed: '',
      usedMB: '',
      assetCount: '',
      missingSizeCount: '',
      wouldExceedFree: '',
      wouldExceedPro: '',
      wouldExceedTeam: ''
    }
  );
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))
  ].join('\n');
  fs.writeFileSync(outPath, csv);

  // Summary to stdout
  const totalBytes = rows.reduce((s, r) => s + r.bytesUsed, 0);
  const overFree = rows.filter(
    (r) => r.plan === 'FREE' && r.wouldExceedFree
  ).length;
  const freeCount = rows.filter((r) => r.plan === 'FREE').length;
  const overPro = rows.filter(
    (r) => r.plan === 'PRO' && r.wouldExceedPro
  ).length;
  const proCount = rows.filter((r) => r.plan === 'PRO').length;
  const missingTotal = rows.reduce((s, r) => s + r.missingSizeCount, 0);

  console.log('');
  console.log('=== Summary ===');
  console.log(`Users with assets:       ${rows.length}`);
  console.log(`Total bytes tracked:     ${(totalBytes / GB).toFixed(2)} GB`);
  console.log(`Asset docs missing size: ${missingTotal} (V1 leftovers)`);
  console.log(`FREE users over limit:   ${overFree} / ${freeCount}`);
  console.log(`PRO  users over limit:   ${overPro} / ${proCount}`);
  console.log(`CSV written to:          ${outPath}`);

  process.exit(0);
})().catch((err) => {
  console.error('[quota-audit] failed:', err);
  process.exit(1);
});
