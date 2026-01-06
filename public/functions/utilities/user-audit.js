/**
 * User Audit Utilities
 *
 * Identifies discrepancies between Firebase Auth claims and Stripe subscriptions:
 * - Users with PRO claim but no active Stripe subscription
 * - Users with active Stripe subscription but no PRO claim
 *
 * Usage:
 *   From browser console (with admin claim):
 *     await adminTools.auditUsers()           // Full audit report
 *     await adminTools.auditUsers(true)       // Fix discrepancies (set fixDiscrepancies = true)
 *
 *   From CLI:
 *     firebase functions:call auditUserSubscriptions --data '{}'
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

// Domain-based pro users (from token-management.js pattern)
const ALLOWED_PRO_TEAM_DOMAINS = ['uoregon.edu'];

/**
 * Check if a user has domain-based pro status
 */
function isDomainBasedPro(email) {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_PRO_TEAM_DOMAINS.includes(domain);
}

/**
 * Get all users with PRO claims from Firebase Auth
 * Uses pagination to handle large user bases
 */
async function getUsersWithProClaims() {
  const proUsers = [];
  let nextPageToken;

  do {
    const listResult = await getAuth().listUsers(1000, nextPageToken);

    for (const user of listResult.users) {
      if (user.customClaims?.plan === 'PRO') {
        proUsers.push({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          claims: user.customClaims,
          isDomainPro: isDomainBasedPro(user.email)
        });
      }
    }

    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  return proUsers;
}

/**
 * Get all users from Firebase Auth (for reverse check)
 */
async function getAllUsers() {
  const allUsers = [];
  let nextPageToken;

  do {
    const listResult = await getAuth().listUsers(1000, nextPageToken);

    for (const user of listResult.users) {
      allUsers.push({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        claims: user.customClaims || {}
      });
    }

    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  return allUsers;
}

/**
 * Get all userProfiles with Stripe customer IDs
 */
async function getUserProfilesWithStripeIds() {
  const db = admin.firestore();
  const snapshot = await db.collection('userProfile').get();

  const profiles = {};
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.userId && data.stripeCustomerId) {
      profiles[data.userId] = {
        docId: doc.id,
        stripeCustomerId: data.stripeCustomerId
      };
    }
  });

  return profiles;
}

/**
 * Check if a Stripe customer has active subscriptions
 */
async function checkStripeSubscriptions(stripe, customerId) {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 10
    });

    return {
      hasActiveSubscription: subscriptions.data.length > 0,
      subscriptions: subscriptions.data.map(sub => ({
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        priceId: sub.items.data[0]?.price?.id,
        interval: sub.items.data[0]?.price?.recurring?.interval
      }))
    };
  } catch (error) {
    console.error(`Error checking subscriptions for customer ${customerId}:`, error.message);
    return {
      hasActiveSubscription: false,
      subscriptions: [],
      error: error.message
    };
  }
}

/**
 * Find all Stripe customers with active subscriptions
 */
async function getActiveStripeSubscribers(stripe) {
  const activeCustomers = new Map();
  let hasMore = true;
  let startingAfter = null;

  while (hasMore) {
    const params = {
      status: 'active',
      limit: 100,
      expand: ['data.customer']
    };

    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const subscriptions = await stripe.subscriptions.list(params);

    for (const sub of subscriptions.data) {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      if (!activeCustomers.has(customerId)) {
        activeCustomers.set(customerId, {
          customerId,
          subscriptions: []
        });
      }
      activeCustomers.get(customerId).subscriptions.push({
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        priceId: sub.items.data[0]?.price?.id
      });
    }

    hasMore = subscriptions.has_more;
    if (hasMore && subscriptions.data.length > 0) {
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    }
  }

  return activeCustomers;
}

/**
 * Main audit function - callable from Cloud Functions
 */
