# Token Exhaustion Email Notifications

This document describes the `onTokenExhaustion` Cloud Function that sends transactional emails to users when they exhaust their tokens.

## Overview

When a free user's `geoToken` or `genToken` reaches 0, this function sends a friendly email via Postmark encouraging them to upgrade to Pro.

## How It Works

1. **Trigger**: Firestore `onUpdate` trigger on `tokenProfile/{userId}` documents
2. **Detection**: Checks if `geoToken` or `genToken` transitioned from >0 to 0
3. **Filtering**:
   - Only fires for free users (skips PRO users)
   - Rate-limits to 1 email per token type per user every 7 days
4. **Email Delivery**: Uses Postmark transactional API

## Firestore Collections

### `tokenProfile/{userId}` (existing)
The function monitors updates to this collection.

### `emailLog/{userId}` (new)
Tracks email sends for rate limiting:
```js
{
  userId: string,
  email: string,
  lastGeoTokenEmail: Timestamp,  // Last geo token exhaustion email
  lastGenTokenEmail: Timestamp,  // Last AI token exhaustion email
  updatedAt: Timestamp
}
```

## Setup

### 1. Add Postmark API Key to Cloud Secrets

```bash
# Set the Postmark API key as a Cloud Secret
firebase functions:secrets:set POSTMARK_API_KEY
```

When prompted, enter your Postmark Server API Token.

### 2. Configure Postmark Sender

In Postmark:
1. Verify your sender domain or email (`hello@3dstreet.com`)
2. Ensure the "outbound" message stream is enabled
3. (Optional) Set up a dedicated Sender Signature for transactional emails

### 3. Deploy the Function

```bash
# Deploy all functions
npm run deploy

# Or deploy only this function
firebase deploy --only functions:onTokenExhaustion
```

### 4. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## Local Testing

### Using Firebase Emulators

1. Start the emulators:
```bash
cd public/functions
npm run serve
```

2. The function will automatically trigger when you update a `tokenProfile` document in the emulator.

3. To test manually, use the Firebase Console Emulator UI or a script:
```js
// Example: Trigger token exhaustion in emulator
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-project' });

const db = admin.firestore();

// First, set up a user with tokens
await db.collection('tokenProfile').doc('test-user-123').set({
  userId: 'test-user-123',
  geoToken: 1,
  genToken: 5
});

// Then update to exhaust tokens
await db.collection('tokenProfile').doc('test-user-123').update({
  geoToken: 0
});
```

### Testing with Real Postmark

For local testing with real email delivery:

1. Create a `.env` file in `public/functions/`:
```
POSTMARK_API_KEY=your-test-api-key
```

2. Use Postmark's test server or a test recipient email

### Viewing Logs

```bash
# View function logs
firebase functions:log --only onTokenExhaustion

# Or stream logs in real-time
firebase functions:log --only onTokenExhaustion --follow
```

## Email Templates

Two email templates are included:

### Geo Token Exhaustion
- Subject: "You've used all your geo tokens on 3DStreet"
- Explains Google 3D Tiles feature
- Links to upgrade page

### AI (Gen) Token Exhaustion
- Subject: "You've used all your AI tokens on 3DStreet"
- Explains AI image generation feature
- Links to upgrade page

Both templates include:
- Plain text version (for email clients that don't support HTML)
- HTML version with 3DStreet branding
- CTA button linking to `https://3dstreet.app/#/modal/payment`

## Customization

To modify email templates, edit the `getEmailTemplate()` function in `tokenExhaustion.js`.

Key points:
- Keep the `From` address as a verified Postmark sender
- Update `MessageStream` if using a different Postmark stream
- Test both HTML and plain text versions

## Monitoring

### Success Indicators
- Check Postmark Activity for delivery status
- Function logs show `"email sent"` messages with MessageID

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No email sent | User is PRO | Expected behavior |
| No email sent | Within 7-day cooldown | Check `emailLog` collection |
| Postmark error 401 | Invalid API key | Verify secret is set correctly |
| Postmark error 422 | Invalid sender | Verify sender domain in Postmark |

## Security Notes

- The `emailLog` collection has Firestore rules denying all client access
- Only Cloud Functions (admin SDK) can read/write email logs
- User email addresses are retrieved from Firebase Auth, not Firestore
- API key is stored as a Cloud Secret, never in code
