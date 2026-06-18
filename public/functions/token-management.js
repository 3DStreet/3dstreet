const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('./app-check.js');

const PRO_MONTHLY_ALLOWANCE = 100;
const MAX_MONTHLY_ALLOWANCE = 500;

// MAX is a superset of PRO: it unlocks every Pro feature, plus higher storage
// and a larger monthly token allowance. Anywhere we used to check
// `plan === 'PRO'`, accept either paid tier. Keep this in sync with the plan
// claims written by the Stripe webhook in index.js.
const isPaidPlanClaim = (plan) => plan === 'PRO' || plan === 'MAX';

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
  .runWith({ secrets: ["ALLOWED_PRO_TEAM_DOMAINS"] })
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
        // Top up to monthly allowance (don't reset if they have more from purchases)
        const tokensBefore = tokenData.genToken || 0;
        const newImageTokens = Math.max(tokensBefore, monthlyAllowance);

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
      const newImageTokens = Math.max(internalTokensBefore, monthlyAllowance);

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
  .runWith({ secrets: ["ALLOWED_PRO_TEAM_DOMAINS"] })
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

      const isProUser = isPro || isProDomain;

      return {
        isPro: isProUser,
        isProSubscription: isPro,
        isProDomain: isProDomain,
        teamDomain: teamDomain || null,
        // Actual paid tier ('PRO' | 'MAX' | null). Lets the client distinguish
        // Max from Pro for badge/profile labels; domain-team users have no plan
        // claim so this is null for them (they render as the team label).
        plan,
        email: userRecord.email
      };
      
    } catch (error) {
      console.error('Error checking user pro status:', error);
      throw new functions.https.HttpsError('internal', `Failed to check pro status: ${error.message}`);
    }
  });

// Internal helper function to check if user is pro (for other functions to use)
const isUserProInternal = async (userId) => {
  try {
    const userRecord = await getAuth().getUser(userId);
    const isPro = isPaidPlanClaim(userRecord.customClaims && userRecord.customClaims.plan);
    const { isProDomain } = await validateUserDomain(userRecord.email);
    return isPro || isProDomain;
  } catch (error) {
    console.error('Error checking user pro status:', error);
    return false;
  }
};

module.exports = { 
  checkAndRefillImageTokens,
  checkAndRefillImageTokensInternal,
  validateUserDomain,
  checkUserProStatus,
  isUserProInternal
};