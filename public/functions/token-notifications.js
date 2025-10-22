const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { isUserProInternal } = require('./token-management.js');

// Postmark API endpoint
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

// Deduplication window in milliseconds (30 days)
const NOTIFICATION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Send email via Postmark API
 */
async function sendPostmarkEmail(apiKey, fromEmail, toEmail, subject, textBody, htmlBody) {
  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({
      From: fromEmail,
      To: toEmail,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Postmark API error: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  return await response.json();
}

/**
 * Get user's scene count for personalization
 */
async function getUserSceneCount(userId) {
  try {
    const scenesSnapshot = await admin
      .firestore()
      .collection('scenes')
      .where('author', '==', userId)
      .select() // Only count, don't fetch data
      .get();
    return scenesSnapshot.size;
  } catch (error) {
    console.warn(`Failed to get scene count for user ${userId}:`, error);
    return null;
  }
}

/**
 * Generate email content for geo token exhaustion
 */
function getGeoTokenEmail(userName, sceneCount) {
  const sceneText = sceneCount !== null && sceneCount > 0
    ? `You've created ${sceneCount} amazing scene${sceneCount !== 1 ? 's' : ''} so far.`
    : '';

  const textBody = `Hi${userName ? ' ' + userName : ''},

You've used all your geospatial tokens on 3DStreet! ${sceneText}

With 3DStreet Pro ($10/month), you'll get:
• Unlimited geospatial access - never worry about tokens again
• 100 AI generation tokens per month (20x more than free)
• Priority support

Upgrade now: https://www.3dstreet.com/pricing

Thanks for using 3DStreet!

The 3DStreet Team
https://www.3dstreet.com`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); padding: 30px; text-align: center;">
    <h1 style="color: white; margin: 0;">3DStreet</h1>
  </div>

  <div style="padding: 30px; background-color: #f9fafb;">
    <p>Hi${userName ? ' ' + userName : ''},</p>

    <p><strong>You've used all your geospatial tokens on 3DStreet!</strong> ${sceneText}</p>

    <div style="background-color: white; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #6366F1;">
      <h2 style="margin-top: 0; color: #6366F1;">Upgrade to 3DStreet Pro</h2>
      <p style="font-size: 18px; margin-bottom: 5px;"><strong>Just $10/month</strong></p>
      <ul style="list-style: none; padding: 0;">
        <li style="padding: 8px 0;">✓ <strong>Unlimited geospatial access</strong> - never worry about tokens again</li>
        <li style="padding: 8px 0;">✓ <strong>100 AI generation tokens per month</strong> (20x more than free)</li>
        <li style="padding: 8px 0;">✓ <strong>Priority support</strong></li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="https://www.3dstreet.com/pricing" style="background-color: #6366F1; color: white; padding: 15px 40px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Upgrade to Pro</a>
    </div>

    <p style="color: #666; font-size: 14px;">Thanks for using 3DStreet!</p>
    <p style="color: #666; font-size: 14px;">The 3DStreet Team</p>
  </div>

  <div style="padding: 20px; text-align: center; color: #666; font-size: 12px; background-color: #e5e7eb;">
    <p>© 2025 3DStreet | <a href="https://www.3dstreet.com" style="color: #6366F1;">www.3dstreet.com</a></p>
  </div>
</body>
</html>`;

  return { textBody, htmlBody };
}

/**
 * Generate email content for gen token exhaustion
 */
function getGenTokenEmail(userName, sceneCount) {
  const sceneText = sceneCount !== null && sceneCount > 0
    ? `You've created ${sceneCount} amazing scene${sceneCount !== 1 ? 's' : ''} so far.`
    : '';

  const textBody = `Hi${userName ? ' ' + userName : ''},

You've used all your AI generation tokens on 3DStreet! ${sceneText}

With 3DStreet Pro ($10/month), you'll get:
• 100 AI generation tokens per month (20x more than free)
• Unlimited geospatial access
• Priority support

That's less than Netflix, but way more creative!

Upgrade now: https://www.3dstreet.com/pricing

Thanks for using 3DStreet!

The 3DStreet Team
https://www.3dstreet.com`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); padding: 30px; text-align: center;">
    <h1 style="color: white; margin: 0;">3DStreet</h1>
  </div>

  <div style="padding: 30px; background-color: #f9fafb;">
    <p>Hi${userName ? ' ' + userName : ''},</p>

    <p><strong>You've used all your AI generation tokens on 3DStreet!</strong> ${sceneText}</p>

    <div style="background-color: white; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #8B5CF6;">
      <h2 style="margin-top: 0; color: #8B5CF6;">Get 100 AI Tokens/Month with Pro</h2>
      <p style="font-size: 18px; margin-bottom: 5px;"><strong>Just $10/month</strong> - less than Netflix!</p>
      <ul style="list-style: none; padding: 0;">
        <li style="padding: 8px 0;">✓ <strong>100 AI generation tokens per month</strong> (20x more than free)</li>
        <li style="padding: 8px 0;">✓ <strong>Unlimited geospatial access</strong></li>
        <li style="padding: 8px 0;">✓ <strong>Priority support</strong></li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="https://www.3dstreet.com/pricing" style="background-color: #8B5CF6; color: white; padding: 15px 40px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Upgrade to Pro</a>
    </div>

    <p style="color: #666; font-size: 14px;">Thanks for using 3DStreet!</p>
    <p style="color: #666; font-size: 14px;">The 3DStreet Team</p>
  </div>

  <div style="padding: 20px; text-align: center; color: #666; font-size: 12px; background-color: #e5e7eb;">
    <p>© 2025 3DStreet | <a href="https://www.3dstreet.com" style="color: #6366F1;">www.3dstreet.com</a></p>
  </div>
</body>
</html>`;

  return { textBody, htmlBody };
}

/**
 * Check if we should send a notification based on cooldown period
 */
function shouldSendNotification(lastNotificationTimestamp) {
  if (!lastNotificationTimestamp) {
    return true; // Never sent before
  }

  const now = Date.now();
  const lastSent = lastNotificationTimestamp.toMillis ? lastNotificationTimestamp.toMillis() : lastNotificationTimestamp;
  const timeSinceLastSent = now - lastSent;

  return timeSinceLastSent >= NOTIFICATION_COOLDOWN_MS;
}

/**
 * Main Cloud Function - Firestore trigger on tokenProfile updates
 */
const sendTokenExhaustionEmail = functions
  .runWith({ secrets: ["POSTMARK_API_KEY", "ALLOWED_PRO_TEAM_DOMAINS"] })
  .firestore
  .document('tokenProfile/{userId}')
  .onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    try {
      // Check if user is Pro - skip notifications for Pro users (they have unlimited/high limits)
      const isPro = await isUserProInternal(userId);
      if (isPro) {
        console.log(`User ${userId} is Pro, skipping token exhaustion notification`);
        return null;
      }

      // Get user info for email
      const userRecord = await getAuth().getUser(userId);
      const userEmail = userRecord.email;

      if (!userEmail) {
        console.log(`User ${userId} has no email, skipping notification`);
        return null;
      }

      // Check for API key
      if (!process.env.POSTMARK_API_KEY) {
        console.error('POSTMARK_API_KEY secret not configured');
        return null;
      }

      const notifications = afterData.notifications || {};
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      // Check for geoToken exhaustion (1 → 0)
      const geoTokenExhausted = beforeData.geoToken === 1 && afterData.geoToken === 0;
      if (geoTokenExhausted && shouldSendNotification(notifications.geoTokenZero)) {
        console.log(`Sending geo token exhaustion email to user ${userId} (${userEmail})`);

        // Get user info for personalization
        const sceneCount = await getUserSceneCount(userId);
        const userName = userRecord.displayName || null;

        // Generate email content
        const { textBody, htmlBody } = getGeoTokenEmail(userName, sceneCount);

        try {
          // Send email
          await sendPostmarkEmail(
            process.env.POSTMARK_API_KEY,
            'team@3dstreet.com',
            userEmail,
            'Your 3DStreet geospatial access is waiting',
            textBody,
            htmlBody
          );

          // Update notification timestamp
          await tokenProfileRef.update({
            'notifications.geoTokenZero': admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`Geo token exhaustion email sent successfully to ${userEmail}`);
        } catch (error) {
          console.error(`Failed to send geo token email to ${userEmail}:`, error);
          // Don't throw - let the function complete even if email fails
        }
      }

      // Check for genToken exhaustion (1 → 0)
      const genTokenExhausted = beforeData.genToken === 1 && afterData.genToken === 0;
      if (genTokenExhausted && shouldSendNotification(notifications.genTokenZero)) {
        console.log(`Sending gen token exhaustion email to user ${userId} (${userEmail})`);

        // Get user info for personalization
        const sceneCount = await getUserSceneCount(userId);
        const userName = userRecord.displayName || null;

        // Generate email content
        const { textBody, htmlBody } = getGenTokenEmail(userName, sceneCount);

        try {
          // Send email
          await sendPostmarkEmail(
            process.env.POSTMARK_API_KEY,
            'team@3dstreet.com',
            userEmail,
            'Get 100 AI tokens/month with 3DStreet Pro',
            textBody,
            htmlBody
          );

          // Update notification timestamp
          await tokenProfileRef.update({
            'notifications.genTokenZero': admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`Gen token exhaustion email sent successfully to ${userEmail}`);
        } catch (error) {
          console.error(`Failed to send gen token email to ${userEmail}:`, error);
          // Don't throw - let the function complete even if email fails
        }
      }

      return null;
    } catch (error) {
      console.error(`Error in sendTokenExhaustionEmail for user ${userId}:`, error);
      // Don't throw - we don't want to cause transaction failures
      return null;
    }
  });

module.exports = { sendTokenExhaustionEmail };
