# Project Pass — one-time time-boxed Pro (#1922)

A **Project Pass** is a single Stripe payment (no subscription, no renewal)
that grants Pro-tier access for a fixed window plus an up-front gen-token
grant. Offer today: **$30 → 90 days of Pro + 300 tokens**.

It is sold two ways: self-serve checkout at `#project-pass` (see Purchase
flow), and by hand as pass codes for organizations (see Pass codes).

## Where things live

| Concern | Location |
|---|---|
| Pass config (days, tokens, price secret) + pure entitlement math | `public/functions/pro-pass.js` (`PRO_PASSES`) |
| Client mirror (display only) | `src/shared/components/UpgradeModal/pricing.js` (`PRO_PASSES`) — guarded by `test/shared/pricing-sync.test.js` |
| Display name | shared message `projectPassName` (`src/shared/i18n/sharedMessages.js`) |
| Fulfilment | `grantPass(uid, { days, tokens, idempotencyKey, source })` in `public/functions/token-management.js` |
| Checkout gating | `createStripeSession` (`public/functions/stripe.js`) |
| Webhook | `stripeWebhook` → `grantProPassForCheckout` |
| Entry point | `#project-pass` → `store.firstModal()` → `EditorProjectPassModal` → shared `ProjectPassModal` |
| Codes | `#redeem?code=` → `RedeemPassModal` → `redeemPassCode` (`public/functions/pass-codes.js`, pure helpers in `pass-code-utils.js`); minted by `scripts/mint-pass-codes.js` |

There is one product today: the 3-month Project Pass. Codes already store
their own days and tokens, so a second variant later means a `PRO_PASSES`
entry (server + client), its price secret for self-serve checkout, plus a
mint-script flag to pick it.

## Entitlement

**Pro = paid plan claim (PRO/MAX) OR Pro-team domain OR `proUntil > now`**
(`hasProEntitlement` in `pro-pass.js`). Expiry is evaluated when entitlement
is read — there is no scheduled job, and nothing is touched when a pass
lapses: scenes, assets and already-granted tokens all stay.

`proUntil` is stored on **`tokenProfile/{uid}`** (a Firestore Timestamp),
not in auth custom claims: the Stripe webhooks call
`setCustomUserClaims({ plan })`, which replaces the whole claims object.
Clients can't write it — `tokenProfile` updates are denied, and the create
rule only allows the six default fields.

Every Pro check honors the pass:

- `checkUserProStatus` (client source of truth) — returns `isProPass` and
  `proUntil` (ISO) in addition to the existing fields
- `isUserProInternal` — token-pack gate, `geoid-height`, lifecycle emails'
  `stopIfPro`
- `asset-quota.js` `resolvePlanForUser` — pass holders get PRO storage
- Client: `src/shared/auth/api/user.js` → `currentUser.isProPass/proUntil`.
  The cached-claims fallback can't see `proUntil`, so during a callable
  outage a pass-only user reads as free (subscribers are unaffected).

**No monthly token top-up** for pass holders: the refill keys off the
subscription claim and team domain only. The 300-token lump sum replaces it.

`utilities/user-audit.js` never sees pass holders — they have neither a plan
claim nor a subscription — so it neither reports nor "fixes" them.

## Purchase flow

1. `#project-pass` (optional `?src=<tag>` or `&src=<tag>` for attribution)
   opens the modal. Signed-out visitors sign in first and land back in it.
2. `createStripeSession` matches the pass price server-side, forces
   `mode: 'payment'`, skips the duplicate-subscription block (subscribers may
   buy a pass), sets `customer_creation: 'always'` for first-time customers,
   and tags `metadata.product = 'pro-pass-project'` (+ the client `source`).
   An unknown price with `mode: 'payment'` is still rejected, and token packs
   still require Pro.
3. `checkout.session.completed` → the payment branch matches the pass
   **before** token packs, backfills `userProfile.stripeCustomerId`, and calls
   `grantPass` with the checkout session id as the idempotency key. Any
   failure returns non-2xx so Stripe retries; it never falls through to the
   subscription branch.
