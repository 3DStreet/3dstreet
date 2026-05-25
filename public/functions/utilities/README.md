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
- Domain-based pro users (configured via the `ALLOWED_PRO_TEAM_DOMAINS` secret)
- Valid pro users (claim matches Stripe)
- Detailed list of each discrepancy

**Fixes applied (when `fixDiscrepancies: true`):**
- Removes PRO claim from users without active subscription
- Adds PRO claim to users with active subscription

---

### purgeAssets

Hard-deletes soft-deleted assets older than the grace window (30 days). Removes the Firestore doc and both Storage blobs (`storagePath` + `optimizedSourcePath`). Scheduled daily; this is the manual trigger.

**Usage from browser console:**
```javascript
await adminTools.purgeAssets()        // dry run — reports candidates + bytesReclaimed*
await adminTools.purgeAssets(false)   // actually delete
```

---

### reconcileUsage

Recomputes `users/{uid}/meta/usage.bytesUsed` from the source of truth (sum of `size` on non-deleted asset docs) and corrects drift. Scheduled weekly; this is the manual trigger.

**Usage from browser console:**
```javascript
await adminTools.reconcileUsage()        // dry run — reports drifted users + sample rows
await adminTools.reconcileUsage(false)   // actually write corrections
```

---

## Other Admin Tools

See also:
- `triggerScheduledEmails` - Manual trigger for scheduled emails (see `../SCHEDULED_EMAILS_SYSTEM.md`), exposed as `adminTools.triggerEmails()`

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
