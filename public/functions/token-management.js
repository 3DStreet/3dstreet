const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const PRO_MONTHLY_ALLOWANCE = 100;

// Cloud Function to check and refill image tokens for Pro users
const checkAndRefillImageTokens = functions
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
      
      // Check for pro domains (uoregon.edu)
      const PRO_DOMAINS = ['uoregon.edu'];
      let isProDomain = false;
      if (!isPro && userRecord.email) {
        const userDomain = PRO_DOMAINS.find(domain => userRecord.email.includes(domain));
        if (userDomain) {
          isProDomain = true;
          console.log(`User ${userRecord.email} has pro access via domain: ${userDomain}`);
        }
      }
      
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
    
    // Check for pro domains
    const PRO_DOMAINS = ['uoregon.edu'];
    let isProDomain = false;
    if (!isPro && userRecord.email) {
      const userDomain = PRO_DOMAINS.find(domain => userRecord.email.includes(domain));
      if (userDomain) {
        isProDomain = true;
      }
    }
    
    const isProUser = isPro || isProDomain;
    
    if (!isProUser) {
      return null; // Not a pro user, no refill needed
    }
    
    // Get current token profile
    const tokenProfileRef = db.collection('tokenProfile').doc(userId);
    const tokenDoc = await tokenProfileRef.get();
    
    if (!tokenDoc.exists) {
      // Create initial token profile for Pro user
      const newProfile = {
        userId: userId,
        geoToken: 3,
        imageToken: PRO_MONTHLY_ALLOWANCE,
        lastMonthlyRefill: `${new Date().getFullYear()}-${new Date().getMonth()}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await tokenProfileRef.set(newProfile);
      return newProfile;
    }
    
    const tokenData = tokenDoc.data();
    
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

module.exports = { 
  checkAndRefillImageTokens,
  checkAndRefillImageTokensInternal 
};