const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const PRO_MONTHLY_ALLOWANCE = 100;

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
    const allowedDomainsSecret = process.env.ALLOWED_PRO_DOMAINS;
    if (!allowedDomainsSecret) {
      console.warn('ALLOWED_PRO_DOMAINS secret not configured, falling back to hardcoded domain');
      // Temporary fallback during migration
      const fallbackDomains = ['uoregon.edu'];
      const matchedDomain = fallbackDomains.find(domain => domain === userDomain);
      return { 
        isProDomain: !!matchedDomain, 
        matchedDomain: matchedDomain || undefined 
      };
    }

    // Parse the JSON array of allowed domains with proper error handling
    let allowedDomains;
    try {
      allowedDomains = JSON.parse(allowedDomainsSecret);
      if (!Array.isArray(allowedDomains)) {
        throw new Error('ALLOWED_PRO_DOMAINS must be a JSON array');
      }
    } catch (parseError) {
      console.error('Error parsing ALLOWED_PRO_DOMAINS secret:', parseError);
      return { isProDomain: false };
    }

    const matchedDomain = allowedDomains.find(domain => domain === userDomain);
    
    if (matchedDomain) {
      console.log(`User ${userEmail} has pro access via domain: ${matchedDomain}`);
      return { isProDomain: true, matchedDomain };
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
  .runWith({ secrets: ["ALLOWED_PRO_DOMAINS"] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userId = context.auth.uid;
    const db = admin.firestore();
    
    try {
      // Check if user is Pro
      const userRecord = await getAuth().getUser(userId);
      const isPro = userRecord.customClaims && userRecord.customClaims.plan === 'PRO';
      
      // Use centralized domain validation
      const { isProDomain } = await validateUserDomain(userRecord.email);
      
      const isProUser = isPro || isProDomain;
      
      // Get current token profile
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tokenProfileRef.get();
      
      if (!tokenDoc.exists) {
        // Create initial token profile
        const initialTokens = isProUser ? PRO_MONTHLY_ALLOWANCE : 5;
        const newProfile = {
          userId: userId,
          geoToken: 3,
          imageToken: initialTokens,
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
        const newImageTokens = Math.max(tokenData.imageToken || 0, PRO_MONTHLY_ALLOWANCE);
        
        await tokenProfileRef.update({
          imageToken: newImageTokens,
          lastMonthlyRefill: currentMonthKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Refilled Pro tokens for user ${userId}: ${tokenData.imageToken} -> ${newImageTokens}`);
        
        return {
          success: true,
          tokenProfile: {
            ...tokenData,
            imageToken: newImageTokens,
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
    // Check if user is Pro
    const userRecord = await getAuth().getUser(userId);
    const isPro = userRecord.customClaims && userRecord.customClaims.plan === 'PRO';
    
    // Use centralized domain validation
    const { isProDomain } = await validateUserDomain(userRecord.email);
    
    const isProUser = isPro || isProDomain;
    
    // Get current token profile
    const tokenProfileRef = db.collection('tokenProfile').doc(userId);
    const tokenDoc = await tokenProfileRef.get();
    
    if (!tokenDoc.exists) {
      // Create initial token profile based on user type
      const newProfile = {
        userId: userId,
        geoToken: 3,
        imageToken: isProUser ? PRO_MONTHLY_ALLOWANCE : 5, // Pro users get 100, free users get 5
        lastMonthlyRefill: isProUser ? `${new Date().getFullYear()}-${new Date().getMonth()}` : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await tokenProfileRef.set(newProfile);
      return newProfile;
    }
    
    const tokenData = tokenDoc.data();
    
    // Only refill for pro users
    if (!isProUser) {
      return tokenData; // Return existing data for free users
    }
    
    // Check if needs monthly refill
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const needsRefill = !tokenData.lastMonthlyRefill || tokenData.lastMonthlyRefill !== currentMonthKey;
    
    if (needsRefill) {
      const newImageTokens = Math.max(tokenData.imageToken || 0, PRO_MONTHLY_ALLOWANCE);
      
      await tokenProfileRef.update({
        imageToken: newImageTokens,
        lastMonthlyRefill: currentMonthKey,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        ...tokenData,
        imageToken: newImageTokens,
        lastMonthlyRefill: currentMonthKey
      };
    }
    
    return tokenData;
    
  } catch (error) {
    console.error('Error in checkAndRefillImageTokensInternal:', error);
    return null;
  }
};

// Cloud Function to check if user is Pro (subscription + domain validation)
const checkUserProStatus = functions
  .runWith({ secrets: ["ALLOWED_PRO_DOMAINS"] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userId = context.auth.uid;
    
    try {
      // Check if user is Pro via subscription
      const userRecord = await getAuth().getUser(userId);
      const isPro = userRecord.customClaims && userRecord.customClaims.plan === 'PRO';
      
      // Check domain validation
      const { isProDomain, matchedDomain } = await validateUserDomain(userRecord.email);
      
      const isProUser = isPro || isProDomain;
      
      return {
        isPro: isProUser,
        isProSubscription: isPro,
        isProDomain: isProDomain,
        matchedDomain: matchedDomain || null,
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
    const isPro = userRecord.customClaims && userRecord.customClaims.plan === 'PRO';
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