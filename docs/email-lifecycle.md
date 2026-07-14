# Lifecycle Email System

How 3DStreet sends lifecycle emails (welcome, upsell nudges, payment notices,
re-engagement) from Cloud Functions via Postmark, with per-category
unsubscribe, stop-rules, and a full send audit — no external ESP workflows.

**Code:** `public/functions/email/` — `lifecycle-email.js` (send service),
`stop-rules.js`, `postmark.js` (transport), `templates.js` (all copy),
`lifecycle-triggers.js` (welcome on signup), `lifecycle-sweeps.js` (hourly
sweep) · Stripe-driven sends live in `index.js`'s `stripeWebhook` ·
`public/functions/scheduled/scheduledEmails.js` (daily sweep, see
[SCHEDULED_EMAILS_SYSTEM.md](../public/functions/scheduled/SCHEDULED_EMAILS_SYSTEM.md))

## Architecture

Every lifecycle email — whatever its trigger — goes through **one send path**:

```
trigger (sweep / webhook / event)
  └── sendLifecycleEmail({ uid, emailId, category, stream, template, rules, dedupeKey })
        ├── email/lifecycle-email.js   the send service (this is the reusable core)
        ├── email/stop-rules.js        pure stop-rule evaluation (unit-tested)
        └── email/postmark.js          shared transport: Postmark API + Auth lookup
```

`sendLifecycleEmail` does, in order:

1. **Suppression check** — broadcast streams only: skip if the recipient
   unsubscribed from this stream (`emailPrefs/{uid}`).
2. **Stop-rules + claim** — inside one Firestore transaction on the
   `emailLog/{uid}` summary doc: evaluate the rules against live state and, if
   allowed, claim the send (idempotent under concurrent triggers, e.g. a
   retried Stripe webhook — only one caller wins).
3. **Postmark send** — on the requested message stream.
4. **Audit** — an `emailLog/{uid}/sends/{id}` record tracks every attempt
   (`pending` → `sent` / `error`). On a Postmark failure the claim is rolled
   back so a later retry isn't blocked.

Triggers own only *when* and *to whom*; the service owns suppression,
frequency, delivery, and bookkeeping. That's the reusability contract: a new
email is a template + a trigger + a `rules` object, no new infrastructure.

## Streams, categories, and unsubscribe

Postmark message streams double as the unsubscribe preference center:

| Stream | Kind | Unsubscribe | Used for |
|--------|------|-------------|----------|
| `outbound` | transactional | none (by design) | receipts, payment issues, welcome |
| `conversion` | broadcast | Postmark-managed, per stream | upsell nudges (checkout abandoned, pricing page) |
| `lifecycle` | broadcast | Postmark-managed, per stream | activation / re-engagement |

- Broadcast sends automatically get an unsubscribe footer
  (`{{{ pm:unsubscribe_url }}}`, resolved by Postmark per recipient per
  stream).
- **Unsubscribe granularity is the stream, not the individual email or "all
  email".** Unsubscribing from a `conversion` email stops all `conversion`
  emails but not `lifecycle` ones, and never transactional mail on
  `outbound`.
- Opt-outs flow back via Postmark's Subscription Change webhook
  (`postmarkSubscriptionWebhook`, Basic-auth-gated by the
  `POSTMARK_WEBHOOK_AUTH` secret) into `emailPrefs/{uid}`, so eligibility
  sweeps can skip suppressed users up front. Postmark also enforces
  suppression server-side regardless.
- Add more streams (e.g. `expansion`, `re-engagement`) by creating them in the
  Postmark dashboard and appending to `BROADCAST_STREAMS` in
  `lifecycle-email.js`. Stream IDs in code must match Postmark exactly.

## Firestore collections (all cloud-only, see firestore.rules)

- **`emailLog/{uid}`** — summary doc backing stop-rules in a single read:
  per-email `lastSentAt` / `sentCount` / `dedupeKeys`, per-category
  `lastSentAt`.
