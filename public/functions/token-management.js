const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('./app-check.js');
const { computeMonthlyRefill } = require('./token-packs.js');
const {
  isPaidPlanClaim,
  toMillis,
  isProUntilActive,
  hasProEntitlement,
  planProPassGrant
} = require('./pro-pass.js');

const PRO_MONTHLY_ALLOWANCE = 100;
const MAX_MONTHLY_ALLOWANCE = 500;

// isPaidPlanClaim (pro-pass.js): MAX is a superset of PRO — it unlocks every
// Pro feature, plus higher storage and a larger monthly token allowance.
// Anywhere we used to check `plan === 'PRO'`, accept either paid tier.
//
// Pro *entitlement* is wider than the plan claim: a one-time pass (#1922)
// grants Pro until tokenProfile.proUntil. Feature gates use
// hasProEntitlement (via checkUserProStatus / isUserProInternal); the monthly
// token refill deliberately does NOT — pass holders got their tokens up front.

// Read the pass expiry for a user (tokenProfile/{uid}.proUntil) as epoch ms,
// or null. A read failure resolves to null (fail closed for the pass only —
// subscription and team-domain Pro don't depend on this read).
const readProUntil = async (userId) => {
  try {
    const doc = await admin.firestore().collection('tokenProfile').doc(userId).get();
    return doc.exists ? toMillis(doc.data().proUntil) : null;
  } catch (error) {
    console.error(`Error reading proUntil for ${userId}:`, error);
    return null;
  }
};

// Monthly token top-up by plan. Only MAX bumps above the Pro baseline, so
// domain-based team Pro (no plan claim) correctly resolves to PRO_MONTHLY_ALLOWANCE.
const monthlyAllowanceForPlan = (plan) =>
  plan === 'MAX' ? MAX_MONTHLY_ALLOWANCE : PRO_MONTHLY_ALLOWANCE;

// Centralized domain validation function using stored secrets
const validateUserDomain = async (userEmail) => {
  if (!userEmail) {
    return { isProDomain: false };
  }

  try {
    // Extract domain from email address
    const userDomain = userEmail.split('@')[1];
    if (!userDomain) {
      console.warn(`Invalid email format: ${userEmail}`);
      return { isProDomain: false };
    }

    // Get allowed domains from Firebase secret
    const allowedDomainsSecret = process.env.ALLOWED_PRO_TEAM_DOMAINS;
    if (!allowedDomainsSecret) {
      console.warn('ALLOWED_PRO_TEAM_DOMAINS secret not configured; denying domain-based pro access');
      return { isProDomain: false };
    }

    // Parse the JSON array of allowed domains with proper error handling
    let allowedDomains;
    try {
      allowedDomains = JSON.parse(allowedDomainsSecret);
      if (!Array.isArray(allowedDomains)) {
        throw new Error('ALLOWED_PRO_TEAM_DOMAINS must be a JSON array');
      }
    } catch (parseError) {
      console.error('Error parsing ALLOWED_PRO_TEAM_DOMAINS secret:', parseError);
      return { isProDomain: false };
    }

    const teamDomain = allowedDomains.find(domain => domain === userDomain);
    
    if (teamDomain) {
      console.log(`User ${userEmail} has pro access via domain: ${teamDomain}`);
      return { isProDomain: true, teamDomain };
    }

    return { isProDomain: false };
  } catch (error) {
    console.error('Error validating user domain:', error);
    // Fail safely - don't grant pro access on error
    return { isProDomain: false };
  }
};

