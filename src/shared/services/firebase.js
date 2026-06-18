import { initializeApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAI, VertexAIBackend } from 'firebase/ai';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// App Check (opt-in). When a reCAPTCHA Enterprise site key is configured we
// attest this client to Firebase, so backends enforcing App Check accept it.
// Forked / self-hosted builds won't have a key registered for their domain, so
// enforced functions reject them — without affecting environments that haven't
// set this up. In dev, set FIREBASE_APP_CHECK_DEBUG_TOKEN to register a debug
// token (use `true` to have the SDK print one to register in the console).
// Initialize before getAuth/getFunctions so early calls carry an App Check token.
if (process.env.FIREBASE_APP_CHECK_SITE_KEY) {
  const debugToken = process.env.FIREBASE_APP_CHECK_DEBUG_TOKEN;
  if (debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      process.env.FIREBASE_APP_CHECK_SITE_KEY
    ),
    isTokenAutoRefreshEnabled: true
  });
}

const auth = getAuth(app);
const storage = getStorage(app);
// Default is 10 minutes — way too long to leave a UI silently "uploading"
// when the user lost connection. 30s gives the SDK enough room to ride out
// brief blips while still surfacing a real failure (and our Retry button)
// quickly enough to act on. The settable property is documented on the
// Storage service instance; the modular setter isn't exported in this SDK
// version.
storage.maxUploadRetryTime = 30_000;
const db = getFirestore(app);
const functions = getFunctions(app);
const ai = getAI(app, { backend: new VertexAIBackend('global') });