- **`emailLog/{uid}/sends/{autoId}`** — audit of every attempted send:
  `{ emailId, category, stream, to, subject, dedupeKey, status, messageId,
  createdAt, sentAt }`. A record stuck on `pending` means an instance died
  between claiming and the Postmark response — rare enough at current volumes
  that it's surfaced as data rather than swept.
- **`emailPrefs/{uid}`** — per-stream opt-out state mirrored from the Postmark
  webhook.
- **`notifyLog/{uid}`** — legacy. Sends recorded before the emailLog migration
  (`tokenExhaustionEmailSent`). Still read as a never-resend guard; nothing
  new is written here.

## Stop-rules

Declared per email, enforced transactionally (`email/stop-rules.js`):

| Rule | Meaning |
|------|---------|
| `onceEver: true` | never resend this `emailId` to this user |
| `notWithinDays: N` | per-email cooldown |
| `categoryNotWithinDays: N` | cross-email cap, e.g. ≤1 `conversion` email per 7 days |
| `stopIfPro: true` | skip PRO/MAX users (upsell emails) |
| `dedupeKey` (send param) | once per external key — invoice id, checkout session id |

## Adding a new lifecycle email

1. **Template** — `{ getSubject(name, data), getHtmlBody(name, data),
   getTextBody(name, data) }`. Don't add an unsubscribe footer yourself; the
   service appends it for broadcast streams.
2. **Routing** — pick a stable `emailId`, a `category`, and a `stream`
   (transactional → `outbound`; marketing/behavioral → a broadcast stream).
3. **Rules** — compose from the table above.
4. **Trigger** — call `sendLifecycleEmail` from wherever the moment is
   detected:
   - *Event-driven* (a webhook or function already fires at the right moment):
     call it inline — `handleInvoicePaymentFailed` in `index.js` and the
     welcome trigger in `lifecycle-triggers.js` are the reference examples.
   - *Sweep-driven* (the moment is "state X has persisted for N hours/days"):
     add a sweep function in `lifecycle-sweeps.js` (hourly) or an
     `EMAIL_TYPES` entry in `scheduledEmails.js` (daily is enough). Sweeps can
     re-scan the same candidates forever — stop-rules make that free.
5. **Test** — dry-run first (see below); add stop-rule unit tests if you add a
   new rule, and an emulator test if the trigger logic is nontrivial
   (`test/rules/lifecycle-email.emulator.test.js` has patterns for both
   trigger styles).

## Testing and manual dry runs

- **Unit:** `npm test` covers stop-rules (`test/core/email-stop-rules.test.js`).
- **Emulator:** `npm run test:rules` (JDK 21+, local-only) covers the send
  service end-to-end — claims, rollback, suppression, unsubscribe footer,
  concurrency — and the migrated tokenExhaustion sweep
  (`test/rules/lifecycle-email.emulator.test.js`).
- **Pipeline test (admin claim required), from the browser console:**
  ```js
  await adminTools.testLifecycleEmail()                          // dry run to yourself, outbound
  await adminTools.testLifecycleEmail({ stream: 'conversion' })  // dry run, broadcast stream
  await adminTools.testLifecycleEmail({ dryRun: false })         // actually send
  ```
- **Sweep dry runs:** `await adminTools.triggerLifecycleSweep()` (hourly
  sweeps: abandoned checkout, pricing nudge, geo) and
  `await adminTools.triggerEmails()` (daily sweep: token exhaustion) report
  who would receive emails without sending.
- **Stripe events:** replay against the deployed dev project with the Stripe
  CLI — `stripe trigger checkout.session.completed` /
  `stripe trigger invoice.payment_failed`.

Roll out any new email by dry-running against the dev Firebase project and
checking Postmark activity (correct stream, footer renders) before prod.

## Manual verification checklist (black-box QA)

