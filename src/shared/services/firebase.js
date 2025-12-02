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
  }
};

export { firebaseConfig, app, auth, storage, db, functions, vertexAI };
