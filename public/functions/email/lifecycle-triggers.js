/**
 * Event-driven lifecycle email triggers.
 *
 * Welcome rides the Firebase Auth onCreate event (instant, new accounts only
 * — no backfill for pre-existing users by design). The Stripe-driven emails
 * (post-upgrade welcome, failed payment) live in the stripeWebhook handler in
 * index.js because that's where the events arrive; sweep-driven emails live
 * in lifecycle-sweeps.js. All of them send through sendLifecycleEmail — see
 * docs/email-lifecycle.md.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { sendLifecycleEmail } = require('./lifecycle-email.js');
const TEMPLATES = require('./templates.js');

/**
 * Send the welcome email to one user. Split from the trigger so the emulator
 * suite can exercise it directly. Accounts without an email address (e.g.
 * anonymous auth) resolve to action 'no-email' inside the send service.
 */
const sendWelcomeEmailForUser = (db, uid, { dryRun = false } = {}) =>
  sendLifecycleEmail({
    db,
    uid,
    emailId: 'welcome',
    category: 'transactional',
    stream: 'outbound',
    template: TEMPLATES.welcome,
    rules: { onceEver: true },
    dryRun
  });

const sendWelcomeEmail = functions
  .runWith({ secrets: ['POSTMARK_API_KEY'] })
  .auth.user()
  .onCreate(async (user) => {
    // onCreate can fire before the Auth record is fully readable and Firebase
    // retries thrown errors, but sendLifecycleEmail is idempotent (onceEver
    // claim), so a retry can never double-send.
    const result = await sendWelcomeEmailForUser(admin.firestore(), user.uid);
    console.log(`welcome email for new user ${user.uid}:`, JSON.stringify(result));
  });

module.exports = { sendWelcomeEmail, sendWelcomeEmailForUser };