// Cloud Function to check and refill image tokens for Pro users
const checkAndRefillImageTokens = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const db = admin.firestore();
    
    try {
      // Check if user is Pro (or MAX, a superset of Pro)
      const userRecord = await getAuth().getUser(userId);
      const plan = userRecord.customClaims && userRecord.customClaims.plan;
      const isPro = isPaidPlanClaim(plan);

      // Use centralized domain validation
      const { isProDomain } = await validateUserDomain(userRecord.email);

      // Subscription + team only: a one-time pass (proUntil) gets no monthly
      // top-up — its token lump sum replaces the drip (#1922).
      const isProUser = isPro || isProDomain;
      const monthlyAllowance = monthlyAllowanceForPlan(plan);

      // Get current token profile
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tokenProfileRef.get();

      if (!tokenDoc.exists) {
        // Create initial token profile
        // Free users get 5 tokens to allow at least one 4x render attempt
        const initialTokens = isProUser ? monthlyAllowance : 5;
        const newProfile = {
          userId: userId,
          geoToken: 3,
          genToken: initialTokens,
          lastMonthlyRefill: isProUser ? `${new Date().getFullYear()}-${new Date().getMonth()}` : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await tokenProfileRef.set(newProfile);
        console.log(`Created new token profile for user ${userId} with ${initialTokens} image tokens`);
        
        return {
          success: true,
          tokenProfile: newProfile,
          refilled: false,
          message: 'Token profile created'
        };
      }
      
      const tokenData = tokenDoc.data();
      
      // Migration: Add genToken for existing users who only have geoToken
      if (tokenData.geoToken !== undefined && tokenData.genToken === undefined) {
        // Give existing users their initial genToken allocation
        // Free users get 5 tokens to allow at least one 4x render attempt
        const initialGenTokens = isProUser ? monthlyAllowance : 5;
        
        await tokenProfileRef.update({
          genToken: initialGenTokens,
          lastMonthlyRefill: isProUser ? `${new Date().getFullYear()}-${new Date().getMonth()}` : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        tokenData.genToken = initialGenTokens;
        console.log(`Migrated user ${userId}: Added ${initialGenTokens} genTokens (Pro: ${isProUser})`);
      }
      
      // If not a Pro user, just return current tokens
      if (!isProUser) {
        return {
          success: true,
          tokenProfile: tokenData,
          refilled: false,
          message: 'Not a Pro user'
        };
      }
      
      // Check if Pro user needs monthly refill
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
      const needsRefill = !tokenData.lastMonthlyRefill || tokenData.lastMonthlyRefill !== currentMonthKey;
      
      if (needsRefill) {
        // Top up to monthly allowance (don't reset if they have more from
        // purchased token packs — see computeMonthlyRefill in token-packs.js)
        const tokensBefore = tokenData.genToken || 0;
        const newImageTokens = computeMonthlyRefill(tokensBefore, monthlyAllowance);

        await tokenProfileRef.update({
          genToken: newImageTokens,
          lastMonthlyRefill: currentMonthKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Fire-and-forget: write token refill audit log
        db.collection('tokenLog').add({
          userId,
          type: 'refill',
          tokensBefore,
          tokensAfter: newImageTokens,
          tokenCost: null,
          source: 'monthly-refill',
          relatedModel: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.error('Failed to write tokenLog:', err));

        console.log(`Refilled Pro tokens for user ${userId}: ${tokensBefore} -> ${newImageTokens}`);

        return {
          success: true,
          tokenProfile: {
            ...tokenData,
            genToken: newImageTokens,
            lastMonthlyRefill: currentMonthKey
          },
          refilled: true,
          message: `Tokens refilled to ${newImageTokens} for this month`
        };
      }
      
      return {
        success: true,
        tokenProfile: tokenData,
        refilled: false,
        message: 'Tokens already refilled this month'
      };
      
    } catch (error) {
      console.error('Error in checkAndRefillImageTokens:', error);
      throw new functions.https.HttpsError('internal', `Failed to check/refill tokens: ${error.message}`);
    }
  });

// Internal function that can be called from other cloud functions
const checkAndRefillImageTokensInternal = async (userId) => {
  const db = admin.firestore();
  
  try {
    // Check if user is Pro (or MAX, a superset of Pro)
    const userRecord = await getAuth().getUser(userId);
    const plan = userRecord.customClaims && userRecord.customClaims.plan;
    const isPro = isPaidPlanClaim(plan);

    // Use centralized domain validation
    const { isProDomain } = await validateUserDomain(userRecord.email);

    // Subscription + team only — no monthly top-up for pass holders (#1922).
    const isProUser = isPro || isProDomain;
    const monthlyAllowance = monthlyAllowanceForPlan(plan);

    // Get current token profile
    const tokenProfileRef = db.collection('tokenProfile').doc(userId);
    const tokenDoc = await tokenProfileRef.get();

    if (!tokenDoc.exists) {
      // Create initial token profile based on user type
      const newProfile = {
        userId: userId,
        geoToken: 3,
        genToken: isProUser ? monthlyAllowance : 3, // Paid users get their monthly allowance, free users get 3
        lastMonthlyRefill: isProUser ? `${new Date().getFullYear()}-${new Date().getMonth()}` : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await tokenProfileRef.set(newProfile);
      return newProfile;
    }
    
    const tokenData = tokenDoc.data();
    
    // Migration: Add genToken for existing users who only have geoToken
    if (tokenData.geoToken !== undefined && tokenData.genToken === undefined) {
      // Give existing users their initial genToken allocation
      const initialGenTokens = isProUser ? monthlyAllowance : 3;
      
      await tokenProfileRef.update({
        genToken: initialGenTokens,
        lastMonthlyRefill: isProUser ? `${new Date().getFullYear()}-${new Date().getMonth()}` : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      tokenData.genToken = initialGenTokens;
      console.log(`Migrated user ${userId}: Added ${initialGenTokens} genTokens (Pro: ${isProUser})`);
    }
    
    // Only refill for pro users
    if (!isProUser) {
      return tokenData; // Return existing data for free users
    }
    
    // Check if needs monthly refill
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const needsRefill = !tokenData.lastMonthlyRefill || tokenData.lastMonthlyRefill !== currentMonthKey;
    
    if (needsRefill) {
      const internalTokensBefore = tokenData.genToken || 0;
      const newImageTokens = computeMonthlyRefill(
        internalTokensBefore,
        monthlyAllowance
      );

      await tokenProfileRef.update({
        genToken: newImageTokens,
        lastMonthlyRefill: currentMonthKey,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Fire-and-forget: write token refill audit log
      db.collection('tokenLog').add({
        userId,
        type: 'refill',
        tokensBefore: internalTokensBefore,
        tokensAfter: newImageTokens,
        tokenCost: null,
        source: 'monthly-refill',
        relatedModel: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write tokenLog:', err));

      return {
        ...tokenData,
        genToken: newImageTokens,
        lastMonthlyRefill: currentMonthKey
      };
    }
    
    return tokenData;
    
  } catch (error) {
    console.error('Error in checkAndRefillImageTokensInternal:', error);
    console.error('Error stack:', error.stack);
    // Instead of returning null, throw the error to be handled by the calling function
    throw error;
  }
};

// Cloud Function to check if user is Pro (subscription + domain validation)
const checkUserProStatus = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    
    try {
      // Check if user is Pro via subscription (MAX is a superset of Pro)
      const userRecord = await getAuth().getUser(userId);
      const plan = (userRecord.customClaims && userRecord.customClaims.plan) || null;
      const isPro = isPaidPlanClaim(plan);

      // Check domain validation
      const { isProDomain, teamDomain } = await validateUserDomain(userRecord.email);

      // One-time pass (#1922). Always read, even for subscribers, so the
      // client can show "Pro until <date>" to someone who holds both.
      const proUntilMs = await readProUntil(userId);
      const isProPass = isProUntilActive(proUntilMs);

      const isProUser = hasProEntitlement({ plan, isProDomain, proUntil: proUntilMs });

      return {
        isPro: isProUser,
        isProSubscription: isPro,
        isProDomain: isProDomain,
        teamDomain: teamDomain || null,
        // Actual paid tier ('PRO' | 'MAX' | null). Lets the client distinguish
        // Max from Pro for badge/profile labels; domain-team users have no plan
        // claim so this is null for them (they render as the team label).
        // Pass holders also have no plan claim — see isProPass.
        plan,
        // Unexpired one-time pass, and its expiry (ISO string; null when the
        // user never bought one). proUntil is returned even once expired so
        // support/UI can say "your pass ended on …".
        isProPass,
        proUntil: proUntilMs !== null ? new Date(proUntilMs).toISOString() : null,
        email: userRecord.email
      };
      
    } catch (error) {
      console.error('Error checking user pro status:', error);
      throw new functions.https.HttpsError('internal', `Failed to check pro status: ${error.message}`);
    }
  });

// Charge-at-submit for async generation jobs, shared by every submit path
// (image/video/splat in replicate.js, fal image in fal-proxy.js, fal mesh in
// fal-3d.js). One transaction: read the token profile, reject on missing
// profile / insufficient balance (the HttpsError codes clients already map),
// decrement, and flip the job's `tokenCharged` in the same commit — so every
// later refund path (webhook, poll, reconciler) observes tokenCharged:true
// and refunds exactly once. Also writes the fire-and-forget tokenLog
// 'deduction' ledger entry the refund side balances against.
// Returns { tokensBefore, remainingTokens }.
const chargeGenerationTokens = async (db, { userId, jobRef, tokenCost, source, relatedModel }) => {
  const tokenProfileRef = db.collection('tokenProfile').doc(userId);
  let remainingTokens = 0;
  let tokensBefore = 0;
  await db.runTransaction(async (transaction) => {
    const tokenDoc = await transaction.get(tokenProfileRef);
    if (!tokenDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Token profile not found');
    }
    const currentTokens = tokenDoc.data().genToken || 0;
    tokensBefore = currentTokens;
    if (currentTokens < tokenCost) {
      throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
    }
    remainingTokens = Math.max(0, currentTokens - tokenCost);
    transaction.update(tokenProfileRef, {
      genToken: remainingTokens,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.update(jobRef, { tokenCharged: true });
  });

  // Fire-and-forget: write token deduction audit log
  db.collection('tokenLog').add({
    userId,
    type: 'deduction',
    tokensBefore,
    tokensAfter: remainingTokens,
    tokenCost,
    source,
    relatedModel,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch(err => console.error('Failed to write tokenLog:', err));

  return { tokensBefore, remainingTokens };
};

// One-time gen-token pack purchase (#1374): credit the purchased tokens and
// write the `tokenLog` purchase row for the audit trail / margin analysis.
// Called by the Stripe checkout webhook (stripe.js) with EVERY pack line item
// on the session — a session with multiple pack line items grants their sum,
// never just the first match. The log doc id is keyed on the Stripe session
// so webhook retries can't double-grant: the transaction re-reads it and
// no-ops when the row already exists. Never touches plan claims — packs are
// a top-up, not a subscription change.
// Returns true when the grant is durably recorded (including the
// already-granted retry case); false when it could not be applied — the
// webhook maps false to a non-2xx so Stripe retries instead of dropping a
// paid-for grant on the floor.
const grantPurchasedTokens = async ({ checkoutSession, items }) => {
  const userId = checkoutSession.metadata?.userId;
  if (!userId) {
    console.error(`token pack purchase without metadata.userId: session=${checkoutSession.id}`);
    return false;
  }
  if (!Array.isArray(items) || items.length === 0) {
    console.error(`token pack purchase with no pack items: session=${checkoutSession.id}`);
    return false;
  }

  const tokensPurchased = items.reduce(
    (sum, { pack, quantity }) => sum + pack.tokens * quantity,
    0
  );
  const db = admin.firestore();
  const tokenProfileRef = db.collection('tokenProfile').doc(userId);
  const logRef = db.collection('tokenLog').doc(`purchase-${checkoutSession.id}`);

  await db.runTransaction(async (transaction) => {
    const [logDoc, tokenDoc] = await Promise.all([
      transaction.get(logRef),
      transaction.get(tokenProfileRef)
    ]);
    if (logDoc.exists) {
      console.log(`token pack already granted (webhook retry): session=${checkoutSession.id}`);
      return;
    }

    const tokensBefore = tokenDoc.exists ? tokenDoc.data().genToken || 0 : 0;
    const tokensAfter = tokensBefore + tokensPurchased;

    if (tokenDoc.exists) {
      transaction.update(tokenProfileRef, {
        genToken: tokensAfter,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // A paid subscriber should always have a profile by now, but if not,
      // create one rather than dropping tokens the user just paid for.
      transaction.set(tokenProfileRef, {
        userId,
        geoToken: 3,
        genToken: tokensAfter,
        lastMonthlyRefill: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    transaction.set(logRef, {
      userId,
      type: 'purchase',
      tokensBefore,
      tokensAfter,
      tokenCost: null,
      source: `token-pack-${items.map(({ pack }) => pack.id).join('+')}`,
      relatedModel: null,
      // Purchase-specific audit fields (margin analysis):
      packs: items.map(({ pack, quantity }) => ({
        packId: pack.id,
        packTokens: pack.tokens,
        quantity
      })),
      tokensPurchased,
      amountTotal: checkoutSession.amount_total ?? null, // smallest currency unit (e.g. cents)
      currency: checkoutSession.currency ?? null,
      stripeSessionId: checkoutSession.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  console.log(
    `token pack granted: user=${userId} tokens=${tokensPurchased} ` +
    `packs=${items.map(({ pack, quantity }) => `${pack.id}x${quantity}`).join(',')} ` +
    `session=${checkoutSession.id}`
  );
  return true;
};

// Pass fulfilment (#1922) — the ONE server-side entry point for granting
// time-boxed Pro, whatever paid for it. Credits `tokens` and extends
// tokenProfile.proUntil = max(now, proUntil) + days, in a single transaction
// with a tokenLog audit row whose doc id is derived from `idempotencyKey`
// (`pass-<idempotencyKey>`). A repeat call with the same key re-reads that
// row and no-ops, so retries can never double-grant (600 tokens / 180 days
// for one payment). Callers:
//   - Stripe checkout (stripe.js → grantProPassForCheckout): key = checkout
//     session id
//   - (future) pass-code redemption: key = the redemption id
// Never touches plan claims, so an active subscriber who gets a pass keeps
// their plan; deleting the subscription later clears only `plan` and leaves
// proUntil standing.
//
// `idempotencyKey` must be unique per grant and a valid Firestore doc-id
// fragment (no '/'). `source` labels the grant in tokenLog (e.g.
// 'pro-pass-project', 'pass-code'). `details` is merged into the audit row
// (purchase/redemption specifics: amounts, session ids, pass breakdown).
// `sessionId` (optional) is appended to tokenProfile.proPassSessionIds for
// support lookups.
// Returns { granted: true, alreadyGranted, proUntilMs } when durably
// recorded, or { granted: false, reason } when the input is unusable — the
// webhook maps that to non-2xx so Stripe retries.
const grantPass = async (
  userId,
  { days, tokens = 0, idempotencyKey, source, details = {}, sessionId = null } = {}
) => {
  if (!userId) return { granted: false, reason: 'missing-user' };
  if (!idempotencyKey || String(idempotencyKey).includes('/')) {
    return { granted: false, reason: 'invalid-idempotency-key' };
  }
  if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(tokens) || tokens < 0) {
    return { granted: false, reason: 'invalid-grant' };
  }

  const db = admin.firestore();
  const tokenProfileRef = db.collection('tokenProfile').doc(userId);
  const logRef = db.collection('tokenLog').doc(`pass-${idempotencyKey}`);
  let result = null;

  await db.runTransaction(async (transaction) => {
    // Transaction bodies can re-run on contention; reset per attempt.
    result = null;
    const [logDoc, tokenDoc] = await Promise.all([
      transaction.get(logRef),
      transaction.get(tokenProfileRef)
    ]);
    const plan = planProPassGrant({
      alreadyGranted: logDoc.exists,
      tokenProfile: tokenDoc.exists ? tokenDoc.data() : null,
      summary: { days, tokens },
      nowMs: Date.now()
    });
    if (!plan) {
      result = { alreadyGranted: true, proUntilMs: toMillis(logDoc.data().proUntilAfter) };
      return;
    }

    const { tokensBefore, tokensAfter, proUntilBeforeMs, proUntilAfterMs } = plan;
    const proUntilAfter = admin.firestore.Timestamp.fromMillis(proUntilAfterMs);

    // Support-visible pass state lives right on tokenProfile: proUntil plus
    // the session ids that paid for it (tokenLog has the full audit rows).
    const passFields = {
      genToken: tokensAfter,
      proUntil: proUntilAfter,
      proPassLastGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (sessionId) {
      passFields.proPassSessionIds = admin.firestore.FieldValue.arrayUnion(sessionId);
    }

    if (tokenDoc.exists) {
      transaction.update(tokenProfileRef, passFields);
    } else {
      transaction.set(tokenProfileRef, {
        userId,
        geoToken: 3,
        lastMonthlyRefill: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...passFields
      });
    }

    transaction.set(logRef, {
      ...details,
      userId,
      type: 'purchase',
      tokensBefore,
      tokensAfter,
      tokenCost: null,
      source: source || 'pro-pass',
      relatedModel: null,
      tokensPurchased: tokens,
      daysPurchased: days,
      proUntilBefore: proUntilBeforeMs !== null
        ? admin.firestore.Timestamp.fromMillis(proUntilBeforeMs)
        : null,
      proUntilAfter,
      idempotencyKey: String(idempotencyKey),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    result = { alreadyGranted: false, proUntilMs: proUntilAfterMs };
  });

  if (result.alreadyGranted) {
    console.log(`pass already granted (retry): user=${userId} key=${idempotencyKey}`);
  } else {
    console.log(
      `pass granted: user=${userId} tokens=${tokens} days=${days} source=${source} ` +
      `proUntil=${new Date(result.proUntilMs).toISOString()} key=${idempotencyKey}`
    );
  }
  return { granted: true, ...result };
};

// Stripe checkout adapter over grantPass: idempotency key = checkout session
// id; `summary` is summarizePassItems() output. Returns true when durably
// recorded (including the already-granted retry), false otherwise.
const grantProPassForCheckout = async ({ checkoutSession, summary }) => {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) {
    console.error(`pro pass purchase with no pass items: session=${checkoutSession.id}`);
    return false;
  }
  const userId = checkoutSession.metadata?.userId;
  const outcome = await grantPass(userId, {
    days: summary.days,
    tokens: summary.tokens,
    idempotencyKey: checkoutSession.id,
    source: summary.source,
    sessionId: checkoutSession.id,
    details: {
      passes: summary.items.map(({ pass, quantity }) => ({
        passId: pass.id,
        passDays: pass.days,
        passTokens: pass.tokens,
        quantity
      })),
      checkoutSource: checkoutSession.metadata?.source ?? null,
      amountTotal: checkoutSession.amount_total ?? null, // smallest currency unit (e.g. cents)
      currency: checkoutSession.currency ?? null,
      stripeSessionId: checkoutSession.id
    }
  });
  if (!outcome.granted) {
    console.error(`pro pass grant failed (${outcome.reason}): session=${checkoutSession.id} userId=${userId}`);
    return false;
  }
  return true;
};

// Internal helper function to check if user is pro (for other functions to use)
// Same rule as checkUserProStatus (hasProEntitlement): subscription claim OR
// team domain OR unexpired pass. The pass read is skipped when the cheaper
// checks already answer yes.
const isUserProInternal = async (userId) => {
  try {
    const userRecord = await getAuth().getUser(userId);
    const plan = userRecord.customClaims && userRecord.customClaims.plan;
    const { isProDomain } = await validateUserDomain(userRecord.email);
    if (hasProEntitlement({ plan, isProDomain })) return true;
    return isProUntilActive(await readProUntil(userId));
  } catch (error) {
    console.error('Error checking user pro status:', error);
    return false;
  }
};

module.exports = {
  checkAndRefillImageTokens,
  checkAndRefillImageTokensInternal,
  chargeGenerationTokens,
  grantPurchasedTokens,
  grantPass,
  grantProPassForCheckout,
  readProUntil,
  validateUserDomain,
  checkUserProStatus,
  isUserProInternal
};