const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { isUserProInternal } = require('./token-management.js');

// Postmark API endpoint
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

// Email cooldown periods (in milliseconds)
const COOLDOWN_7_DAYS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

const EMAIL_TEMPLATES = {
  geoTokenExhaustion: {
    subject: "You've used all your geo tokens on 3DStreet",
    getTextBody: (userName) => `Hi ${userName},

You've used all of your free geo tokens on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.

Want to keep designing with real-world context? Upgrade to 3DStreet Pro and get:

- Unlimited geo tokens for Google 3D Tiles
- 100 AI generation tokens per month
- Priority support
- Early access to new features

Upgrade now: https://3dstreet.app/#/modal/payment

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you created an account on 3DStreet.
If you have questions, reply to this email or visit https://3dstreet.com/docs/`,
    getHtmlBody: (userName) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/streetmix3d-logo.svg" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>You've used all of your free <strong>geo tokens</strong> on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.</p>

  <p>Want to keep designing with real-world context? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>100 AI generation tokens per month</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <div style="text-align: center; margin: 30px 0;">
    <a href="https://3dstreet.app/#/modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you created an account on 3DStreet.<br>
    If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`
  },

  genTokenExhaustion: {
    subject: "You've used all your AI tokens on 3DStreet",
    getTextBody: (userName) => `Hi ${userName},

You've used all of your free AI generation tokens on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.

Want to keep creating amazing renders? Upgrade to 3DStreet Pro and get:

- 100 AI generation tokens per month
- Unlimited geo tokens for Google 3D Tiles
- Priority support
- Early access to new features

Upgrade now: https://3dstreet.app/#/modal/payment

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you created an account on 3DStreet.
If you have questions, reply to this email or visit https://3dstreet.com/docs/`,
    getHtmlBody: (userName) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/streetmix3d-logo.svg" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>You've used all of your free <strong>AI generation tokens</strong> on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.</p>

  <p>Want to keep creating amazing renders? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>100 AI generation tokens per month</li>
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <div style="text-align: center; margin: 30px 0;">
    <a href="https://3dstreet.app/#/modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you created an account on 3DStreet.<br>
    If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`
  }

  // Add more email templates here as needed:
  // welcome: { ... },
  // reEngagement: { ... },
  // featureAnnouncement: { ... },
};

// ============================================================================
// EMAIL TYPE CONFIGURATIONS
// Each type defines how to find eligible users and what template to use
// ============================================================================

const EMAIL_TYPES = {
  geoTokenExhaustion: {
    templateKey: 'geoTokenExhaustion',
    cooldownMs: COOLDOWN_7_DAYS,
    emailLogField: 'lastGeoTokenEmail',
    // Query function returns users eligible for this email type
    async getEligibleUsers(db) {
      const snapshot = await db.collection('tokenProfile')
        .where('geoToken', '==', 0)
        .get();
      return snapshot.docs.map(doc => ({
        userId: doc.id,
        ...doc.data()
      }));
    },
    // Filter function for additional checks (e.g., skip PRO users)
    async shouldSendToUser(userId) {
      const isPro = await isUserProInternal(userId);
      return !isPro;
    }
  },

  genTokenExhaustion: {
    templateKey: 'genTokenExhaustion',
    cooldownMs: COOLDOWN_7_DAYS,
    emailLogField: 'lastGenTokenEmail',
    async getEligibleUsers(db) {
      const snapshot = await db.collection('tokenProfile')
        .where('genToken', '==', 0)
        .get();
      return snapshot.docs.map(doc => ({
        userId: doc.id,
        ...doc.data()
      }));
    },
    async shouldSendToUser(userId) {
      const isPro = await isUserProInternal(userId);
      return !isPro;
    }
  }

  // Add more email types here as needed:
  // welcome: { ... },
  // reEngagement: { ... },
};

// ============================================================================
// CORE EMAIL FUNCTIONS
// ============================================================================

/**
 * Send email via Postmark API
 */
const sendPostmarkEmail = async (toEmail, subject, htmlBody, textBody) => {
  const apiKey = process.env.POSTMARK_API_KEY;

  if (!apiKey) {
    throw new Error('POSTMARK_API_KEY is not configured');
  }

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({
      From: 'hello@3dstreet.com',
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Postmark API error (${response.status}): ${errorText}`);
  }

  return response.json();
};

/**
 * Check if user is within email cooldown period
 */
const isWithinCooldown = (emailLog, emailLogField, cooldownMs) => {
  if (!emailLog || !emailLog[emailLogField]) {
    return false;
  }

  const lastEmailTime = emailLog[emailLogField];
  const lastEmailMs = lastEmailTime.toMillis ? lastEmailTime.toMillis() : lastEmailTime;
  const now = Date.now();

  return (now - lastEmailMs) < cooldownMs;
};

/**
 * Record that an email was sent
 */