A human pass over the whole pipeline that requires **no code reading** — just
a browser console on the dev site (signed in as admin), the Firebase console
(Firestore data browser), and the Postmark Activity page. Run it after
deploying email changes to dev, before promoting to prod.

1. **Dry run is really dry.** `await adminTools.testLifecycleEmail()` →
   returns `{ action: 'would-send', to: <your email> }`. Confirm no email
   arrives and `emailLog/{your-uid}` did not change in Firestore.
2. **Transactional send.** `await adminTools.testLifecycleEmail({ dryRun:
   false })` → email arrives from `notify@3dstreet.com` with **no**
   unsubscribe footer; Postmark Activity shows it on the `outbound` stream;
   Firestore `emailLog/{your-uid}` now has `emails.testPing` and a
   `sends` record with `status: 'sent'` and a `messageId`.
3. **Broadcast send.** `await adminTools.testLifecycleEmail({ stream:
   'conversion', dryRun: false })` → email arrives from
   `team@updates.3dstreet.com`, **has** an unsubscribe footer, and
   Postmark Activity shows the `conversion` stream.
4. **Unsubscribe round-trip.** Click Unsubscribe in that email. Within a few
   seconds `emailPrefs/{your-uid}.streams.conversion.suppressed` becomes
   `true` in Firestore (that's the webhook working). Repeat step 3 → returns
   `{ action: 'skipped', reason: 'unsubscribed' }` and nothing arrives.
5. **Resubscribe.** Reactivate via Postmark's hosted page (linked from the
   unsubscribe confirmation) → `suppressed` flips back to `false`; step 3
   sends again. Also confirm the other stream (`lifecycle`) still sends while
   `conversion` is suppressed — that's the per-stream granularity.
6. **Sweep dry run.** `await adminTools.triggerEmails()` → returns a
   `wouldSend` list for `tokenExhaustion`. Spot-check one listed user in
   Firestore: their `tokenProfile` has `genToken` or `geoToken` at 0, and they
   have neither `emailLog.emails.tokenExhaustion` nor a legacy
   `notifyLog.tokenExhaustionEmailSent`. Users with either must NOT be listed.
7. **Stop-rule regression.** After a real sweep send to a test account
   (`await adminTools.triggerEmails(false)` on dev), immediately re-run the
   dry run → that account is gone from `wouldSend` (once-ever enforced), and
   its `emailLog` shows the send.
8. **Welcome on signup.** Create a fresh account on dev → welcome email
   arrives within a minute (no unsubscribe footer, `outbound` stream);
   `emailLog/{new-uid}.emails.welcome` appears.
9. **Purchase flow.** Buy a plan on dev with a Stripe test card → post-upgrade
   welcome arrives once; `checkoutSessions/{sessionId}` flips to
   `status: 'complete'` in Firestore. Or skip the UI and run
   `stripe trigger checkout.session.completed` with the Stripe CLI.
10. **Failed payment.** `stripe trigger invoice.payment_failed` against dev →
    failed-payment email for the matched test user; re-trigger with the same
    invoice → `skipped/dedupeKey` in the function logs, no second email.
11. **Abandoned checkout.** Start a checkout on dev, close the tab, confirm
    `checkoutSessions/{id}` exists with `status: 'open'`. After >1h run
    `await adminTools.triggerLifecycleSweep()` → the account appears under
    `sweeps.checkoutAbandoned1h.wouldSend`; `{ dryRun: false }` sends it (on
    the `conversion` stream, with footer).
