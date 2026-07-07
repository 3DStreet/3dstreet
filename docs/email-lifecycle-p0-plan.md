# Email Lifecycle P0 — Implementation Plan (draft)

**Status:** PR 1 in review (`feat/email-lifecycle-pr1-foundation`) · **Created:** 2026-07-06
**Goal:** ship the P0 lifecycle email wave on Postmark with in-repo orchestration, building on the existing `scheduledEmails.js` system. Mailchimp decommission is the end state (Phase 3).

## Inputs (read these first)

- **Phase 0 audit (start here):** `~/dev/3dstreet-private/reports/email-lifecycle-phase0-audit-2026-07-06.md` — trigger inventory, Firestore state, Postmark/Stripe/Mailchimp account state, volumes, gap list.
- **Spec / architecture decisions:** Google Doc `1VA9AvNQyaLhWEOVPmYENIP-KuX8PDjKOxYaXzU33Jvc` ("Lifecycle Email System: Audit + Build").
- **P0 email copy:** Google Doc `1oT0RgoAgC7TFJbcMJCLlxw-ITzCFm0r733oEa_YzIm8` (3DStreet_P0_Emails.md).
- **Prioritization sheet:** Google Sheet `11vK-xi3B92lzbgy-GLTWoka8ppyV5MhoD6gkGW7_zBM`.
- **Existing system:** `public/functions/scheduled/scheduledEmails.js` + `public/functions/scheduled/SCHEDULED_EMAILS_SYSTEM.md`.

## Fixed decisions (from spec + audit)

1. Postmark only; Mailchimp removed at the end. Templates stay **in-repo** (inline HTML as today; no Postmark-hosted templates).
2. Two routing rules: **transactional** → existing `outbound` stream, no unsubscribe (Welcome, Failed Payment, Post-Upgrade Welcome). **Marketing/behavioral** → broadcast streams with Postmark-managed unsubscribe (Checkout Abandoned, Pricing Page, Geo Not Used).
3. Broadcast streams double as the category preference center: create `conversion` and `lifecycle` streams for P0 (create `expansion` / `re-engagement` when P1 needs them). Wire Postmark's **Subscription Change webhook** → Firestore.
4. Orchestration lives in Cloud Functions + Firestore `emailLog`; eligibility and stop-rules are code.
5. Don't over-build: if orchestration outgrows a few hundred lines, flag for a purpose-built ESP instead.

## P0 emails, triggers, and stop-rules

| # | Email | Stream | Trigger | Stop-rules |
|---|-------|--------|---------|-----------|
| 1 | Welcome | outbound (transactional) | new Firebase Auth user | once ever |
| 2 | Post-Upgrade Welcome | outbound | `checkout.session.completed` (existing `stripeWebhook`) | once per upgrade |
| 3 | Failed Payment | outbound | `invoice.payment_failed` (new webhook event) | max 1 per invoice; stop if paid |
| 4 | Checkout Abandoned 1h | conversion (broadcast) | checkout session open >1h (new `checkoutSessions` record + sweep) | stop if completed/upgraded; once per session; ≤1 per user per 7d |
| 5 | Checkout Abandoned 72h | conversion | same, >72h | **build but ship disabled** (flag); skip if 1h converted |
| 6 | Pricing Page, No Checkout | conversion | payment modal opened, no checkout within 24h (see open decision D2) | once per user per 30d; stop if upgraded |
| 7 | Activation: Geo Not Used | lifecycle (broadcast) | signed up ≥3d ago, never activated geo (needs `firstGeoActivatedAt`, see PR 2) | once ever; stop if activated or Pro |

## PR sequence

### PR 1 — Foundation: `emailLog` + send service + streams ✅ (in review)

