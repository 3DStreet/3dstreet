/**
 * User Audit Utilities
 *
 * Identifies discrepancies between Firebase Auth claims and Stripe subscriptions:
 * - Users with a paid claim (PRO or MAX) but no active Stripe subscription
 * - Users with active Stripe subscription but no paid claim (tier resolved from price)
 * - Users whose paid claim tier disagrees with their subscription's tier
 *   (PRO claim on a MAX subscription → upgrade; MAX claim on a PRO subscription → downgrade)
 *
 * MAX-aware: PRO and MAX are both valid paid claims; fix-mode resolves the correct
 * tier from the subscription's price ID and never downgrades a MAX subscriber to PRO
 * — provided the STRIPE_MAX_*_PRICE_ID secrets are configured. If they are not, every
 * subscription resolves to PRO (see warnIfMaxSecretsMissing); the audit warns loudly
 * so a stale/missing secret doesn't silently downgrade MAX subscribers.
 *
 * ⚠️ FIX-MODE CAVEAT: this only knows about active *subscriptions*. It does NOT
 * account for invoice-based customers or
 * intentional manual comps. Running with fixDiscrepancies=true WILL strip their
 * claims.
 *
 * Usage:
 *   From browser console (with admin claim):
 *     await adminTools.auditUsers()           // Full audit report
 *     await adminTools.auditUsers(true)       // Fix discrepancies (set fixDiscrepancies = true)
 *
 *   From CLI:
 *     firebase functions:call auditUserSubscriptions --data '{}'
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('../app-check.js');

/**
 * Check if a user has domain-based pro status.
 * Reads allowed domains from the ALLOWED_PRO_TEAM_DOMAINS secret (JSON array).
 * Functions calling this must register the secret via runWith().
 */
function isDomainBasedPro(email) {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  const allowedDomainsSecret = process.env.ALLOWED_PRO_TEAM_DOMAINS;
  if (!allowedDomainsSecret) return false;

  try {
    const domains = JSON.parse(allowedDomainsSecret);
    if (!Array.isArray(domains)) return false;
    return domains.includes(domain);
  } catch (parseError) {
    console.error('[user-audit] Error parsing ALLOWED_PRO_TEAM_DOMAINS secret:', parseError);
    return false;
  }
}

// Mirror of isPaidPlanClaim in token-management.js — MAX is a superset of PRO,
// so both are valid paid claims and neither should be treated as a discrepancy.
const isPaidPlanClaim = (plan) => plan === 'PRO' || plan === 'MAX';

// The MAX-tier Stripe price IDs that actually resolve from the configured
// secrets. Empty when the STRIPE_MAX_*_PRICE_ID secrets are unset.
// Keep in sync with PRICE_CONFIG in index.js.
function getMaxPriceIds() {
  return [
    process.env.STRIPE_MAX_YEARLY_PRICE_ID,
    process.env.STRIPE_MAX_MONTHLY_PRICE_ID
  ].filter(Boolean);
}

// Resolve the tier (PRO/MAX) a set of Stripe price IDs corresponds to, by matching
// the configured MAX price-ID secrets. Defaults to PRO when no MAX price matches.
function resolveTierFromPriceIds(priceIds = []) {
  const maxPriceIds = getMaxPriceIds();
  return priceIds.some((id) => maxPriceIds.includes(id)) ? 'MAX' : 'PRO';
}

// Warn loudly (once per run) if no MAX price IDs resolve from the configured
// secrets. Without them resolveTierFromPriceIds() defaults every subscription to
// PRO, so fix-mode would silently downgrade real MAX subscribers — exactly the
// case this audit is meant to protect against. Mirrors the "no plan matched"
// warning pattern in index.js's Stripe webhook handler.
function warnIfMaxSecretsMissing() {
  if (getMaxPriceIds().length === 0) {
    console.warn(
      '[user-audit] No MAX price IDs resolved from STRIPE_MAX_YEARLY_PRICE_ID / ' +
      'STRIPE_MAX_MONTHLY_PRICE_ID — every active subscription will resolve to PRO. ' +
      'If MAX is being sold, this is a stale/missing secret and fix-mode would ' +
      'downgrade MAX subscribers to PRO.'
    );
  }
}

