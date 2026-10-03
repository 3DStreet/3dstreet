/**
 * Mint, inspect or deactivate Project Pass codes (#1922 follow-up).
 *
 * One shared code per sale, capped at the number of passes paid for. Codes
 * are sold by hand (invoice through Stripe), then minted here and emailed to
 * the buyer. Recipients redeem at https://3dstreet.app/#redeem?code=CODE.
 * Each recipient's days start when they redeem. See docs/project-pass.md.
 *
 * Usage:
 *   gcloud auth application-default login   # one-time
 *
 *   # mint: 10 uses of the standard Project Pass (PRO_PASSES 'project':
 *   # 90 days + 300 tokens). Every code is redeemable for 365 - 90 = 275
 *   # days (~9 months), so the last recipient's pass still ends within 12
 *   # months of the sale, matching an annual contract.
 *   node scripts/mint-pass-codes.js --project=dev-3dstreet \
 *     --uses=10 --org="Example Foundation" [--prefix=FOUNDATION] \
 *     [--from="Prof. Smith, WSU"] [--buyer-email=ops@example.org] \
 *     [--notes="Invoice 1234"] [--notify=you@example.com,buyer@example.org]
 *
 *   There are deliberately no knobs for days, tokens or deadline: one product,
 *   one shape. (To extend a single user by hand, edit their proUntil.)
 *   Unknown flags are rejected rather than ignored.
 *
 *   --org is internal (who paid). --from is what recipients see: "<from> sent
 *   you a 3DStreet Project Pass" in the invitation text printed below and in
 *   the confirmation email sent on redemption. Omit --from to stay anonymous.
 *   Minting prints an invitation text for the buyer to forward.
 *
 *   --notify is who gets a status email on every redemption (comma-separate
 *   several, e.g. you and the buyer); it defaults to your
 *   `git config user.email` (and is required when that is unset).
 *   --notify=none turns the emails off.
 *
 *   # status: uses so far (and redeeming uids with --list)
 *   node scripts/mint-pass-codes.js --project=dev-3dstreet --status=FOUNDATION-7KQ2XXXX [--list]
 *
 *   # stop further redemptions (existing passes are unaffected)
 *   node scripts/mint-pass-codes.js --project=dev-3dstreet --deactivate=FOUNDATION-7KQ2XXXX
 *
 * Or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const { PRO_PASSES } = require('../public/functions/pro-pass.js');
const {
  generatePassCode,
  normalizePassCode,
  appBaseForProject,
  redeemLink,
  buildInvitationText
} = require('../public/functions/pass-code-utils.js');

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

const projectId = args.project || process.env.GCLOUD_PROJECT;
if (!projectId) fail('--project is required (e.g. --project=dev-3dstreet)');

admin.initializeApp({ projectId });
const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;
// Links point at the app for --project (3dstreet.app for production,
// https://<project>.web.app otherwise), so dev codes open the dev app.
const appBase = appBaseForProject(projectId);
const ANNUAL_TERM_DAYS = 365;

const KNOWN_FLAGS = [
  'project',
  'uses',
  'org',
  'prefix',
  'from',
  'buyer-email',
  'notes',
  'notify',
  'status',
  'list',
  'deactivate'
];
const unknownFlags = Object.keys(args).filter((k) => !KNOWN_FLAGS.includes(k));
if (unknownFlags.length) {
  fail(
    `unknown flag(s): ${unknownFlags.map((k) => `--${k}`).join(', ')}. ` +
      'Codes always grant the standard Project Pass; see the usage header.'
  );
}

const positiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    fail(`--${name} must be a positive integer`);
  }
  return n;
};

async function mint() {
  const pass = PRO_PASSES.find((p) => p.id === 'project');
  if (!args.org || args.org === true) fail('--org is required');

  const maxUses = positiveInt(args.uses, 'uses');
  const { days, tokens } = pass;
  const fromName =
    typeof args.from === 'string' && args.from.trim()
      ? args.from.trim().slice(0, 80)
      : null;
  // The year minus the pass length (275 days, ~9 months), so even the last
  // recipient's pass ends within 12 months of the sale.
  const redeemByDays = ANNUAL_TERM_DAYS - days;

  const redeemByMs = Date.now() + redeemByDays * DAY_MS;

  let notify = typeof args.notify === 'string' ? args.notify.trim() : '';
  if (!notify) {
    try {
      notify = execSync('git config user.email').toString().trim();
    } catch {
      notify = '';
    }
  }
  // Never mint a code with no contacts by accident: no --notify and no git
  // email means the operator must say --notify=none.
  if (!notify) {
    fail(
      'no --notify given and no git email to default to; pass --notify=<email> or --notify=none'
    );
  }
  const notifyEmails =
    notify === 'none'
      ? []
      : notify
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean);
  if (notifyEmails.some((e) => !e.includes('@'))) {
    fail('--notify must be email address(es), comma-separated, or "none"');
  }
  // One address is stored as a string, several as a list; redeemPassCode
  // accepts either, so contacts can be added to the doc by hand later.
  const notifyEmail =
    notifyEmails.length > 1 ? notifyEmails : notifyEmails[0] || null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePassCode(args.prefix, crypto.randomInt);
    try {
      // create() fails if the doc exists, so a random collision retries
      // instead of overwriting someone else's code.
      await db
        .collection('passCodes')
        .doc(code)
        .create({
          product: pass.id,
          days,
          tokens,
          maxUses,
          uses: 0,
          active: true,
          redeemBy: admin.firestore.Timestamp.fromMillis(redeemByMs),
          org: String(args.org),
          fromName,
          buyerEmail:
            typeof args['buyer-email'] === 'string'
              ? args['buyer-email']
              : null,
          notes: typeof args.notes === 'string' ? args.notes : null,
          notifyEmail,
          createdBy: os.userInfo().username,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      console.log(`Minted ${code}`);
      console.log(
        `  ${maxUses} uses · ${days} days + ${tokens} tokens each · redeemable for ${redeemByDays} days`
      );
      console.log(`  From: ${fromName || '(anonymous)'}`);
      console.log(
        `  Redemption updates: ${notifyEmails.join(', ') || '(off)'}`
      );
      console.log(`  Link: ${redeemLink(code, appBase)}`);
      console.log('\n--- Invitation text for the buyer to forward ---\n');
      console.log(
        buildInvitationText({
          code,
          fromName,
          days,
          tokens,
          redeemByMs,
          baseUrl: appBase
        })
      );
      return;
    } catch (err) {
      if (err.code !== 6 /* ALREADY_EXISTS */) throw err;
    }
  }
  fail('could not generate a unique code after 5 attempts');
}