- ✅ `emailLog/{uid}` summary doc (per-email `lastSentAt`/`sentCount`/`dedupeKeys` + per-category `lastSentAt`) backs stop-rules in one read; `emailLog/{uid}/sends/{autoId}` is the append-only audit (`{ emailId, category, stream, to, subject, dedupeKey, status, messageId, sentAt }`). This resolves **D3**: one summary doc per uid (not flat `{uid}_{emailId}`) so the "≤1 per category per 7d" check needs no query, + the sends subcollection. `notifyLog` untouched (tokenExhaustion back-compat).
- ✅ `sendLifecycleEmail({ db, uid, emailId, category, stream, template, data, rules, dedupeKey, dryRun })` in `public/functions/email/lifecycle-email.js`; stop-rules are a pure module (`email/stop-rules.js`, unit-tested: `onceEver`, `notWithinDays`, `categoryNotWithinDays`, `stopIfPro`, `dedupeKey`). Claim happens in a transaction (safe under Stripe webhook retries), rolled back on Postmark failure. Broadcast sends get an `{{{ pm:unsubscribe_url }}}` footer + `emailPrefs` check.
- ✅ Firestore rules: `emailLog` (+ `sends`) and `emailPrefs` cloud-only, with rules tests.
- ✅ `postmarkSubscriptionWebhook` — Basic-auth-gated (secret `POSTMARK_WEBHOOK_AUTH`), writes per-stream opt-outs to `emailPrefs/{uid}` via Auth email lookup.
- ✅ `triggerLifecycleEmail` admin callable + `adminTools.testLifecycleEmail()` console helper — end-to-end pipeline test (`testPing` email, dry-run default, stream selectable).
- **Manual (Kieran, Postmark dashboard):** create `conversion` + `lifecycle` broadcast streams (stream IDs must be exactly those strings); set secret `firebase functions:secrets:set POSTMARK_WEBHOOK_AUTH` (value `user:pass`); after deploy, add Subscription Change webhook on both broadcast streams pointing at `https://user:pass@<region>-<project>.cloudfunctions.net/postmarkSubscriptionWebhook`. Confirm DKIM status while in there (audit couldn't check: server token only).

### PR 2 — Trigger instrumentation

- `createStripeSession`: write `checkoutSessions/{sessionId}` `{ userId, email, plan, createdAt, status:'open' }` (cloud-only rules); `stripeWebhook` marks `status:'complete'`.
- Refactor `stripeWebhook` to switch on `event.type` (today it blindly assumes checkout.session.completed — see audit) and subscribe the endpoint to `invoice.payment_failed` (+ optionally `checkout.session.expired` for hygiene). **Manual:** update the webhook's enabled events in Stripe dashboard or via API.
- `geoid-height.js`: set `firstGeoActivatedAt` on `tokenProfile` at the existing decrement site (also set for Pro users who skip decrement).
- Note: firebase-functions is pinned ^13-compatible in `public/functions` — check before adding v2 auth triggers (see D1).

### PR 3 — Transactional wave (emails 1–3)

- Templates from the P0 copy doc into `EMAIL_TEMPLATES` (or a new `templates/` module).
- Post-Upgrade Welcome: event-driven send inside `stripeWebhook` (pattern: `sendGenerationReadyEmail`).
- Failed Payment: send from the new `invoice.payment_failed` handler; resolve uid via `userProfile.stripeCustomerId`.
- Welcome: trigger per decision D1.

### PR 4 — Broadcast wave (emails 4–7)

- New sweep (either extend `sendScheduledEmails` or a second hourly cron — abandoned-1h needs hourly granularity, the daily 9am cron is too coarse):
  - Checkout Abandoned 1h (+72h behind a flag), from `checkoutSessions`.
  - Geo Not Used, from Auth `creationTime` + `firstGeoActivatedAt`.
  - Pricing Page nudge per D2.
- Route through broadcast streams so Postmark injects unsubscribe; check `emailPrefs` before send.

### PR 5 / Phase 3 — Mailchimp decommission (separate effort)

- **Blocked on:** locating the Firebase→Mailchimp sync (not in code — check Mailchimp Integrations / Zapier).
- Move newsletter to a `newsletter` broadcast stream (drafts already in `3dstreet-private/newsletters/`); import Mailchimp unsubscribes into stream suppressions before first send; cancel Mailchimp (~$150/mo).

## Open decisions (resolve before/at PR 3)

- **D1 Welcome trigger:** Auth `onCreate` function (instant, but new users only) vs. hourly sweep via Admin `listUsers` (also catches backlog; slight delay). Lean: `onCreate` + no backfill.
- **D2 Pricing Page signal:** the only signal today is client-side PostHog (`modal_opened {modal:'payment'}`, `checkout_started`). Options: (a) cron queries PostHog API (needs personal API key as a function secret), (b) add a tiny server-side counter (callable or Firestore write from client on modal open) and keep orchestration Firestore-only. Lean: (b) — one field `lastPaymentModalAt` on `tokenProfile`, no PostHog dependency.
- **D3 emailLog shape:** ~~subcollection per user vs. flat collection~~ **Resolved in PR 1:** summary doc `emailLog/{uid}` (all stop-rule state in one transactional read) + `sends` audit subcollection.

## Testing / rollout

- Unit: stop-rule logic (pure functions). Rules: `npm run test:rules` (JDK 21+).
- Dry-run every new email type via `triggerScheduledEmails`-style admin callable before enabling.
- Stripe: replay events with Stripe CLI (`stripe trigger invoice.payment_failed`) against the deployed dev project.
- Deploy to dev project first; verify sends land in Postmark activity with correct stream; then prod.
- Volumes are tiny (~11 signups/day, ~1 abandoned checkout/2 days) — monitor the first week manually via Postmark activity.
