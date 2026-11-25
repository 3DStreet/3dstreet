import { initializeApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from 'firebase/app-check';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from 'firebase/functions';
import {
  isEmulatorMode,
  EMULATOR_PROJECT_ID,
  EMULATOR_HOST,
  EMULATOR_PORTS
} from '../utils/emulators.js';

const useEmulators = isEmulatorMode();

const firebaseConfig = useEmulators
  ? // Local Emulator Suite: a demo- project needs no real keys and can never
    // reach a deployed project (see src/shared/utils/emulators.js).
    {
      apiKey: 'demo-api-key',
      authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
      appId: 'demo-app-id'
    }
  : {
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
// Skipped in emulator mode: the emulators don't enforce App Check and the
// reCAPTCHA key isn't registered for the demo project.
if (process.env.FIREBASE_APP_CHECK_SITE_KEY && !useEmulators) {
  const debugToken = process.env.FIREBASE_APP_CHECK_DEBUG_TOKEN;
  if (debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }
  // The reCAPTCHA Enterprise provider injects a badge element into
  // document.body on init. This bundle loads in <head> (before <body> exists),
  // so activating immediately throws "appendChild of null". Defer until the DOM
  // body is available — App Check registers on the app and is consulted at
  // request time, so this still attaches tokens to later auth/functions calls.
  const activateAppCheck = () => {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(
        process.env.FIREBASE_APP_CHECK_SITE_KEY
      ),
      isTokenAutoRefreshEnabled: true
    });
  };
  if (document.body) {
    activateAppCheck();
  } else {
    document.addEventListener('DOMContentLoaded', activateAppCheck, {
      once: true
    });
  }
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

if (useEmulators) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
    disableWarnings: true
  });
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage);
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
  console.warn(
    `[firebase] Emulator mode: using the local emulators (project ${EMULATOR_PROJECT_ID}), not a deployed project.`
  );
}

// Admin utilities exposed on window for console access
// Server-side functions still enforce admin claim check
window.adminTools = {
  /**
   * Create an organization (teams, #1267; staff only). The owner is added
   * right away when they have an account, otherwise invited by email.
   *
   * Usage:
   *   await adminTools.createOrg({ name: 'LA Metro', plan: 'MAX', seats: 10,
   *     ownerEmail: 'owner@metro.net', domains: ['metro.net'] })
   */
  createOrg: async ({ name, plan, seats, ownerEmail, domains = [] }) => {
    const create = httpsCallable(functions, 'orgCreate');
    const result = await create({ name, plan, seats, ownerEmail, domains });
    console.log(result.data);
    return result.data;
  },

  /**
   * Update an organization (staff only): name, plan ('PRO' | 'MAX'), seats,
   * status ('active' | 'suspended'), domains.
   *
   * Usage:
   *   await adminTools.updateOrg('orgId', { seats: 20, status: 'active' })
   */
  updateOrg: async (orgId, patch) => {
    const update = httpsCallable(functions, 'orgUpdate');
    const result = await update({ orgId, patch });
    console.log(result.data);
    return result.data;
  },

  /**
   * A team's AI token wallet (staff only, #1267 Phase 3): the monthly budget
   * (the wallet is topped up to it each month) and/or tokens added on top.
   *
   * Usage:
   *   await adminTools.updateTeamWallet('orgId', { monthlyTokenBudget: 1000 })
   *   // back to the plan's allowance per seat:
   *   await adminTools.updateTeamWallet('orgId', { monthlyTokenBudget: 'default' })
   *   await adminTools.updateTeamWallet('orgId', { addTokens: 500 })
   */
  updateTeamWallet: async (orgId, { monthlyTokenBudget, addTokens } = {}) => {
    const update = httpsCallable(functions, 'orgUpdateWallet');
    const result = await update({ orgId, monthlyTokenBudget, addTokens });
    console.log(result.data);
    return result.data;
  },

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
   * Test the lifecycle email pipeline (admin only). Sends the `testPing`
   * email through the full send path: emailPrefs suppression check,
   * emailLog stop-rules + audit record, Postmark stream routing.
   *
   * Usage from browser console:
   *   await adminTools.testLifecycleEmail()                          // dry run to yourself, outbound
   *   await adminTools.testLifecycleEmail({ stream: 'conversion' })  // dry run, broadcast stream
   *   await adminTools.testLifecycleEmail({ dryRun: false })         // actually send
   *   await adminTools.testLifecycleEmail({ uid: '...', dryRun: false })
   */
  testLifecycleEmail: async ({ uid, stream, dryRun = true } = {}) => {
    const trigger = httpsCallable(functions, 'triggerLifecycleEmail');
    const result = await trigger({ uid, stream, dryRun });
    console.log(result.data);
    return result.data;
  },

  /**
   * Run the hourly lifecycle email sweep on demand (admin only): abandoned
   * checkout, pricing-page nudge, geo-not-used. Dry run by default.
   *
   * Usage from browser console:
   *   await adminTools.triggerLifecycleSweep()                  // dry run
   *   await adminTools.triggerLifecycleSweep({ dryRun: false }) // actually send
   */
  triggerLifecycleSweep: async ({ dryRun = true } = {}) => {
    const trigger = httpsCallable(functions, 'triggerLifecycleSweep');
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

export { firebaseConfig, app, auth, storage, db, functions };