/**
 * Get all users with a paid plan claim (PRO or MAX) from Firebase Auth
 * Uses pagination to handle large user bases
 */
async function getUsersWithProClaims() {
  const proUsers = [];
  let nextPageToken;

  do {
    const listResult = await getAuth().listUsers(1000, nextPageToken);

    for (const user of listResult.users) {
      if (isPaidPlanClaim(user.customClaims?.plan)) {
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
// eslint-disable-next-line no-unused-vars -- retained audit helper for manual subscription reconciliation; not currently wired in
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
        currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
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
        currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
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
    secrets: ['STRIPE_SECRET_KEY', 'ALLOWED_PRO_TEAM_DOMAINS', 'STRIPE_YEARLY_PRICE_ID', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_MAX_YEARLY_PRICE_ID', 'STRIPE_MAX_MONTHLY_PRICE_ID'],
    timeoutSeconds: 540 // 9 minutes for large user bases
  })
  .https
  .onCall(async (data, context) => {
    // Defense-in-depth: also gate on App Check (admin claim required below).
    // No-op until APP_CHECK_ENFORCE is enabled (see app-check.js).
    assertAppCheck(context);
    // Require authentication
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }

    // Require admin claim to run audit
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
    const fixDiscrepancies = data?.fixDiscrepancies === true;
    const dryRun = !fixDiscrepancies;

    console.log(`Starting user audit (dryRun=${dryRun})`);
    if (fixDiscrepancies) {
      console.warn('[user-audit] FIX MODE ENABLED — will strip claims from users with no active subscription, including manual comps');
    }
    warnIfMaxSecretsMissing();

    const report = {
      timestamp: new Date().toISOString(),
      dryRun,
      summary: {
        totalProClaimUsers: 0,
        totalActiveStripeSubscribers: 0,
        proClaimNoStripe: 0,
        stripeNoPROClaim: 0,
        claimTierMismatch: 0,
        domainBasedPro: 0,
        validProUsers: 0
      },
      discrepancies: {
        proClaimNoStripe: [],    // Have PRO claim but no active Stripe subscription
        stripeNoPROClaim: [],    // Have active Stripe subscription but no PRO claim
        claimTierMismatch: []    // Paid claim whose tier disagrees with the subscription
      },
      fixes: {
        claimsRemoved: [],
        claimsAdded: [],
        claimsUpdated: []
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
          // Has an active subscription — verify the claimed tier matches the
          // subscription's tier. A PRO claim on a MAX subscription is an
          // under-provisioned user (should upgrade); a MAX claim on a PRO
          // subscription is over-provisioned (should downgrade).
          const resolvedTier = resolveTierFromPriceIds(stripeStatus.subscriptions.map((s) => s.priceId));
          const claimedTier = user.claims?.plan;

          if (claimedTier !== resolvedTier) {
            report.discrepancies.claimTierMismatch.push({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              stripeCustomerId: profile.stripeCustomerId,
              currentClaim: claimedTier,
              resolvedTier,
              subscriptions: stripeStatus.subscriptions,
              reason: `Claim is ${claimedTier} but active subscription resolves to ${resolvedTier}`
            });
            report.summary.claimTierMismatch++;

            if (fixDiscrepancies) {
              await getAuth().setCustomUserClaims(user.uid, { plan: resolvedTier });
              report.fixes.claimsUpdated.push({
                uid: user.uid,
                email: user.email,
                from: claimedTier,
                to: resolvedTier
              });
            }
          } else {
            // Valid pro user, correct tier
            report.summary.validProUsers++;
          }
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

        if (!isPaidPlanClaim(user.claims?.plan)) {
          // Has active subscription but no paid (PRO/MAX) claim
          const tier = resolveTierFromPriceIds(stripeData.subscriptions.map((s) => s.priceId));
          report.discrepancies.stripeNoPROClaim.push({
            uid: userId,
            email: user.email,
            displayName: user.displayName,
            stripeCustomerId: customerId,
            currentClaim: user.claims?.plan || '(none)',
            resolvedTier: tier,
            subscriptions: stripeData.subscriptions,
            reason: `Active Stripe subscription but missing ${tier} claim`
          });
          report.summary.stripeNoPROClaim++;

          if (fixDiscrepancies) {
            await getAuth().setCustomUserClaims(userId, { plan: tier });
            report.fixes.claimsAdded.push({
              uid: userId,
              email: user.email,
              plan: tier
            });
          }
        }
      }

      console.log('Audit complete');
      console.log(`Summary: ${report.summary.proClaimNoStripe} PRO claims without Stripe, ${report.summary.stripeNoPROClaim} Stripe without PRO claim, ${report.summary.claimTierMismatch} tier mismatches`);

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
    secrets: ['STRIPE_SECRET_KEY', 'ALLOWED_PRO_TEAM_DOMAINS', 'STRIPE_YEARLY_PRICE_ID', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_MAX_YEARLY_PRICE_ID', 'STRIPE_MAX_MONTHLY_PRICE_ID'],
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

      const Stripe = require('stripe');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
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

  if (fixDiscrepancies) {
    console.warn('[user-audit] FIX MODE ENABLED — will strip claims from users with no active subscription, including manual comps');
  }
  warnIfMaxSecretsMissing();

  const report = {
    timestamp: new Date().toISOString(),
    dryRun,
    summary: {
      totalProClaimUsers: 0,
      totalActiveStripeSubscribers: 0,
      proClaimNoStripe: 0,
      stripeNoPROClaim: 0,
      claimTierMismatch: 0,
      domainBasedPro: 0,
      validProUsers: 0
    },
    discrepancies: {
      proClaimNoStripe: [],
      stripeNoPROClaim: [],
      claimTierMismatch: []
    },
    fixes: {
      claimsRemoved: [],
      claimsAdded: [],
      claimsUpdated: []
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
      // Active subscription — check the claimed tier matches the subscription tier.
      const resolvedTier = resolveTierFromPriceIds(stripeStatus.subscriptions.map((s) => s.priceId));
      const claimedTier = user.claims?.plan;

      if (claimedTier !== resolvedTier) {
        report.discrepancies.claimTierMismatch.push({
          uid: user.uid,
          email: user.email,
          stripeCustomerId: profile.stripeCustomerId,
          currentClaim: claimedTier,
          resolvedTier,
          reason: `Claim is ${claimedTier} but active subscription resolves to ${resolvedTier}`
        });
        report.summary.claimTierMismatch++;

        if (fixDiscrepancies) {
          await getAuth().setCustomUserClaims(user.uid, { plan: resolvedTier });
          report.fixes.claimsUpdated.push({ uid: user.uid, email: user.email, from: claimedTier, to: resolvedTier });
        }
      } else {
        report.summary.validProUsers++;
      }
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

    if (!isPaidPlanClaim(user.claims?.plan)) {
      const tier = resolveTierFromPriceIds(stripeData.subscriptions.map((s) => s.priceId));
      report.discrepancies.stripeNoPROClaim.push({
        uid: userId,
        email: user.email,
        stripeCustomerId: customerId,
        resolvedTier: tier,
        reason: `Missing ${tier} claim`
      });
      report.summary.stripeNoPROClaim++;

      if (fixDiscrepancies) {
        await getAuth().setCustomUserClaims(userId, { plan: tier });
        report.fixes.claimsAdded.push({ uid: userId, email: user.email, plan: tier });
      }
    }
  }

  return report;
}
