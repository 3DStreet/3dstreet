# Team AI token wallets (#1267 Phase 3)

A team ([orgs.md](orgs.md)) pays its members' AI generations from one
wallet, so what the team spends stays within the budget it pays for.

## Who pays

- Each user chooses who pays their generations: a team where they hold a
  seat (owner, admin, member), or their own tokens. It's
  `userOrgs/{uid}.billingOrgId` (null = their own), set with
  `orgSetBilling` from the profile ("AI generations paid by") or from the
  out-of-tokens modal ("Use my own tokens instead").
- Getting a seat makes the team pay when the user hasn't chosen one yet;
  losing it (leaving, removed, made a viewer) switches back to their own
  tokens if that team paid. `userOrgsPatch` in `orgs.js` does both.
- It's re-checked at every charge (`resolveBillingOrg`): if the team isn't
  active or the user no longer holds a seat in it, their own tokens pay.
- Viewers never spend the team's tokens. A team seat no longer refills
  personal tokens each month.

## The wallet

`orgWallets/{orgId}` = { genToken, monthlyTokenBudget, memberMonthlyCap
(null = no limit), lastRefill: 'YYYY-M' (month 0-based) } and
`orgWallets/{orgId}/usage/{YYYY-M}` = { total, members: { [uid]: tokens } }.

- **Monthly budget:** on the first charge of a month the balance is topped
  up to `monthlyTokenBudget` (never lowered: tokens added on top survive).
  New teams get the plan's allowance per seat (Pro 100, Max 500). Staff
  change it, or add tokens, with `orgUpdateWallet`
  (`adminTools.updateTeamWallet(orgId, { monthlyTokenBudget, addTokens })`).
- **Limit per member:** owners and admins set `memberMonthlyCap`
  (`orgSetMemberCap`, team settings → AI tokens), which also lists each
  member's usage this month.
- Members read their team's wallet and usage (the app shows what they can
  still spend); only functions write them.

## Charging and refunds

`chargeGenerationTokens` (`token-management.js`) resolves who pays inside
its transaction. For a team, `prepareWalletCharge` refills, refuses with
`resource-exhausted` and `details.reason` `member-cap` or `wallet-empty`,
then charges the wallet and counts the usage; the job records
`chargedOrgId` and `chargedMonth`. Refunds (`refundSplatToken`,
`refundFalJobInline`) give those tokens back to that wallet and that
month. The pre-flight checks before a job use `spendableGenTokens`, and
`tokenLog` entries carry `orgId`.

## Client

`AuthProvider` follows the billing team's wallet and month usage and
exposes an effective `tokenProfile`: `genToken` is what the member can
still spend from the team, `personalGenToken` their own balance, and
`billing` = { orgId, teamName, balance, monthlyTokenBudget,
memberMonthlyCap, usedThisMonth }. Everything that reads `genToken`
(token counts, the generator's checks) follows. The math mirrors the
server's (`src/shared/utils/teamWallet.js` ↔ `wallet-utils.js`, checked by
`test/shared/team-wallet-sync.test.js`). The token card and the buy-tokens
modal explain team-paid tokens instead of selling packs.

## Tests

- `test/core/wallet-utils.test.js`: refill, member limit, refusals.
- `test/rules/team-wallet.emulator.test.js`: charges, limit, empty wallet,
  fallback to own tokens, refunds, keeping who pays in sync, settings.
- `test/rules/orgs.rules.test.js`: wallet and usage read rules.

## Teams created before wallets

Only test data (teams weren't released before wallets): such a team has no
wallet, so its budget is 0 and team charges are refused (`wallet-empty`)
until staff set one with `orgUpdateWallet`. Its members get `billingOrgId`
when their membership changes, or choose it in their profile.