exports.auditUserSubscriptions = functions
  .runWith({
    secrets: ["STRIPE_SECRET_KEY"],
    timeoutSeconds: 540 // 9 minutes for large user bases
  })
  .https
  .onCall(async (data, context) => {
    // Require authentication
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }

    // Require admin claim to run audit
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const fixDiscrepancies = data?.fixDiscrepancies === true;
    const dryRun = !fixDiscrepancies;

    console.log(`Starting user audit (dryRun=${dryRun})`);

    const report = {
      timestamp: new Date().toISOString(),
      dryRun,
      summary: {
        totalProClaimUsers: 0,
        totalActiveStripeSubscribers: 0,
        proClaimNoStripe: 0,
        stripeNoPROClaim: 0,
        domainBasedPro: 0,
        validProUsers: 0
      },
      discrepancies: {
        proClaimNoStripe: [],    // Have PRO claim but no active Stripe subscription
        stripeNoPROClaim: []     // Have active Stripe subscription but no PRO claim
      },
      fixes: {
        claimsRemoved: [],
        claimsAdded: []
      }
    };

    try {
      // Step 1: Get all users with PRO claims
      console.log('Fetching users with PRO claims...');
      const proClaimUsers = await getUsersWithProClaims();
      report.summary.totalProClaimUsers = proClaimUsers.length;
      console.log(`Found ${proClaimUsers.length} users with PRO claims`);

      // Step 2: Get user profiles with Stripe IDs
      console.log('Fetching user profiles with Stripe IDs...');
      const userProfiles = await getUserProfilesWithStripeIds();
      console.log(`Found ${Object.keys(userProfiles).length} user profiles with Stripe IDs`);

      // Step 3: Get all active Stripe subscribers
      console.log('Fetching active Stripe subscribers...');
      const activeStripeCustomers = await getActiveStripeSubscribers(stripe);
      report.summary.totalActiveStripeSubscribers = activeStripeCustomers.size;
      console.log(`Found ${activeStripeCustomers.size} active Stripe subscribers`);

      // Step 4: Check PRO claim users against Stripe
      console.log('Checking PRO claim users against Stripe...');
      for (const user of proClaimUsers) {
        // Skip domain-based pro users (they're valid without Stripe)
        if (user.isDomainPro) {
          report.summary.domainBasedPro++;
          report.summary.validProUsers++;
          continue;
        }

        const profile = userProfiles[user.uid];

        if (!profile) {
          // No Stripe customer ID on file
          report.discrepancies.proClaimNoStripe.push({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            reason: 'No Stripe customer ID in userProfile'
          });
          report.summary.proClaimNoStripe++;

          if (fixDiscrepancies) {
            await getAuth().setCustomUserClaims(user.uid, { plan: '' });
            report.fixes.claimsRemoved.push({
              uid: user.uid,
              email: user.email
            });
          }
          continue;
        }

        const stripeStatus = activeStripeCustomers.get(profile.stripeCustomerId);

        if (!stripeStatus) {
          // Has customer ID but no active subscription
          report.discrepancies.proClaimNoStripe.push({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            stripeCustomerId: profile.stripeCustomerId,
            reason: 'No active Stripe subscription found'
          });
          report.summary.proClaimNoStripe++;

          if (fixDiscrepancies) {
            await getAuth().setCustomUserClaims(user.uid, { plan: '' });
            report.fixes.claimsRemoved.push({
              uid: user.uid,
              email: user.email
            });
          }
        } else {
          // Valid pro user
          report.summary.validProUsers++;
        }
      }

      // Step 5: Check for Stripe subscribers without PRO claims
      console.log('Checking for Stripe subscribers without PRO claims...');

      // Build reverse lookup: stripeCustomerId -> userId
      const stripeToUser = {};
      for (const [userId, profile] of Object.entries(userProfiles)) {
        stripeToUser[profile.stripeCustomerId] = userId;
      }

      // Get all users for claim checking
      const allUsers = await getAllUsers();
      const usersByUid = {};
      for (const user of allUsers) {
        usersByUid[user.uid] = user;
      }

      for (const [customerId, stripeData] of activeStripeCustomers) {
        const userId = stripeToUser[customerId];

        if (!userId) {
          // Active subscription but no userProfile linking to a Firebase user
          report.discrepancies.stripeNoPROClaim.push({
            stripeCustomerId: customerId,
            subscriptions: stripeData.subscriptions,
            reason: 'No userProfile found linking this Stripe customer to a Firebase user'
          });
          report.summary.stripeNoPROClaim++;
          continue;
        }

        const user = usersByUid[userId];
        if (!user) {
          // userProfile exists but Firebase user doesn't
          report.discrepancies.stripeNoPROClaim.push({
            userId,
            stripeCustomerId: customerId,
            subscriptions: stripeData.subscriptions,
            reason: 'userProfile exists but Firebase Auth user not found'
          });
          report.summary.stripeNoPROClaim++;
          continue;
        }

        if (user.claims?.plan !== 'PRO') {
          // Has active subscription but no PRO claim
          report.discrepancies.stripeNoPROClaim.push({
            uid: userId,
            email: user.email,
            displayName: user.displayName,
            stripeCustomerId: customerId,
            currentClaim: user.claims?.plan || '(none)',
            subscriptions: stripeData.subscriptions,
            reason: 'Active Stripe subscription but missing PRO claim'
          });
          report.summary.stripeNoPROClaim++;

          if (fixDiscrepancies) {
            await getAuth().setCustomUserClaims(userId, { plan: 'PRO' });
            report.fixes.claimsAdded.push({
              uid: userId,
              email: user.email
            });
          }
        }
      }

      console.log('Audit complete');
      console.log(`Summary: ${report.summary.proClaimNoStripe} PRO claims without Stripe, ${report.summary.stripeNoPROClaim} Stripe without PRO claim`);

      return report;

    } catch (error) {
      console.error('Audit failed:', error);
      throw new functions.https.HttpsError('internal', `Audit failed: ${error.message}`);
    }
  });