4. The modal polls `checkUserProStatus` until `proUntil` moves, then updates
   the auth context so every Pro gate flips without a reload.

Stacking: `proUntil = max(now, proUntil) + days`. Deleting a subscription
clears only `plan`, so a subscriber who also bought a pass keeps Pro until
`proUntil`.

## `grantPass` — the one fulfilment path

```js
grantPass(uid, { days, tokens, idempotencyKey, source, details, sessionId })
```

One transaction: credit `tokens`, extend `proUntil`, write the audit row
`tokenLog/pass-<idempotencyKey>`. A repeat call with the same key is a no-op
(`{ granted: true, alreadyGranted: true }`). Paid checkout uses the Stripe
checkout session id as the key; code redemption uses the redemption id.

## Pass codes (gifting passes)

An organization (a foundation, a class, a workshop) pays once for N passes
and gets **one shared code capped at N uses**; an individual buyer gets a
one-use code. Recipients don't need a shared email domain, unlike Pro Team.
Each recipient's days start when **they** redeem, not when the buyer paid.

- **Minting** (after the invoice or Payment Link is paid):
  ```bash
  node scripts/mint-pass-codes.js --project=<project> --uses=10 \
    --org="Example Foundation" [--prefix=FOUNDATION] [--from="Prof. Smith, WSU"] \
    [--buyer-email=…] [--notes="Invoice 1234"] [--notify=you@example.com,buyer@example.org]
  ```
  Every code grants the standard pass (90 days + 300 tokens) and must be
  redeemed within 275 days (~9 months), so even the last recipient's pass
  ends within 12 months of the sale, matching an annual contract. There are
  deliberately no flags for days, tokens or deadline; add them back if a
  second product appears. To extend one user by hand, edit their `proUntil`.
  `--org` is internal (who paid). `--from` is the display name recipients see
  ("Prof. Smith, WSU sent you a 3DStreet Project Pass"); omit it to keep the
  giver anonymous. Minting prints the redeem link
  (`https://3dstreet.app/#redeem?code=CODE`) and a ready-to-forward
  **invitation text** (English: who it's from, what's included, the link and
  the code) that you send to the buyer to paste into their own email.
  `--notify` lists the code's contacts (comma-separated: you, the buyer),
  who get a status email on every redemption; it defaults to your
  `git config user.email` (minting refuses when that is unset, rather than
  silently minting a code with no contacts), and `--notify=none` turns it
  off. To add or
  change contacts on a code already given out, edit `notifyEmail` on its
  doc (a string or an array of strings); the next redemption uses it.
  `--status=CODE [--list]` shows uses so far (and the redeeming uids, if a
  buyer needs them for grant reporting). `--deactivate=CODE` stops further
  redemptions without touching passes already granted.
- **Redeeming.** `#redeem?code=` opens `RedeemPassModal`, after sign-in for
  signed-out visitors. It calls `redeemPassCode` (`public/functions/pass-codes.js`):
  0. Subscribers (PRO/MAX claim) and Pro-team users are refused
     (`already-pro`, no use consumed): the pass would run alongside the Pro
     they already have and waste a seat. Existing pass holders may redeem a
     different code; its days stack onto `proUntil`. Each person can redeem
     a given code only once.
  1. One transaction checks that the code exists, is active, is before
     `redeemBy` and has uses left, and that this user hasn't redeemed it.
     If so it increments `uses` and writes `passRedemptions/{CODE}_{uid}`.
  2. It then calls `grantPass` with that redemption id as the idempotency key.
  3. It sends the **`passActivated` email** (transactional, `outbound`
     stream, localized): who it's from, that it's active, the duration and
     end date, the tokens, what Pro includes, and a reminder to sign in at
     3dstreet.app with this email address. Deduped on the redemption id;
     best-effort, so an email failure never fails the redemption.
  4. If the code has a `notifyEmail`, each contact gets the
     **`passCodeRedeemed` email** (standard template, localized when the
     contact has a 3DStreet account, no CTA): the code, who redeemed it
     (name and email, with "tell us if you don't recognize them"), uses so
     far and how many are left, when this pass ends, the code's redeem-by
     date, the redeem link while passes remain, and "reply to this email"
     for changes, since there is no code dashboard. Sent once, by the call
     that consumed the use; best-effort and not retried.
  A repeat by the same user returns `already-redeemed` and consumes no use.
  A crash between steps 1 and 2 (or a failed email) is completed by the next
  attempt.
