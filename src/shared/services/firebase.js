import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getVertexAI } from 'firebase/vertexai';

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
const auth = getAuth(app);
const storage = getStorage(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const vertexAI = getVertexAI(app);

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
  }
};

export { firebaseConfig, app, auth, storage, db, functions, vertexAI };
