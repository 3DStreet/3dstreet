# PLG Email Launch Runbook — Deploy Thursday, July 9

Human checklist to take PR [#1819](https://github.com/3DStreet/3dstreet/pull/1819)
live. Everything below assumes the PR is merged as-is; the code is done, CI is
green, and the only remaining work is dashboard configuration, deploys, and
verification. Companion doc: [email-lifecycle.md](./email-lifecycle.md)
(architecture + full black-box checklist).

## Why this ships now

Every day this sits unshipped, the product stays silent at the exact moments
users decide whether to pay or leave:

- **~11 signups/day get no welcome.** New users hit the editor cold; the geo
  feature that sells Pro goes undiscovered. That's ~330 people/month with no
  activation touch.
- **Abandoned checkouts get zero follow-up.** Someone clicks "Go Pro", opens
  Stripe checkout, walks away — and never hears from us. Abandoned-cart
  recovery is consistently the highest-converting lifecycle email in any
  funnel; we currently recover 0%.
- **Failed payments silently churn paying customers.** A card expires, Stripe
  retries, gives up, subscription dies — the customer never gets told. This is
  involuntary churn we could prevent with one email.
- **Pricing-page lookers vanish.** People open the payment modal, hesitate,
  and close it. Today that intent signal isn't even recorded.

The whole PLG funnel motion — activate → convert → retain — has no email arm
until this deploys. It also unblocks retiring Mailchimp (~$150/mo).

**Risk is low:** stop-rules cap frequency by design (once-ever, per-invoice/
session dedupe, ≤1 conversion email per user per 7 days), unsubscribe is
Postmark-managed per stream, every send is audited in Firestore, and volumes
are tiny (~11 signups/day, ~1 abandoned checkout/2 days). Rollback is a
10-minute revert-and-redeploy.

## What goes live

| Email | When | Stream |
|-------|------|--------|
| Welcome | instantly on signup | transactional |
| Post-Upgrade Welcome | on completed checkout | transactional |
| Failed Payment | on failed subscription payment | transactional |
| Checkout Abandoned (1h) | 1h after an unfinished checkout | conversion (unsubscribable) |
| Pricing Page Nudge | 24h after viewing plans w/o checkout | conversion (unsubscribable) |
| Geo Not Used | 3d after signup, geo never tried | lifecycle (unsubscribable) |
| Token Exhaustion | existing email, now on the new plumbing | transactional |

(Checkout Abandoned 72h is built but ships **disabled**.)

## Wednesday (today) — 30–40 min of prep, no deploy required

1. **Review the email copy** (~15 min). Templates:
   `public/functions/email/templates.js`. The copy was drafted in-house to
   match the existing token-exhaustion style; if you want the wording from the
   P0 copy doc (`3DStreet_P0_Emails.md`), paste it in now — it's plain
   template strings, nothing else changes. This is the one place a human
   judgment call is genuinely needed before send.
2. **Postmark dashboard** (~5 min):
   - Create two broadcast message streams with IDs exactly `conversion` and
     `lifecycle`.
   - While there: confirm DKIM + Return-Path for 3dstreet.com are verified
     (deliverability; the audit couldn't check this with the server token).
3. **Secrets** (~5 min): invent a `user:pass` value and set it on both
   projects:
   ```bash
   cd public
   firebase use dev-3dstreet    && firebase functions:secrets:set POSTMARK_WEBHOOK_AUTH
   firebase use dstreet-305604  && firebase functions:secrets:set POSTMARK_WEBHOOK_AUTH
   ```
4. **Stripe dashboard** (~5 min, safe to do before deploy — unknown events
   are acked and ignored): on the existing `stripeWebhook` endpoint
   (dev and prod), add these to the enabled events, keeping
   `checkout.session.completed`:
   - `checkout.session.expired`
   - `invoice.payment_failed`

   Same endpoint, same signing secret — no code or secret changes.
5. **Merge PR #1819** (flip from draft → ready → merge).

## Thursday morning — dev deploy + verification (~1.5h)

1. **Deploy to dev.** Note `npm run deploy:staging` covers *hosting only*;
   rules and functions need explicit deploys:
   ```bash
   cd public && firebase use dev-3dstreet
   firebase deploy --only firestore:rules
   firebase deploy --only functions
   cd .. && npm run deploy:staging   # hosting (UpgradeModal signal + adminTools)
   ```
2. **Postmark webhooks** (needs the deployed URL): on **each** broadcast
   stream (`conversion`, `lifecycle`), add a Subscription Change webhook
   pointing at
   `https://user:pass@us-central1-dev-3dstreet.cloudfunctions.net/postmarkSubscriptionWebhook`
   (substitute the real `user:pass` and confirm the region shown in the
   Firebase console).
3. **Run the verification pass** — the 12-step black-box checklist in
   [email-lifecycle.md](./email-lifecycle.md#manual-verification-checklist-black-box-qa).
   Minimum critical subset (~20 min, browser console on dev as admin):
   ```js
   await adminTools.testLifecycleEmail()                            // dry run
   await adminTools.testLifecycleEmail({ dryRun: false })           // transactional send arrives
   await adminTools.testLifecycleEmail({ stream: 'conversion', dryRun: false })
   // click Unsubscribe in that email → check emailPrefs/{uid} flips in Firestore,
   // then re-run the line above → returns skipped/unsubscribed
   await adminTools.triggerLifecycleSweep()                         // sweep dry run
   ```
   Plus: create a throwaway account on dev → welcome email arrives; and
   `stripe trigger invoice.payment_failed` (Stripe CLI, dev keys) → failed
   payment email fires once.
4. **Check System Health** (admin page): `lifecycleEmailSweep` appears and
   goes green after the top of the hour.

## Thursday afternoon — prod deploy (~45 min)

1. Same deploy, prod project:
   ```bash
   cd public && firebase use dstreet-305604
   firebase deploy --only firestore:rules
   firebase deploy --only functions
   cd .. && npm run deploy   # prod hosting
   ```
2. Add the two Postmark Subscription Change webhooks pointing at the **prod**
   function URL (step 2 above, prod hostname).
3. Repeat the critical subset: `testLifecycleEmail` dry + real to yourself on
   both stream types, unsubscribe round-trip, `triggerLifecycleSweep()` dry
   run (read the `wouldSend` lists before anything real goes out — this is
   the moment to catch a surprise cohort).
4. Watch the first hour: Postmark Activity (sends landing on the right
   streams), function logs for `sendWelcomeEmail` on the next organic signup,
   System Health for the hourly sweep.

## Friday — day-after checks (~10 min)

- Postmark Activity: welcome count ≈ yesterday's signups; zero spam
  complaints/bounces out of the ordinary.
- System Health: `lifecycleEmailSweep` green, ~24 runs.
- Firestore `emailLog`: spot-check a few `sends` audit records; no docs stuck
  on `status: 'pending'`.
- Any surprises in volume → see kill switches below.

## Kill switches / rollback

- **Stop the sweeps** (abandoned/nudge/geo): Firebase console → delete or
  disable the `lifecycleEmailSweep` function (or its Cloud Scheduler job).
  Transactional emails keep working.
- **Stop one broadcast stream**: pause sending by reverting that sweep, or in
  an emergency suppress recipients at the Postmark stream level.
- **Full rollback**: revert the merge commit on `main`, redeploy functions +
  hosting (~10 min). Firestore rules/collections are additive and harmless to
  leave in place; `emailLog` state is preserved so re-shipping later can't
  double-send anything that already went out (once-ever + dedupe keys are
  durable).

## Success criteria (first 2 weeks)

- 100% of new signups receive exactly one welcome (emailLog vs Auth counts).
- ≥1 abandoned-checkout email delivered and at least measured for click/convert
  (UTM `utm_campaign=checkout_abandoned_1h` in PostHog).
- Zero duplicate sends (audit `emailLog/{uid}/sends` for repeated
  emailId+dedupeKey).
- Unsubscribe rate on broadcast streams < 2%; any higher → revisit copy/timing.
- Then: decide on enabling the 72h abandoned follow-up and start the Mailchimp
  decommission.