- **Data** (server-only; rules deny all client access):
  - `passCodes/{CODE}` holds `product`, `days`, `tokens`, `maxUses`, `uses`,
    `redeemBy`, `active`, `org`, `fromName`, `buyerEmail`, `notes` and
    `notifyEmail`
  - `passRedemptions/{CODE_uid}` has one row per redemption
- **Format:** `PREFIX-XXXXXXXX`. The 8 random characters come from an
  alphabet with no 0/O/1/I/L.
- **Analytics:** `modal_opened` (`modal: 'redeem-pass'`),
  `pass_code_redeemed` and `pass_code_redeem_failed`.

## Support

Look up `tokenProfile/{uid}`:

- `proUntil` is the pass expiry
- `proPassSessionIds` lists the checkout sessions that paid for it
- `proPassLastGrantedAt` is when the latest grant was applied

Full audit rows are `tokenLog/pass-<sessionId>` for a purchase, or
`tokenLog/pass-<CODE>_<uid>` for a redeemed code: tokens and days granted,
proUntil before and after, amount, and `checkoutSource`. Open checkouts are in
`checkoutSessions` (`product`, `source`). A code redemption itself is
`passRedemptions/<CODE>_<uid>`.

To comp or extend a pass by hand, edit `proUntil`. To end one early, set it in
the past.

## Analytics

The pass uses the existing checkout event family (`modal_opened`,
`checkout_started`, `checkout_session_created`, `payment_completed`,
`checkout_canceled`) with `plan: 'pro-pass-project'`, plus
`product: 'pro-pass'` and `source` where the modal emits the event itself.

Abandoned pass checkouts are excluded from the subscription-oriented
abandoned-checkout email (`lifecycle-sweeps.js`).

## Deploy checklist

1. Create the Stripe price: $30 USD, one-time.
2. Create the server secret **before** deploying functions. `firebase deploy`
   fails while a secret declared in `runWith` is missing.
   ```bash
   firebase functions:secrets:set STRIPE_PROJECT_PASS_PRICE_ID   # paste price_…
   ```
   Do this for staging too, with the staging price.
3. Set the client price in `config/.env.production` and
   `config/.env.development` (`STRIPE_PROJECT_PASS_PRICE_ID = "price_…"`).
   While it is empty, the modal reports that the pass is unavailable.
4. Deploy the Firestore rules, the functions and hosting.
5. Mint a test code on staging and redeem it with two accounts. Check that a
   third account is refused on a two-use code. Check that each account gets
   the confirmation email once (Postmark Activity, `outbound` stream).

## Follow-ups

- **"Buy for others" checkout**, where the webhook mints a code instead of
  granting the buyer. Only once hand sales show demand.
- **Invitation emails sent by 3DStreet** to a buyer-supplied list of
  recipient emails (`--invite=list.csv`), ideally with one single-use code
  per recipient. Needs a send path keyed on an email address rather than a
  uid, since recipients may not have accounts yet.
- **More lifecycle emails:** expiry reminder, pass ended.
- **A 3-month Max pass** (a second SKU) would need a separate `maxUntil` date
  next to `proUntil` (Max = MAX claim OR `maxUntil > now`, and it also counts
  as Pro), honored in asset quota, plan labels and the token grant, plus a
  `PRO_PASSES` entry and a mint flag to pick it; it's additive, with no
  migration.
