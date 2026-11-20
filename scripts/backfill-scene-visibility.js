/**
 * Backfill `visibility: 'public'` on scenes written before scene visibility
 * existed (#1267, docs/scene-visibility.md).
 *
 * The community feed queries `where('visibility', '==', 'public')`, which
 * can't match a document without the field, so every existing scene must
 * get it before the new client and rules are deployed — otherwise the feed
 * comes back empty. Rules and getScene already treat a missing field as
 * public, so the backfill changes nothing else. updateTimestamp (the feed's
 * sort key) is left untouched.
 *
 * Usage:
 *   gcloud auth application-default login   # one-time
 *
 *   node scripts/backfill-scene-visibility.js --project=dev-3dstreet          # dry run: counts only
 *   node scripts/backfill-scene-visibility.js --project=dev-3dstreet --apply  # write
 *
 * Safe to re-run: scenes that already have a visibility are skipped.
 * Or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 */

const admin = require('firebase-admin');
const { FieldPath } = require('firebase-admin/firestore');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  })
);

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

const KNOWN_FLAGS = ['project', 'apply'];
const unknown = Object.keys(args).filter((k) => !KNOWN_FLAGS.includes(k));
if (unknown.length) fail(`unknown flag(s): ${unknown.join(', ')}`);

const projectId = args.project || process.env.GCLOUD_PROJECT;
if (!projectId) fail('--project is required (e.g. --project=dev-3dstreet)');
const apply = args.apply === true;

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 500; // also the batch write limit

async function main() {
  console.log(
    `${apply ? 'Backfilling' : 'Dry run on'} scenes in ${projectId}...`
  );
  let scanned = 0;
  let missing = 0;
  let last = null;
  for (;;) {
    // Only the field we need, paged by document id.
    let page = db
      .collection('scenes')
      .select('visibility')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) page = page.startAfter(last);
    const snapshot = await page.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let inBatch = 0;
    for (const doc of snapshot.docs) {
      scanned++;
      if (doc.get('visibility') === undefined) {
        missing++;
        inBatch++;
        batch.update(doc.ref, { visibility: 'public' });
      }
    }
    if (apply && inBatch) await batch.commit();
    last = snapshot.docs[snapshot.docs.length - 1];
    process.stdout.write(
      `\r  scanned ${scanned}, without visibility ${missing}`
    );
  }
  console.log(
    `\n${apply ? 'Set' : 'Would set'} visibility 'public' on ${missing} of ${scanned} scenes.` +
      (apply ? '' : ' Re-run with --apply to write.')
  );
}

main().catch((error) => {
  console.error('\nBackfill failed:', error);
  process.exit(1);
});
