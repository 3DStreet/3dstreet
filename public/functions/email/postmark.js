/**
 * Shared email transport: the raw Postmark API call and the Auth-backed
 * recipient lookup. Everything that sends email — the daily sweep in
 * scheduled/scheduledEmails.js, the lifecycle send service in
 * lifecycle-email.js, and the generation-ready notification — goes through
 * sendPostmarkEmail so stream routing and error handling live in one place.
 */

const { getAuth } = require('firebase-admin/auth');

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

/**
 * Send email via Postmark API
 *
 * options.stream selects the Postmark message stream: 'outbound'
 * (transactional, default) or a broadcast stream ('conversion', 'lifecycle')
 * where Postmark manages unsubscribe. Callers sending to a broadcast stream
 * must include an unsubscribe link/placeholder in the body (the lifecycle
 * send service in lifecycle-email.js appends one).
 */
const sendPostmarkEmail = async (
  toEmail,
  subject,
  htmlBody,
  textBody,
  options = {}
) => {
  const { stream = 'outbound' } = options;
  const apiKey = process.env.POSTMARK_API_KEY;

  if (!apiKey) {
    throw new Error('POSTMARK_API_KEY is not configured');
  }

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({
      From: 'notify@3dstreet.com',
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: stream
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Postmark API error sending to ${toEmail}: status=${response.status}, body=${errorText}`
    );
    throw new Error(`Postmark API error (${response.status}): ${errorText}`);
  }

  return response.json();
};

/**
 * Get user info from Firebase Auth. displayName feeds the "Hi ${name}," email
 * greeting: Auth displayName when present (Google sign-ins), otherwise the
 * neutral "there" — NOT the raw email local-part ("Hi kieran.farr," reads
 * like a mail merge gone wrong) and NOT the socialProfile username (those
 * are auto-generated handles like "streetcreator_x4f2").
 */
const getUserInfo = async (userId) => {
  try {
    const userRecord = await getAuth().getUser(userId);
    return {
      email: userRecord.email,
      displayName: userRecord.displayName || 'there'
    };
  } catch (error) {
    console.error(`Failed to get user info for ${userId}:`, error);
    return null;
  }
};

module.exports = { sendPostmarkEmail, getUserInfo };
