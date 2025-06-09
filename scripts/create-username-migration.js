#!/usr/bin/env node

// Simple username migration: for each user in Firebase Auth, create socialProfile with username
// Limited to 10 users for testing

const admin = require('firebase-admin');
const { readFile } = require('fs/promises');

// Import the shared username generator (no Firebase dependencies)
const {
  generateUsername
} = require('../src/editor/utils/username-generator.js');

const checkUsernameAvailability = async (username, db) => {
  const query = await db
    .collection('socialProfile')
    .where('username', '==', username.toLowerCase())
    .limit(1)
    .get();
  return query.empty;
};

const generateUniqueUsername = async (db) => {
  let username;
  let isAvailable = false;
  let attempts = 0;

  while (!isAvailable && attempts < 10) {
    username = generateUsername(); // Use the shared function
    isAvailable = await checkUsernameAvailability(username, db);
    attempts++;
  }

  if (!isAvailable) {
    throw new Error('Failed to generate unique username');
  }

  return username;
};

async function migrateUsernames() {
  console.log(
    '🚀 Starting username migration for Firebase Auth users (limited to 10)...'
  );

  try {
    // Initialize Firebase Admin
    const serviceAccount = JSON.parse(
      await readFile('./firebase-service-account.json', 'utf8')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin initialized');

    const db = admin.firestore();

    // Get users from Firebase Authentication (limited to 10)
    const listUsersResult = await admin.auth().listUsers(10); // maxResults = 10
    const authUsers = listUsersResult.users;

    console.log(`📊 Found ${authUsers.length} auth users (limited to 10)`);

    let migrated = 0;
    let skipped = 0;

    for (const authUser of authUsers) {
      const userId = authUser.uid;

      try {
        // Check if socialProfile already exists
        const socialProfileDoc = await db
          .collection('socialProfile')
          .doc(userId)
          .get();

        if (socialProfileDoc.exists && socialProfileDoc.data().username) {
          console.log(
            `⏭️  User ${userId} already has username: ${socialProfileDoc.data().username}`
          );
          skipped++;
        } else {
          // Generate unique username using shared function
          const username = await generateUniqueUsername(db);

          // Create/update socialProfile
          await db.collection('socialProfile').doc(userId).set(
            {
              userId,
              username: username.toLowerCase(),
              usernameUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              isUsernameCustomized: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          console.log(
            `✅ Created username "${username}" for auth user ${userId} (${authUser.email || 'no email'})`
          );
          migrated++;
        }
      } catch (error) {
        console.error(`❌ Error with user ${userId}:`, error.message);
      }
    }

    console.log(`\n🎉 Done! Migrated: ${migrated}, Skipped: ${skipped}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ Failed to find firebase-service-account.json');
      console.error(
        'Download it from: Firebase Console > Project Settings > Service Accounts > Generate new private key'
      );
    } else {
      console.error('💥 Migration failed:', error);
    }
  }
}

migrateUsernames();
