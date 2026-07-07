# Lifecycle Email System

How 3DStreet sends lifecycle emails (welcome, upsell nudges, payment notices,
re-engagement) from Cloud Functions via Postmark, with per-category
unsubscribe, stop-rules, and a full send audit — no external ESP workflows.

**Code:** `public/functions/email/` (send service + stop-rules + transport) ·
`public/functions/scheduled/scheduledEmails.js` (daily sweep trigger, see
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
     call it inline — e.g. a `stripeWebhook` event handler with
     `dedupeKey: invoiceId`.
   - *Sweep-driven* (the moment is "state X has persisted for N hours/days"):
     add an entry to `EMAIL_TYPES` in `scheduledEmails.js` with
     `getEligibleUsers(db)` + template selection, and the daily sweep does the
     rest. (Sub-daily timing needs a new hourly cron.)
5. **Test** — dry-run first (see below); add stop-rule unit tests if you add a
   new rule, and an emulator test if the trigger logic is nontrivial.

`tokenExhaustion` (in `scheduledEmails.js`) is the reference example of a
sweep-driven email; `triggerLifecycleEmail`'s `testPing` shows the minimal
event-driven shape.

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
- **Sweep dry run:** `await adminTools.triggerEmails()` reports who would
  receive sweep emails without sending.

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
   'conversion', dryRun: false })` → email **has** an unsubscribe footer and
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

For each **new** email added later, repeat the same shape: dry run → real
send to yourself → check rendering, stream, footer, and the `emailLog`
record → only then enable the trigger in prod.

## Operational setup (Postmark dashboard, one-time)

1. Create the `conversion` and `lifecycle` broadcast streams (IDs must be
   exactly those strings).
2. `firebase functions:secrets:set POSTMARK_WEBHOOK_AUTH` (value
   `user:pass`).
3. After deploy, add a Subscription Change webhook on each broadcast stream
   pointing at
   `https://user:pass@<region>-<project>.cloudfunctions.net/postmarkSubscriptionWebhook`.

## Status / roadmap

**Shipped:** the send service and everything above, plus the first migrated
email (`tokenExhaustion`). The `generationReady` notification intentionally
stays on its own job-level idempotency (opt-in per generation job, acked by
open tabs) and shares only the transport.

**Planned emails** (templates + triggers not yet implemented; instrumentation
noted where it doesn't exist yet):

| Email | Stream | Trigger | Rules |
|-------|--------|---------|-------|
| Welcome | outbound | new Firebase Auth user | `onceEver` |
| Post-Upgrade Welcome | outbound | `checkout.session.completed` (existing `stripeWebhook`) | `dedupeKey: sessionId` |
| Failed Payment | outbound | `invoice.payment_failed` (webhook must subscribe to this event) | `dedupeKey: invoiceId` |
| Checkout Abandoned | conversion | checkout open >1h (needs a `checkoutSessions` record written by `createStripeSession`) | `dedupeKey: sessionId`, `categoryNotWithinDays: 7`, `stopIfPro` |
| Pricing Page, No Checkout | conversion | payment modal opened, no checkout in 24h (needs a server-side signal, e.g. `lastPaymentModalAt`) | `notWithinDays: 30`, `stopIfPro` |
| Activation: Geo Not Used | lifecycle | signed up ≥3d ago, never used geo (needs `firstGeoActivatedAt` on `tokenProfile`) | `onceEver`, `stopIfPro` |

Longer-term: move the newsletter onto a `newsletter` broadcast stream and
decommission Mailchimp (import its unsubscribes into stream suppressions
first).
