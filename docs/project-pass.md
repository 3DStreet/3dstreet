# Project Pass — one-time time-boxed Pro (#1922)

A **Project Pass** is a single Stripe payment (no subscription, no renewal)
that grants Pro-tier access for a fixed window plus an up-front gen-token
grant. Offer today: **$30 → 90 days of Pro + 300 tokens**.

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

Adding a second pass SKU (e.g. a team variant) is config-only: add a
`PRO_PASSES` entry (server + client) and its price secret.

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
session id as the key; a future pass-code redemption would use the
redemption id.

## Support

Look up `tokenProfile/{uid}`:

- `proUntil` is the pass expiry
- `proPassSessionIds` lists the checkout sessions that paid for it
- `proPassLastGrantedAt` is when the latest grant was applied

Full audit rows are `tokenLog/pass-<sessionId>`: tokens and days granted,
proUntil before and after, amount, and `checkoutSource`. Open checkouts are in
`checkoutSessions` (`product`, `source`).

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
4. Deploy the Firestore rules (tightened `tokenProfile` create), the
   functions, and hosting.