// Admin utilities exposed on window for console access
// Server-side functions still enforce admin claim check
window.adminTools = {
  /**
   * Trigger scheduled emails (admin only)
   * @param {boolean} dryRun - If true (default), shows what would be sent without sending
   * @returns {Promise} Results showing emails sent or would be sent
   *
   * Usage from browser console:
   *   await adminTools.triggerEmails()           // dry run
   *   await adminTools.triggerEmails(true)       // dry run (explicit)
   *   await adminTools.triggerEmails(false)      // actually send emails
   */
  triggerEmails: async (dryRun = true) => {
    const trigger = httpsCallable(functions, 'triggerScheduledEmails');
    const result = await trigger({ dryRun });
    console.log(result.data);
    return result.data;
  },

  /**
   * Audit user subscriptions vs claims (admin/PRO only)
   * Identifies discrepancies between Stripe subscriptions and Firebase PRO claims
   * @param {boolean} fixDiscrepancies - If true, automatically fix claim issues
   * @returns {Promise} Audit report with discrepancies and optionally fixes applied
   *
   * Usage from browser console:
   *   await adminTools.auditUsers()              // audit only (dry run)
   *   await adminTools.auditUsers(false)         // audit only (explicit)
   *   await adminTools.auditUsers(true)          // audit AND fix discrepancies
   *
   * Report includes:
   *   - proClaimNoStripe: Users with PRO claim but no active Stripe subscription
   *   - stripeNoPROClaim: Users with active Stripe subscription but missing PRO claim
   */
  auditUsers: async (fixDiscrepancies = false) => {
    const audit = httpsCallable(functions, 'auditUserSubscriptions');
    const result = await audit({ fixDiscrepancies });
    console.log('=== User Subscription Audit Report ===');
    console.log(`Timestamp: ${result.data.timestamp}`);
    console.log(`Dry Run: ${result.data.dryRun}`);
    console.log('\n--- Summary ---');
    console.table(result.data.summary);
    if (result.data.discrepancies.proClaimNoStripe.length > 0) {
      console.log('\n--- PRO Claim but No Stripe Subscription ---');
      console.table(result.data.discrepancies.proClaimNoStripe);
    }
    if (result.data.discrepancies.stripeNoPROClaim.length > 0) {
      console.log('\n--- Stripe Subscription but No PRO Claim ---');
      console.table(result.data.discrepancies.stripeNoPROClaim);
    }
    if (!result.data.dryRun) {
      console.log('\n--- Fixes Applied ---');
      if (result.data.fixes.claimsRemoved.length > 0) {
        console.log('Claims removed:');
        console.table(result.data.fixes.claimsRemoved);
      }
      if (result.data.fixes.claimsAdded.length > 0) {
        console.log('Claims added:');
        console.table(result.data.fixes.claimsAdded);
      }
    }
    return result.data;
  },

  /**
   * Purge soft-deleted assets older than the grace window (admin only).
   * Hard-deletes Firestore docs + Storage blobs. Dry run by default.
   * @param {boolean} dryRun - If true (default), reports candidates without deleting
   * @returns {Promise} Summary with candidates, purgedDocs, bytesReclaimed*
   *
   * Usage:
   *   await adminTools.purgeAssets()         // dry run
   *   await adminTools.purgeAssets(false)    // actually delete
   */
  purgeAssets: async (dryRun = true) => {
    const trigger = httpsCallable(functions, 'triggerPurgeSoftDeletedAssets');
    const result = await trigger({ dryRun });
    console.log('=== Soft-Deleted Asset Purge ===');
    console.log(`Dry Run: ${result.data.dryRun}`);
    console.table({
      candidates: result.data.candidates,
      skippedNotDeleted: result.data.skippedNotDeleted,
      purgedDocs: result.data.purgedDocs,
      storageDeleted: result.data.storageDeleted,
      storageSkipped: result.data.storageSkipped,
      storageErrors: result.data.storageErrors,
      docErrors: result.data.docErrors,
      bytesReclaimedOriginal: result.data.bytesReclaimedOriginal,
      bytesReclaimedOptimized: result.data.bytesReclaimedOptimized
    });
    return result.data;
  },

  /**
   * Reconcile users/{uid}/meta/usage.bytesUsed against the sum of `size` on
   * non-deleted asset docs (admin only). Dry run by default.
   * @param {boolean} dryRun - If true (default), reports drift without writing
   * @returns {Promise} Summary with drifted, bytesAdjustedTotal, samples[]
   *
   * Usage:
   *   await adminTools.reconcileUsage()      // dry run
   *   await adminTools.reconcileUsage(false) // actually correct drift
   */
  reconcileUsage: async (dryRun = true) => {
    const trigger = httpsCallable(functions, 'triggerReconcileAssetUsage');
    const result = await trigger({ dryRun });
    console.log('=== Asset Usage Reconciliation ===');
    console.log(`Dry Run: ${result.data.dryRun}`);
    console.table({
      usersScanned: result.data.usersScanned,
      assetsScanned: result.data.assetsScanned,
      drifted: result.data.drifted,
      corrected: result.data.corrected,
      bytesAdjustedTotal: result.data.bytesAdjustedTotal,
      wouldExceedFreeLimit: result.data.wouldExceedFreeLimit
    });
    if (result.data.samples?.length) {
      console.log('\n--- Sample drift (up to 20) ---');
      console.table(result.data.samples);
    }
    return result.data;
  },

  /**
   * Find Storage objects under users/*\/assets/... that no Firestore asset
   * doc references, and delete them (admin only). Skips objects newer than
   * 24h to avoid racing with in-flight uploads. Dry run by default.
   * @param {boolean} dryRun - If true (default), reports orphans without deleting
   * @returns {Promise} Summary with orphans, deleted, bytesReclaimed, samples[]
   *
   * Usage:
   *   await adminTools.cleanupOrphans()        // dry run
   *   await adminTools.cleanupOrphans(false)   // actually delete
   */
  cleanupOrphans: async (dryRun = true) => {
    const trigger = httpsCallable(functions, 'triggerCleanupOrphanedStorage');
    const result = await trigger({ dryRun });
    console.log('=== Orphaned Storage Cleanup ===');
    console.log(`Dry Run: ${result.data.dryRun}`);
    console.table({
      assetsScanned: result.data.assetsScanned,
      referencedPaths: result.data.referencedPaths,
      objectsScanned: result.data.objectsScanned,
      orphans: result.data.orphans,
      skippedTooNew: result.data.skippedTooNew,
      skippedOutsideAssets: result.data.skippedOutsideAssets,
      deleted: result.data.deleted,
      deleteErrors: result.data.deleteErrors,
      bytesReclaimed: result.data.bytesReclaimed
    });
    if (result.data.samples?.length) {
      console.log('\n--- Sample orphans (up to 20) ---');
      console.table(result.data.samples);
    }
    return result.data;
  }
};

export { firebaseConfig, app, auth, storage, db, functions, ai };
