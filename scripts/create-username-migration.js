#!/usr/bin/env node

// Simple username migration: for each user in Firebase Auth, create socialProfile with username

const admin = require('firebase-admin');
const { readFile } = require('fs/promises');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: true, // Default to dry run for safety
  limit: 10000 // Default limit (can handle pagination)
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--execute' || arg === '-e') {
    options.dryRun = false;
  } else if (arg === '--limit' || arg === '-l') {
    const nextArg = args[i + 1];
    if (nextArg && !isNaN(parseInt(nextArg))) {
      options.limit = parseInt(nextArg);
      i++; // Skip the next argument since we consumed it
    } else {
      console.error('❌ --limit requires a numeric value');
      process.exit(1);
    }
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Usage: node create-username-migration.js [options]

Options:
  --execute, -e    Execute changes (default is dry run for safety)
  --limit, -l NUM  Maximum number of users to process (default: 10000)
  --help, -h       Show this help message

Examples:
  node create-username-migration.js --limit 5           # Preview 5 users
  node create-username-migration.js --execute --limit 50  # Migrate 50 users
  node create-username-migration.js                     # Preview up to 10000 users
    `);
    process.exit(0);
  }
}

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
  const modeText = options.dryRun ? ' (DRY RUN - no changes will be made)' : '';
  console.log(
    `🚀 Starting username migration for Firebase Auth users (limit: ${options.limit})${modeText}...`
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

    // Get users from Firebase Authentication with pagination support
    let allAuthUsers = [];
    let pageToken;
    let totalFetched = 0;

    console.log(`📊 Fetching auth users (limit: ${options.limit})...`);

    do {
      // Firebase Auth listUsers has a max of 1000 per request
      const batchSize = Math.min(1000, options.limit - totalFetched);
      const listUsersResult = await admin
        .auth()
        .listUsers(batchSize, pageToken);

      allAuthUsers.push(...listUsersResult.users);
      totalFetched += listUsersResult.users.length;
      pageToken = listUsersResult.pageToken;

      console.log(
        `📥 Fetched ${listUsersResult.users.length} users (total: ${totalFetched})`
      );

      // Stop if we've reached our limit or there are no more users
    } while (pageToken && totalFetched < options.limit);

    console.log(`📊 Processing ${allAuthUsers.length} auth users`);

    let migrated = 0;
    let skipped = 0;

    for (const authUser of allAuthUsers) {
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

          if (options.dryRun) {
            console.log(
              `[DRY RUN] Would create username "${username}" for auth user ${userId} (${authUser.email || 'no email'})`
            );
          } else {
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
          }
          migrated++;
        }
      } catch (error) {
        console.error(`❌ Error with user ${userId}:`, error.message);
      }
    }

    const dryRunSuffix = options.dryRun
      ? ' (dry run - no actual changes made)'
      : '';
    console.log(
      `\n🎉 Done! Migrated: ${migrated}, Skipped: ${skipped}${dryRunSuffix}`
    );
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
