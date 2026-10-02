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
 *     [--notes="Invoice 1234"]
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
const { PRO_PASSES } = require('../public/functions/pro-pass.js');
const {
  generatePassCode,
  normalizePassCode,
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
const ANNUAL_TERM_DAYS = 365;

const KNOWN_FLAGS = [
  'project',
  'uses',
  'org',
  'prefix',
  'from',
  'buyer-email',
  'notes',
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
          createdBy: os.userInfo().username,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      console.log(`Minted ${code}`);
      console.log(
        `  ${maxUses} uses · ${days} days + ${tokens} tokens each · redeemable for ${redeemByDays} days`
      );
      console.log(`  From: ${fromName || '(anonymous)'}`);
      console.log(`  Link: ${redeemLink(code)}`);
      console.log('\n--- Invitation text for the buyer to forward ---\n');
      console.log(
        buildInvitationText({ code, fromName, days, tokens, redeemByMs })
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