12. **Pricing nudge + geo.** Open the upgrade modal on dev (don't check out)
    → `userSignals/{uid}.lastPaymentModalAt` appears in Firestore. Sweep dry
    runs list the account under `pricingPageNudge` after 24h, and a 3-day-old
    account that never activated geo under `geoNotUsed`. Activate a
    geospatial map → `tokenProfile.firstGeoActivatedAt` appears and the
    account drops out of the geo list.

For each **new** email added later, repeat the same shape: dry run → real
send to yourself → check rendering, stream, footer, and the `emailLog`
record → only then enable the trigger in prod.

## Operational setup (one-time)

Postmark dashboard:

1. Create the `conversion` and `lifecycle` broadcast streams (IDs must be
   exactly those strings).
2. `firebase functions:secrets:set POSTMARK_WEBHOOK_AUTH` (value
   `user:pass`).
3. After deploy, add a Subscription Change webhook on each broadcast stream
   pointing at
   `https://user:pass@<region>-<project>.cloudfunctions.net/postmarkSubscriptionWebhook`.

Stripe dashboard (dev first, then prod):

4. On the existing `stripeWebhook` endpoint, add `checkout.session.expired`
   and `invoice.payment_failed` to the enabled events
   (`checkout.session.completed` is already on). Same endpoint, same signing
   secret — no code or secret changes needed; unrecognized events are acked
   and ignored, so this is safe to do before or after deploy.

## The emails

| Email (`emailId`) | Stream | Trigger | Rules |
|-------------------|--------|---------|-------|
| `welcome` | outbound | Firebase Auth `onCreate` (`lifecycle-triggers.js`) — instant, new accounts only, no backfill | `onceEver` |
| `postUpgradeWelcome` | outbound | `checkout.session.completed` in `stripeWebhook` | `dedupeKey: sessionId` |
| `failedPayment` | outbound | `invoice.payment_failed` in `stripeWebhook` (fires per retry; deduped) | `dedupeKey: invoiceId` |
| `checkoutAbandoned1h` | conversion | hourly sweep over `checkoutSessions` not `complete`, created >1h ago | `dedupeKey: sessionId`, `categoryNotWithinDays: 7`, `stopIfPro` |
| `checkoutAbandoned72h` | conversion | same, >72h — **built but disabled** (`ENABLE_ABANDONED_72H` in `lifecycle-sweeps.js`) | same |
| `pricingPageNudge` | conversion | hourly sweep over `userSignals`: saw payment modal >24h ago, never started a checkout since | `notWithinDays: 30`, `categoryNotWithinDays: 7`, `stopIfPro` |
| `geoNotUsed` | lifecycle | hourly sweep: welcomed ≥3d ago (emailLog welcome timestamp = signup marker), no `firstGeoActivatedAt` | `onceEver`, `stopIfPro` |
| `tokenExhaustion` | outbound | daily sweep in `scheduledEmails.js` (`genToken`/`geoToken` at 0) | `onceEver`, `stopIfPro` (+ legacy notifyLog guard) |

The `generationReady` notification intentionally stays on its own job-level
idempotency (opt-in per generation job, acked by open tabs) and shares only
the transport.

## Trigger instrumentation (who writes the signal data)

- **`checkoutSessions/{sessionId}`** — `createStripeSession` writes
  `{ userId, email, priceId, mode, status: 'open', createdAt }` after
  creating the Stripe session; `stripeWebhook` flips `status` to `complete`
  (purchase) or `expired`. Cloud-only rules — a spoofed record would trigger
  email to an arbitrary user.
- **`userSignals/{uid}`** — two fields with different writers:
  `lastPaymentModalAt` is written by the client when the shared UpgradeModal
  opens (`UpgradeModal.jsx`; rules allow exactly that one field, owner-only,
  server clock — see `userSignals` in firestore.rules), and
  `lastCheckoutStartedAt` is written server-side by `createStripeSession`.
  The pricing nudge fires only when the first exists without a later second.
  No PostHog dependency — the funnel analytics and the email trigger are
  deliberately separate systems.
- **`tokenProfile.firstGeoActivatedAt`** — stamped by `geoid-height.js` on a
  user's first geo activation (both the token-decrement path and the Pro
  path).

## Status / roadmap

Longer-term: enable `checkoutAbandoned72h` once the 1h email's numbers
justify a second touch; move the newsletter onto a `newsletter` broadcast
stream and decommission Mailchimp (import its unsubscribes into stream
suppressions first).
