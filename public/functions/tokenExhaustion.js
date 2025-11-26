const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { isUserProInternal } = require('./token-management.js');

// Postmark API endpoint
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

// Email cooldown period (7 days in milliseconds)
const EMAIL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Get email template for token exhaustion
 * @param {string} tokenType - 'geo' or 'gen' (AI)
 * @param {string} userName - User's display name or email
 * @returns {Object} - { subject, htmlBody, textBody }
 */
const getEmailTemplate = (tokenType, userName) => {
  const displayName = userName || 'there';

  if (tokenType === 'geo') {
    return {
      subject: "You've used all your geo tokens on 3DStreet",
      textBody: `Hi ${displayName},

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
      htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/streetmix3d-logo.svg" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${displayName},</h2>

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
    };
  }

  // AI (gen) token exhaustion template
  return {
    subject: "You've used all your AI tokens on 3DStreet",
    textBody: `Hi ${displayName},

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
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/streetmix3d-logo.svg" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${displayName},</h2>

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
  };
};

/**
 * Send email via Postmark API
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {string} textBody - Plain text email body
 * @returns {Promise<Object>} - Postmark API response
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
 * Check if we've sent an email to this user recently
 * @param {string} userId - User ID
 * @param {string} tokenType - 'geo' or 'gen'
 * @returns {Promise<boolean>} - true if within cooldown period
 */
const isWithinEmailCooldown = async (userId, tokenType) => {
  const db = admin.firestore();
  const emailLogRef = db.collection('emailLog').doc(userId);

  try {
    const emailLogDoc = await emailLogRef.get();

    if (!emailLogDoc.exists) {
      return false;
    }

    const emailLog = emailLogDoc.data();
    const lastEmailField = `last${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)}TokenEmail`;
    const lastEmailTime = emailLog[lastEmailField];

    if (!lastEmailTime) {
      return false;
    }

    // Convert Firestore Timestamp to milliseconds
    const lastEmailMs = lastEmailTime.toMillis ? lastEmailTime.toMillis() : lastEmailTime;
    const now = Date.now();

    return (now - lastEmailMs) < EMAIL_COOLDOWN_MS;
  } catch (error) {
    console.error('Error checking email cooldown:', error);
    // On error, err on the side of not sending (to avoid spam)
    return true;
  }
};

/**
 * Record that we sent an email to this user
 * @param {string} userId - User ID
 * @param {string} tokenType - 'geo' or 'gen'
 * @param {string} email - Email address we sent to
 */
const recordEmailSent = async (userId, tokenType, email) => {
  const db = admin.firestore();
  const emailLogRef = db.collection('emailLog').doc(userId);

  const lastEmailField = `last${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)}TokenEmail`;

  await emailLogRef.set({
    userId: userId,
    email: email,
    [lastEmailField]: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
};

/**
 * Cloud Function that triggers on tokenProfile updates
 * Sends notification emails when users exhaust their tokens
 */
const onTokenExhaustion = functions
  .runWith({
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .firestore
  .document('tokenProfile/{userId}')
  .onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    console.log(`Token profile updated for user ${userId}`);
    console.log(`Before: geoToken=${beforeData.geoToken}, genToken=${beforeData.genToken}`);
    console.log(`After: geoToken=${afterData.geoToken}, genToken=${afterData.genToken}`);

    // Check if geoToken transitioned to 0
    const geoTokenExhausted =
      beforeData.geoToken > 0 &&
      afterData.geoToken === 0;

    // Check if genToken transitioned to 0
    const genTokenExhausted =
      beforeData.genToken > 0 &&
      afterData.genToken === 0;

    // If no token exhaustion occurred, exit early
    if (!geoTokenExhausted && !genTokenExhausted) {
      console.log('No token exhaustion detected, skipping email');
      return null;
    }

    try {
      // Check if user is PRO (don't send emails to PRO users)
      const isPro = await isUserProInternal(userId);

      if (isPro) {
        console.log(`User ${userId} is PRO, skipping token exhaustion email`);
        return null;
      }

      // Get user email from Firebase Auth
      const userRecord = await getAuth().getUser(userId);
      const userEmail = userRecord.email;

      if (!userEmail) {
        console.log(`User ${userId} has no email address, cannot send notification`);
        return null;
      }

      // Get user's display name
      const userName = userRecord.displayName || userEmail.split('@')[0];

      // Process each type of token exhaustion
      const emailPromises = [];

      if (geoTokenExhausted) {
        console.log(`Geo token exhausted for user ${userId}`);

        // Check cooldown
        const inCooldown = await isWithinEmailCooldown(userId, 'geo');

        if (inCooldown) {
          console.log(`User ${userId} is within geo token email cooldown, skipping`);
        } else {
          const template = getEmailTemplate('geo', userName);

          emailPromises.push(
            sendPostmarkEmail(userEmail, template.subject, template.htmlBody, template.textBody)
              .then(async (result) => {
                console.log(`Geo token exhaustion email sent to ${userEmail}:`, result.MessageID);
                await recordEmailSent(userId, 'geo', userEmail);
                return { type: 'geo', success: true, messageId: result.MessageID };
              })
              .catch((error) => {
                console.error(`Failed to send geo token email to ${userEmail}:`, error);
                return { type: 'geo', success: false, error: error.message };
              })
          );
        }
      }

      if (genTokenExhausted) {
        console.log(`Gen (AI) token exhausted for user ${userId}`);

        // Check cooldown
        const inCooldown = await isWithinEmailCooldown(userId, 'gen');

        if (inCooldown) {
          console.log(`User ${userId} is within gen token email cooldown, skipping`);
        } else {
          const template = getEmailTemplate('gen', userName);

          emailPromises.push(
            sendPostmarkEmail(userEmail, template.subject, template.htmlBody, template.textBody)
              .then(async (result) => {
                console.log(`Gen token exhaustion email sent to ${userEmail}:`, result.MessageID);
                await recordEmailSent(userId, 'gen', userEmail);
                return { type: 'gen', success: true, messageId: result.MessageID };
              })
              .catch((error) => {
                console.error(`Failed to send gen token email to ${userEmail}:`, error);
                return { type: 'gen', success: false, error: error.message };
              })
          );
        }
      }

      // Wait for all email operations to complete
      const results = await Promise.all(emailPromises);
      console.log('Email operation results:', results);

      return { success: true, results };

    } catch (error) {
      console.error(`Error in onTokenExhaustion for user ${userId}:`, error);
      // Don't throw - we don't want to retry email sends on error
      return { success: false, error: error.message };
    }
  });

module.exports = {
  onTokenExhaustion
};