async function status(rawCode) {
  const code = normalizePassCode(rawCode);
  if (!code) fail('malformed code');
  const doc = await db.collection('passCodes').doc(code).get();
  if (!doc.exists) fail(`no such code ${code}`);
  const d = doc.data();
  console.log(`${code} (${d.org})`);
  console.log(`  from: ${d.fromName || '(anonymous)'}`);
  console.log(
    `  updates to: ${[].concat(d.notifyEmail || []).join(', ') || '(off)'}`
  );
  console.log(`  uses: ${d.uses || 0} / ${d.maxUses}`);
  console.log(`  pass: ${d.days} days + ${d.tokens} tokens (${d.product})`);
  console.log(`  active: ${d.active !== false}`);
  console.log(
    `  redeem by: ${d.redeemBy?.toDate?.().toISOString() ?? 'never'}`
  );
  if (args.list) {
    const snap = await db
      .collection('passRedemptions')
      .where('code', '==', code)
      .get();
    for (const r of snap.docs) {
      const rd = r.data();
      console.log(
        `  - ${rd.userId} ${rd.redeemedAt?.toDate?.().toISOString() ?? ''}`
      );
    }
  }
}

async function deactivate(rawCode) {
  const code = normalizePassCode(rawCode);
  if (!code) fail('malformed code');
  await db.collection('passCodes').doc(code).update({
    active: false,
    deactivatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log(`Deactivated ${code}`);
}

(async () => {
  if (args.status) await status(String(args.status));
  else if (args.deactivate) await deactivate(String(args.deactivate));
  else await mint();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