const recordEmailSent = async (db, userId, emailLogField, email) => {
  const emailLogRef = db.collection('emailLog').doc(userId);

  await emailLogRef.set({
    userId: userId,
    email: email,
    [emailLogField]: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
};

/**
 * Get user info from Firebase Auth
 */
const getUserInfo = async (userId) => {
  try {
    const userRecord = await getAuth().getUser(userId);
    return {
      email: userRecord.email,
      displayName: userRecord.displayName || (userRecord.email ? userRecord.email.split('@')[0] : 'there')
    };
  } catch (error) {
    console.error(`Failed to get user info for ${userId}:`, error);
    return null;
  }
};

/**
 * Process a single email type - find eligible users and send emails
 */
const processEmailType = async (db, emailTypeKey, emailType) => {
  const results = {
    type: emailTypeKey,
    processed: 0,
    sent: 0,
    skipped: {
      cooldown: 0,
      noEmail: 0,
      filtered: 0,
      error: 0
    }
  };

  const template = EMAIL_TEMPLATES[emailType.templateKey];
  if (!template) {
    console.error(`Template not found for email type: ${emailTypeKey}`);
    return results;
  }

  // Get eligible users
  let eligibleUsers;
  try {
    eligibleUsers = await emailType.getEligibleUsers(db);
    console.log(`Found ${eligibleUsers.length} eligible users for ${emailTypeKey}`);
  } catch (error) {
    console.error(`Error querying eligible users for ${emailTypeKey}:`, error);
    return results;
  }

  if (eligibleUsers.length === 0) {
    return results;
  }

  // Get all email logs in batch for efficiency
  const userIds = eligibleUsers.map(u => u.userId);
  const emailLogRefs = userIds.map(id => db.collection('emailLog').doc(id));
  const emailLogDocs = await db.getAll(...emailLogRefs);
  const emailLogMap = {};
  emailLogDocs.forEach((doc, index) => {
    if (doc.exists) {
      emailLogMap[userIds[index]] = doc.data();
    }
  });

  // Process each user
  for (const user of eligibleUsers) {
    results.processed++;
    const userId = user.userId;

    try {
      // Check cooldown
      const emailLog = emailLogMap[userId];
      if (isWithinCooldown(emailLog, emailType.emailLogField, emailType.cooldownMs)) {
        results.skipped.cooldown++;
        continue;
      }

      // Apply additional filters (e.g., skip PRO users)
      if (emailType.shouldSendToUser) {
        const shouldSend = await emailType.shouldSendToUser(userId);
        if (!shouldSend) {
          results.skipped.filtered++;
          continue;
        }
      }

      // Get user email
      const userInfo = await getUserInfo(userId);
      if (!userInfo || !userInfo.email) {
        results.skipped.noEmail++;
        continue;
      }

      // Send email
      const subject = template.subject;
      const textBody = template.getTextBody(userInfo.displayName);
      const htmlBody = template.getHtmlBody(userInfo.displayName);

      const postmarkResult = await sendPostmarkEmail(
        userInfo.email,
        subject,
        htmlBody,
        textBody
      );

      console.log(`Sent ${emailTypeKey} email to ${userInfo.email}: ${postmarkResult.MessageID}`);

      // Record email sent
      await recordEmailSent(db, userId, emailType.emailLogField, userInfo.email);
      results.sent++;

    } catch (error) {
      console.error(`Error processing ${emailTypeKey} for user ${userId}:`, error);
      results.skipped.error++;
    }
  }

  return results;
};

// ============================================================================
// SCHEDULED CLOUD FUNCTION
// ============================================================================

/**
 * Scheduled function that runs daily to send notification emails
 * Runs at 9:00 AM Pacific Time (17:00 UTC)
 */
const sendScheduledEmails = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .pubsub
  .schedule('0 17 * * *')  // 9:00 AM PT (17:00 UTC)
  .timeZone('America/Los_Angeles')
  .onRun(async (context) => {
    console.log('Starting scheduled email job');
    const db = admin.firestore();
    const allResults = [];

    // Process each email type
    for (const [emailTypeKey, emailType] of Object.entries(EMAIL_TYPES)) {
      console.log(`Processing email type: ${emailTypeKey}`);
      const results = await processEmailType(db, emailTypeKey, emailType);
      allResults.push(results);
      console.log(`Completed ${emailTypeKey}:`, JSON.stringify(results));
    }

    console.log('Scheduled email job complete:', JSON.stringify(allResults));
    return { success: true, results: allResults };
  });

/**
 * HTTP callable function for manual triggering (useful for testing)
 * Only processes specified email types if provided, otherwise all
 */
const triggerScheduledEmails = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated and is admin (optional: add admin check)
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    // Optional: Check for admin role
    // if (!context.auth.token.admin) {
    //   throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    // }

    console.log('Manually triggering scheduled emails');
    const db = admin.firestore();
    const allResults = [];

    // Allow filtering to specific email types
    const emailTypesToProcess = data?.emailTypes || Object.keys(EMAIL_TYPES);

    for (const emailTypeKey of emailTypesToProcess) {
      const emailType = EMAIL_TYPES[emailTypeKey];
      if (!emailType) {
        console.warn(`Unknown email type: ${emailTypeKey}`);
        continue;
      }

      console.log(`Processing email type: ${emailTypeKey}`);
      const results = await processEmailType(db, emailTypeKey, emailType);
      allResults.push(results);
      console.log(`Completed ${emailTypeKey}:`, JSON.stringify(results));
    }

    return { success: true, results: allResults };
  });

module.exports = {
  sendScheduledEmails,
  triggerScheduledEmails,
  // Export for testing
  EMAIL_TEMPLATES,
  EMAIL_TYPES
};
