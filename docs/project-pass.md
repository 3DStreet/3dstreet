# Project Pass — one-time time-boxed Pro (#1922)

A **Project Pass** is a one-time purchase (no subscription, no renewal) that
grants Pro-tier access for a fixed window plus an up-front gen-token grant.
Offer today: **$30 → 90 days of Pro + 300 tokens**.

**How it is sold today:** by hand. The buyer pays through a Stripe invoice
or Payment Link. You then mint a pass code (one use for one person, N uses
for an organization) and email the redeem link. Self-serve checkout at
`#project-pass` is a follow-up (see the end of this page); no checkout or
Stripe webhook code handles passes yet.

## Where things live

| Concern | Location |
|---|---|
| Pass config (days, tokens) + pure entitlement math | `public/functions/pro-pass.js` (`PRO_PASSES`) |
| Client mirror (display only) | `src/shared/components/UpgradeModal/pricing.js` (`PRO_PASSES`) — guarded by `test/shared/pricing-sync.test.js` |
| Display name | shared message `projectPassName` (`src/shared/i18n/sharedMessages.js`) |
| Fulfilment | `grantPass(uid, { days, tokens, idempotencyKey, source })` in `public/functions/token-management.js` |
| Codes | `#redeem?code=` → `RedeemPassModal` → `redeemPassCode` (`public/functions/pass-codes.js`, pure helpers in `pass-code-utils.js`); minted by `scripts/mint-pass-codes.js` |

Adding a second pass variant (e.g. a team pass with different days and
tokens) is config-only: add a `PRO_PASSES` entry (server + client), or mint
a code with `--days` / `--tokens`.

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

Stacking: `proUntil = max(now, proUntil) + days`. Deleting a subscription
clears only `plan`, so a subscriber who also has a pass keeps Pro until
`proUntil`.

## `grantPass` — the one fulfilment path

```js
grantPass(uid, { days, tokens, idempotencyKey, source, details, sessionId })
```

One transaction: credit `tokens`, extend `proUntil`, write the audit row
`tokenLog/pass-<idempotencyKey>`. A repeat call with the same key is a no-op
(`{ granted: true, alreadyGranted: true }`). Code redemption uses the
redemption id as the key; the self-serve checkout follow-up will use the
Stripe checkout session id.

## Pass codes

An organization (a foundation, a class, a workshop) pays once for N passes
and gets **one shared code capped at N uses**; an individual buyer gets a
one-use code. Recipients don't need a shared email domain, unlike Pro Team.
Each recipient's days start when **they** redeem, not when the buyer paid.

- **Minting** (after the invoice or Payment Link is paid):
  ```bash
  node scripts/mint-pass-codes.js --project=<project> --uses=10 \
    --org="Example Foundation" --prefix=FOUNDATION [--from="Prof. Smith, WSU"] \
    [--days=90] [--tokens=300] [--redeem-by-days=275] [--buyer-email=…] \
    [--notes="Invoice 1234"]
  ```
  The code's redeem-by deadline defaults to 365 days minus the pass length
  (275 days ≈ 9 months for a 90-day pass), so even the last recipient's pass
  ends within 12 months of the sale, matching an annual contract.
  `--org` is internal (who paid). `--from` is the display name recipients see
  ("Prof. Smith, WSU sent you a 3DStreet Project Pass"); omit it to keep the
  giver anonymous. Minting prints the redeem link
  (`https://3dstreet.app/#redeem?code=CODE`) and a ready-to-forward
  **invitation text** (English: who it's from, what's included, the link and
  the code) that you send to the buyer to paste into their own email.
  `--status=CODE [--list]` shows uses so far (and the redeeming uids, if a
  buyer needs them for grant reporting). `--deactivate=CODE` stops further
  redemptions without touching passes already granted.
- **Redeeming.** `#redeem?code=` opens `RedeemPassModal`, after sign-in for
  signed-out visitors. It calls `redeemPassCode` (`public/functions/pass-codes.js`):
  1. One transaction checks that the code exists, is active, is before
     `redeemBy` and has uses left, and that this user hasn't redeemed it.
     If so it increments `uses` and writes `passRedemptions/{CODE}_{uid}`.
  2. It then calls `grantPass` with that redemption id as the idempotency key.
  3. It sends the **`passActivated` email** (transactional, `outbound`
     stream, localized): who it's from, that it's active, the duration and
     end date, the tokens, what Pro includes, and a reminder to sign in at
     3dstreet.app with this email address. Deduped on the redemption id;
     best-effort, so an email failure never fails the redemption.
  A repeat by the same user returns `already-redeemed` and consumes no use.
  A crash between steps 1 and 2 (or a failed email) is completed by the next
  attempt.
- **Data** (server-only; rules deny all client access):
  - `passCodes/{CODE}` holds `product`, `days`, `tokens`, `maxUses`, `uses`,
    `redeemBy`, `active`, `org`, `fromName`, `buyerEmail` and `notes`
  - `passRedemptions/{CODE_uid}` has one row per redemption
- **Format:** `PREFIX-XXXXXXXX`. The 8 random characters come from an
  alphabet with no 0/O/1/I/L.
- **Analytics:** `modal_opened` (`modal: 'redeem-pass'`),
  `pass_code_redeemed` and `pass_code_redeem_failed`.

## Support

Look up `tokenProfile/{uid}`:

- `proUntil` is the pass expiry
- `proPassLastGrantedAt` is when the latest grant was applied

The audit row for a redeemed code is `tokenLog/pass-<CODE>_<uid>`: tokens
and days granted, proUntil before and after, and the code. The redemption
itself is `passRedemptions/<CODE>_<uid>`.

To comp or extend a pass by hand, edit `proUntil`. To end one early, set it in
the past.

## Deploy checklist

1. Deploy the Firestore rules (tightened `tokenProfile` create; closed
   `passCodes` / `passRedemptions`), the functions (`redeemPassCode` is new;
   it uses the existing `POSTMARK_API_KEY` secret) and hosting.
2. Mint a test code on staging and redeem it with two accounts. Check that a
   third account is refused on a two-use code. Check that each account gets
   the confirmation email once (Postmark Activity, `outbound` stream).

## Follow-ups

- **Self-serve checkout (`#project-pass`).** A $30 one-time Stripe price;
  `createStripeSession` recognizes it and the webhook calls `grantPass` with
  the checkout session id. It was built and then held back from the first
  release so that `stripe.js` (the live subscription and token-pack path) is
  untouched; restore it by reverting the "Hold back self-serve Project Pass
  checkout" commit. It needs the `STRIPE_PROJECT_PASS_PRICE_ID` secret and
  config/.env values before deploy.
- **"Buy for others" checkout**, where the webhook mints a code instead of
  granting the buyer. Only once hand sales show demand.
- **Invitation emails sent by 3DStreet** to a buyer-supplied list of
  recipient emails (`--invite=list.csv`), ideally with one single-use code
  per recipient. Needs a send path keyed on an email address rather than a
  uid, since recipients may not have accounts yet.
- **More lifecycle emails:** expiry reminder, pass ended.