/**
 * HTTP version for CLI usage
 * Usage: curl -X POST https://[region]-[project].cloudfunctions.net/auditUserSubscriptionsHttp \
 *        -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
 *        -H "Content-Type: application/json" \
 *        -d '{"fixDiscrepancies": false}'
 */
exports.auditUserSubscriptionsHttp = functions
  .runWith({
    secrets: ["STRIPE_SECRET_KEY"],
    timeoutSeconds: 540
  })
  .https
  .onRequest(async (req, res) => {
    // Only allow POST
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    // Verify authorization header (use Firebase Admin SDK token or service account)
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
      // Verify the token
      const decodedToken = await getAuth().verifyIdToken(idToken);

      // Check for admin claim
      if (decodedToken.admin !== true) {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }

      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const fixDiscrepancies = req.body?.fixDiscrepancies === true;

      // Run the same audit logic (simplified for HTTP response)
      const report = await runAudit(stripe, fixDiscrepancies);

      res.json(report);

    } catch (error) {
      console.error('Auth or audit failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

/**
 * Internal audit function (shared logic)
 */
async function runAudit(stripe, fixDiscrepancies = false) {
  const dryRun = !fixDiscrepancies;

  const report = {
    timestamp: new Date().toISOString(),
    dryRun,
    summary: {
      totalProClaimUsers: 0,
      totalActiveStripeSubscribers: 0,
      proClaimNoStripe: 0,
      stripeNoPROClaim: 0,
      domainBasedPro: 0,
      validProUsers: 0
    },
    discrepancies: {
      proClaimNoStripe: [],
      stripeNoPROClaim: []
    },
    fixes: {
      claimsRemoved: [],
      claimsAdded: []
    }
  };

  // Get all users with PRO claims
  const proClaimUsers = await getUsersWithProClaims();
  report.summary.totalProClaimUsers = proClaimUsers.length;

  // Get user profiles with Stripe IDs
  const userProfiles = await getUserProfilesWithStripeIds();

  // Get all active Stripe subscribers
  const activeStripeCustomers = await getActiveStripeSubscribers(stripe);
  report.summary.totalActiveStripeSubscribers = activeStripeCustomers.size;

  // Check PRO claim users against Stripe
  for (const user of proClaimUsers) {
    if (user.isDomainPro) {
      report.summary.domainBasedPro++;
      report.summary.validProUsers++;
      continue;
    }

    const profile = userProfiles[user.uid];

    if (!profile) {
      report.discrepancies.proClaimNoStripe.push({
        uid: user.uid,
        email: user.email,
        reason: 'No Stripe customer ID'
      });
      report.summary.proClaimNoStripe++;

      if (fixDiscrepancies) {
        await getAuth().setCustomUserClaims(user.uid, { plan: '' });
        report.fixes.claimsRemoved.push({ uid: user.uid, email: user.email });
      }
      continue;
    }

    const stripeStatus = activeStripeCustomers.get(profile.stripeCustomerId);

    if (!stripeStatus) {
      report.discrepancies.proClaimNoStripe.push({
        uid: user.uid,
        email: user.email,
        stripeCustomerId: profile.stripeCustomerId,
        reason: 'No active subscription'
      });
      report.summary.proClaimNoStripe++;

      if (fixDiscrepancies) {
        await getAuth().setCustomUserClaims(user.uid, { plan: '' });
        report.fixes.claimsRemoved.push({ uid: user.uid, email: user.email });
      }
    } else {
      report.summary.validProUsers++;
    }
  }

  // Check for Stripe subscribers without PRO claims
  const stripeToUser = {};
  for (const [userId, profile] of Object.entries(userProfiles)) {
    stripeToUser[profile.stripeCustomerId] = userId;
  }

  const allUsers = await getAllUsers();
  const usersByUid = {};
  for (const user of allUsers) {
    usersByUid[user.uid] = user;
  }

  for (const [customerId, stripeData] of activeStripeCustomers) {
    const userId = stripeToUser[customerId];

    if (!userId) {
      report.discrepancies.stripeNoPROClaim.push({
        stripeCustomerId: customerId,
        reason: 'No userProfile linking to Firebase user'
      });
      report.summary.stripeNoPROClaim++;
      continue;
    }

    const user = usersByUid[userId];
    if (!user) {
      report.discrepancies.stripeNoPROClaim.push({
        userId,
        stripeCustomerId: customerId,
        reason: 'Firebase user not found'
      });
      report.summary.stripeNoPROClaim++;
      continue;
    }

    if (user.claims?.plan !== 'PRO') {
      report.discrepancies.stripeNoPROClaim.push({
        uid: userId,
        email: user.email,
        stripeCustomerId: customerId,
        reason: 'Missing PRO claim'
      });
      report.summary.stripeNoPROClaim++;

      if (fixDiscrepancies) {
        await getAuth().setCustomUserClaims(userId, { plan: 'PRO' });
        report.fixes.claimsAdded.push({ uid: userId, email: user.email });
      }
    }
  }

  return report;
}
