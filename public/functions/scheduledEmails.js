const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { isUserProInternal } = require('./token-management.js');

// Postmark API endpoint
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

// No cooldown - we only send token exhaustion emails once ever per user

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

Upgrade now: https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=geo_zero&utm_content=cta_link#modal/payment

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
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
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
    <a href="https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=geo_zero&utm_content=cta_button#modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
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

Upgrade now: https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=ai_zero&utm_content=cta_link#modal/payment

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
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
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
    <a href="https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=ai_zero&utm_content=cta_button#modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
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
  tokenExhaustion: {
    // Template is selected dynamically based on which token is exhausted
    emailLogField: 'tokenExhaustionEmailSent',

    // Query users with either token at 0
    // Firestore doesn't support OR queries, so we run two queries and merge
    async getEligibleUsers(db) {
      const [geoSnapshot, genSnapshot] = await Promise.all([
        db.collection('tokenProfile').where('geoToken', '==', 0).get(),
        db.collection('tokenProfile').where('genToken', '==', 0).get()
      ]);

      // Merge and dedupe by userId
      const userMap = new Map();

      for (const doc of geoSnapshot.docs) {
        userMap.set(doc.id, { userId: doc.id, ...doc.data() });
      }
      for (const doc of genSnapshot.docs) {
        if (!userMap.has(doc.id)) {
          userMap.set(doc.id, { userId: doc.id, ...doc.data() });
        }
      }

      return Array.from(userMap.values());
    },

    // Skip PRO users
    async shouldSendToUser(userId) {
      const isPro = await isUserProInternal(userId);
      return !isPro;
    },

    // Select template based on which token is exhausted
    // Prioritize AI (genToken) if both are exhausted
    getTemplateKey(userData) {
      if (userData.genToken === 0) {
        return 'genTokenExhaustion';
      }
      return 'geoTokenExhaustion';
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
      From: 'notify@3dstreet.com',
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Postmark API error sending to ${toEmail}: status=${response.status}, body=${errorText}`);
    throw new Error(`Postmark API error (${response.status}): ${errorText}`);
  }

  return response.json();
};

/**
 * Check if user has already received this email type (once ever)
 */
const hasAlreadyReceivedEmail = (emailLog, emailLogField) => {
  if (!emailLog || !emailLog[emailLogField]) {
    return false;
  }
  return true;
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
 * @param {Object} db - Firestore database instance
 * @param {string} emailTypeKey - The email type identifier
 * @param {Object} emailType - The email type configuration
 * @param {Object} options - Processing options
 * @param {boolean} options.dryRun - If true, log what would be sent without actually sending
 */
const processEmailType = async (db, emailTypeKey, emailType, options = {}) => {
  const { dryRun = false } = options;
  const results = {
    type: emailTypeKey,
    dryRun,
    processed: 0,
    sent: 0,
    wouldSend: [], // For dry run mode - list of emails that would be sent
    skipped: {
      alreadySent: 0,
      noEmail: 0,
      filtered: 0,
      error: 0
    }
  };

  // Get eligible users
  let eligibleUsers;
  try {
    eligibleUsers = await emailType.getEligibleUsers(db);
    console.log(`Found ${eligibleUsers.length} eligible users for ${emailTypeKey}`);
    if (dryRun && eligibleUsers.length > 0) {
      console.log(`[DRY RUN] Eligible users found:`, eligibleUsers.map(u => ({
        userId: u.userId,
        geoToken: u.geoToken,
        genToken: u.genToken,
        geoTokenType: typeof u.geoToken,
        genTokenType: typeof u.genToken
      })));
    }
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
      // Check if already sent (once ever per email type)
      const emailLog = emailLogMap[userId];
      if (hasAlreadyReceivedEmail(emailLog, emailType.emailLogField)) {
        results.skipped.alreadySent++;
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

      // Get user email from Firebase Auth
      const userInfo = await getUserInfo(userId);
      if (!userInfo || !userInfo.email) {
        results.skipped.noEmail++;
        continue;
      }

      // Select template - either static or dynamic based on user data
      const templateKey = emailType.getTemplateKey
        ? emailType.getTemplateKey(user)
        : emailType.templateKey;

      const template = EMAIL_TEMPLATES[templateKey];
      if (!template) {
        console.error(`Template not found: ${templateKey}`);
        results.skipped.error++;
        continue;
      }

      // Send email (or log in dry run mode)
      const subject = template.subject;
      const textBody = template.getTextBody(userInfo.displayName);
      const htmlBody = template.getHtmlBody(userInfo.displayName);

      if (dryRun) {
        // Dry run - just log what would be sent
        console.log(`[DRY RUN] Would send ${emailTypeKey} (${templateKey}) email to ${userInfo.email}`);
        results.wouldSend.push({
          email: userInfo.email,
          displayName: userInfo.displayName,
          templateKey,
          subject
        });
        results.sent++;
        continue;
      }

      const postmarkResult = await sendPostmarkEmail(
        userInfo.email,
        subject,
        htmlBody,
        textBody
      );

      console.log(`Sent ${emailTypeKey} email to ${userInfo.email}, MessageID: ${postmarkResult.MessageID}`);

      // Record email sent
      await recordEmailSent(db, userId, emailType.emailLogField, userInfo.email);
      results.sent++;

    } catch (error) {
      console.error(`Error processing ${emailTypeKey} for user ${userId}:`, error.message || error);
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
  .schedule('0 9 * * *')  // 9:00 AM PT
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
 *
 * @param {Object} data - Function parameters
 * @param {string[]} data.emailTypes - Optional array of email types to process (defaults to all)
 * @param {boolean} data.dryRun - If true, shows what would be sent without actually sending emails
 *
 * Usage from client:
 *   const trigger = firebase.functions().httpsCallable('triggerScheduledEmails');
 *   // Dry run - see what would be sent without sending
 *   await trigger({ dryRun: true });
 *   // Actually send emails
 *   await trigger({ dryRun: false });
 */
const triggerScheduledEmails = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    // Require admin claim to trigger emails
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const dryRun = data?.dryRun ?? true; // Default to dry run for safety
    console.log(`Manually triggering scheduled emails (dryRun: ${dryRun})`);
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
      const results = await processEmailType(db, emailTypeKey, emailType, { dryRun });
      allResults.push(results);
      console.log(`Completed ${emailTypeKey}:`, JSON.stringify(results));
    }

    return { success: true, dryRun, results: allResults };
  });

module.exports = {
  sendScheduledEmails,
  triggerScheduledEmails,
  // Export for testing
  EMAIL_TEMPLATES,
  EMAIL_TYPES
};
