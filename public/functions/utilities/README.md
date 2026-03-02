# Admin Utilities

Cloud Functions for administrative tasks. **All utilities require `admin` claim** on the authenticated user.

## Available Utilities

### auditUserSubscriptions

Identifies discrepancies between Stripe subscriptions and Firebase PRO claims.

**Usage from browser console:**
```javascript
// Audit only (dry run) - shows discrepancies without fixing
await adminTools.auditUsers()

// Audit AND fix discrepancies
await adminTools.auditUsers(true)
```

**What it checks:**
- `proClaimNoStripe`: Users with `plan: 'PRO'` claim but no active Stripe subscription
- `stripeNoPROClaim`: Users with active Stripe subscription but missing `plan: 'PRO'` claim

**Report includes:**
- Total users with PRO claims
- Total active Stripe subscribers
- Domain-based pro users (e.g., `uoregon.edu`)
- Valid pro users (claim matches Stripe)
- Detailed list of each discrepancy

**Fixes applied (when `fixDiscrepancies: true`):**
- Removes PRO claim from users without active subscription
- Adds PRO claim to users with active subscription

---

## Other Admin Tools

See also:
- `triggerScheduledEmails` - Manual trigger for scheduled emails (see `../SCHEDULED_EMAILS_SYSTEM.md`)

## Adding New Utilities

1. Create a new file in this directory
2. Export functions from `../index.js`
3. Add `adminTools.yourFunction()` helper in `src/shared/services/firebase.js`
4. Document in this README
5. Require admin claim:
   ```javascript
   if (!context.auth.token.admin) {
     throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
   }
   ```
