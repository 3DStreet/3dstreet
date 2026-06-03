const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { withJobHealth } = require('./job-health.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const { isUserProInternal } = require('../token-management.js');

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
You received this email because you created an account on 3DStreet. This message is only sent once.
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
    This message is only sent once. If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
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
You received this email because you created an account on 3DStreet. This message is only sent once.
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
    This message is only sent once. If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`
  },

  // Sent once per opted-in generation job that finishes while the user is away
  // (no live tab acked the result). Triggered from the generation-job reconciler,
  // not the daily scheduler — it reuses sendPostmarkEmail below.
  //
  // Kind-aware so video and image (the next async generations) reuse it with no
  // new template: the queue + sweep are already kind-agnostic, so a new kind just
  // adds a copy entry here (and an opt-in checkbox on its tab). Unknown kinds
  // fall back to neutral "generation" wording rather than failing.
  generationReady: {
    copyByKind: {
      splat: { noun: 'splat', desc: '3D Gaussian Splat' },
      video: { noun: 'video', desc: 'video' },
      image: { noun: 'image', desc: 'image' }
    },
    getCopy(kind) {
      return this.copyByKind[kind] || { noun: 'generation', desc: 'generation' };
    },
    // Fallback CTA when a caller doesn't pass a deep link to the specific asset.
    defaultCtaUrl:
      'https://3dstreet.app/?utm_source=email&utm_medium=notification&utm_campaign=generation_ready',
    // Compact, human-readable UTC stamp (e.g. "Jun 2, 3:41 PM UTC"). Used to keep
    // each notification distinct so mail clients don't thread/collapse them.
    formatWhen(when) {
      if (!when) return '';
      const d = when instanceof Date ? when : new Date(when);
      if (isNaN(d.getTime())) return '';
      return (
        d.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'UTC'
        }) + ' UTC'
      );
    },
    // Each finished asset already carries a unique, timestamped name (e.g.
    // "SHARP Splat 2026-06-02T15-41-03"), so threading the name into the subject
    // makes every notification distinct. Fall back to a formatted time when no
    // name is on the job. ctx: { assetName, when }.
    getSubject(kind, ctx = {}) {
      const { noun } = this.getCopy(kind);
      if (ctx.assetName) return `Your 3DStreet ${noun} "${ctx.assetName}" is ready`;
      const when = this.formatWhen(ctx.when);
      return when
        ? `Your 3DStreet ${noun} is ready (${when})`
        : `Your 3DStreet ${noun} is ready`;
    },
    getTextBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName ? ` "${ctx.assetName}"` : '';
      const when = this.formatWhen(ctx.when);
      const generatedLine = when ? `\nGenerated ${when}.\n` : '';
      return `Hi ${userName},

Your ${desc}${name} finished generating and has been saved to your 3DStreet gallery.
${generatedLine}

Open it in the editor:
${link}

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you asked to be notified when your ${noun} finished. You can opt out by unchecking that box next time.`;
    },
    getHtmlBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName
        ? ` <strong>&ldquo;${ctx.assetName}&rdquo;</strong>`
        : '';
      const when = this.formatWhen(ctx.when);
      const generatedLine = when
        ? `\n  <p style="color: #666; font-size: 13px;">Generated ${when}.</p>`
        : '';
      return `<!DOCTYPE html>
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

  <p>Your <strong>${desc}</strong>${name} finished generating and has been saved to your 3DStreet gallery.</p>
${generatedLine}
  <p>Open it in the editor to preview it and drag it into your scene.</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${link}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Open my ${noun}</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you asked to be notified when your ${noun} finished.<br>
    You can opt out by unchecking that box next time.
  </p>
</body>
</html>`;
    }
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
    notifyLogField: 'tokenExhaustionEmailSent',

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
const hasAlreadyReceivedEmail = (notifyLog, notifyLogField) => {
  if (!notifyLog || !notifyLog[notifyLogField]) {
    return false;
  }
  return true;
};

/**
 * Record that an email was sent
 */
const recordEmailSent = async (db, userId, notifyLogField, email) => {
  const notifyLogRef = db.collection('notifyLog').doc(userId);

  await notifyLogRef.set({
    userId: userId,
    email: email,
    [notifyLogField]: admin.firestore.FieldValue.serverTimestamp(),
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

  // Get all notify logs in batch for efficiency
  // Firestore getAll() has a limit of 100 documents per call, so we chunk
  const userIds = eligibleUsers.map(u => u.userId);
  const notifyLogMap = {};
  const BATCH_SIZE = 100;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batchIds = userIds.slice(i, i + BATCH_SIZE);
    const notifyLogRefs = batchIds.map(id => db.collection('notifyLog').doc(id));
    const notifyLogDocs = await db.getAll(...notifyLogRefs);
    notifyLogDocs.forEach((doc, index) => {
      if (doc.exists) {
        notifyLogMap[batchIds[index]] = doc.data();
      }
    });
  }

  // Process each user
  for (const user of eligibleUsers) {
    results.processed++;
    const userId = user.userId;

    try {
      // Check if already sent (once ever per email type)
      const notifyLog = notifyLogMap[userId];
      if (hasAlreadyReceivedEmail(notifyLog, emailType.notifyLogField)) {
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
      await recordEmailSent(db, userId, emailType.notifyLogField, userInfo.email);
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
  .onRun(
    withJobHealth(
      'sendScheduledEmails',
      {
        schedule: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: DAY_MS,
        degradedKeys: ['errors']
      },
      async () => {
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
        // Flatten to top-level counts so the health page shows totals at a
        // glance and `errors` can drive the degraded (yellow) status.
        const sent = allResults.reduce((n, r) => n + (r.sent || 0), 0);
        const processed = allResults.reduce((n, r) => n + (r.processed || 0), 0);
        const errors = allResults.reduce(
          (n, r) => n + ((r.skipped && r.skipped.error) || 0),
          0
        );
        return { success: true, sent, processed, errors, results: allResults };
      }
    )
  );

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
  // Reused by the generation-job reconciler to send completion emails.
  sendPostmarkEmail,
  getUserInfo,
  // Export for testing
  EMAIL_TEMPLATES,
  EMAIL_TYPES
};
