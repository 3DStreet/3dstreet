#!/usr/bin/env node
/**
 * Seed the local Firebase emulators with test users. Run while
 * `npm run emulators` is up:
 *
 *   npm run emulators:seed
 *
 * Only ever talks to the emulators: the emulator host variables are forced
 * below and the project is the demo- one, so it cannot touch a deployed
 * project. Safe to re-run: the users are recreated with the same ids.
 *
 * Sign in with the Google button: the emulator's popup lists these users.
 * Each also has the password `password` for scripts.
 */
const { EMULATOR_PROJECT_ID, EMULATOR_HOST, EMULATOR_PORTS } = {
  // Keep in sync with src/shared/utils/emulators.js (an ES module).
  EMULATOR_PROJECT_ID: 'demo-3dstreet',
  EMULATOR_HOST: '127.0.0.1',
  EMULATOR_PORTS: { auth: 9099, firestore: 8080 }
};

process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`;
process.env.FIRESTORE_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORTS.firestore}`;

const admin = require('firebase-admin');

admin.initializeApp({ projectId: EMULATOR_PROJECT_ID });

const PASSWORD = 'password';

// claims: what Stripe (plan) or an admin grant sets on a real account.
const USERS = [
  {
    uid: 'free-user',
    email: 'free@example.test',
    name: 'Free User',
    claims: {}
  },
  {
    uid: 'pro-user',
    email: 'pro@example.test',
    name: 'Pro User',
    claims: { plan: 'PRO' }
  },
  {
    uid: 'max-user',
    email: 'max@example.test',
    name: 'Max User',
    claims: { plan: 'MAX' }
  },
  {
    uid: 'admin-user',
    email: 'admin@example.test',
    name: 'Admin User',
    claims: { plan: 'MAX', admin: true }
  }
];

async function upsertUser({ uid, email, name, claims }) {
  const auth = admin.auth();
  // The app only offers Google/Microsoft/Apple sign-in. The Auth emulator
  // fakes those popups and lists the accounts linked to that provider, so
  // each user gets a google.com identity: "Sign in with Google" → pick it.
  // Recreated each run (importUsers can't update), which also resets claims.
  await auth.deleteUser(uid).catch((error) => {
    if (error.code !== 'auth/user-not-found') throw error;
  });
  const result = await auth.importUsers([
    {
      uid,
      email,
      displayName: name,
      emailVerified: true,
      customClaims: claims,
      providerData: [
        {
          providerId: 'google.com',
          uid: `google-${uid}`,
          email,
          displayName: name
        }
      ]
    }
  ]);
  if (result.failureCount) throw result.errors[0].error;
  // Email/password too, for scripts and tests that sign in directly.
  await auth.updateUser(uid, { password: PASSWORD });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin
    .firestore()
    .doc(`socialProfile/${uid}`)
    .set(
      {
        userId: uid,
        username: uid.replace('-', '_'),
        displayName: name,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );
}

async function main() {
  for (const user of USERS) {
    await upsertUser(user);
    console.log(`  ${user.email.padEnd(22)} ${JSON.stringify(user.claims)}`);
  }
  console.log(
    `\nSeeded ${USERS.length} users in ${EMULATOR_PROJECT_ID}; password: ${PASSWORD}`
  );
}

main().catch((error) => {
  console.error(
    'Seeding failed (are the emulators running? npm run emulators):',
    error.message
  );
  process.exit(1);
});
