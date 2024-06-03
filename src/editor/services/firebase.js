import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const isLocalhostAndMissingFirebaseEnv =
  window.location.hostname === 'localhost' &&
  (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_API_KEY);

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

if (isLocalhostAndMissingFirebaseEnv) {
  console.log('Using Firestore Emulator');
  connectFirestoreEmulator(db, 'localhost', 8080);
}

export { auth, storage, db };
