# Scheduled Email System

This document describes the scheduled email notification system that sends transactional emails via Postmark.

## Overview

A daily scheduled Cloud Function queries Firestore for users who meet certain criteria (e.g., exhausted tokens) and sends notification emails. The system is designed to be extensible for adding new email types.

## Architecture

```
scheduledEmails.js
├── EMAIL_TEMPLATES     - Email content (subject, HTML, text)
├── EMAIL_TYPES         - Query logic + filters for each email type
├── sendScheduledEmails - Daily scheduled function (9am PT)
└── triggerScheduledEmails - Manual trigger for testing
```

## Current Email Types

### Token Exhaustion Emails

| Type | Trigger Condition | Template |
|------|-------------------|----------|
| `geoTokenExhaustion` | `geoToken == 0` | Geo tokens exhausted |
| `genTokenExhaustion` | `genToken == 0` | AI tokens exhausted |

Both types:
- Skip PRO users
- Rate-limit to 1 email per type per user every 7 days
- Link to upgrade page

## Adding New Email Types

### 1. Add Template to `EMAIL_TEMPLATES`

```js
const EMAIL_TEMPLATES = {
  // ... existing templates ...

  welcome: {
    subject: "Welcome to 3DStreet!",
    getTextBody: (userName) => `Hi ${userName}, ...`,
    getHtmlBody: (userName) => `<!DOCTYPE html>...`
  }
};
```

### 2. Add Email Type to `EMAIL_TYPES`

```js
const EMAIL_TYPES = {
  // ... existing types ...

  welcome: {
    templateKey: 'welcome',
    cooldownMs: 0,  // No cooldown for welcome emails
    emailLogField: 'lastWelcomeEmail',

    // Query users who need this email
    async getEligibleUsers(db) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const snapshot = await db.collection('users')
        .where('createdAt', '>', oneDayAgo)
        .get();
      return snapshot.docs.map(doc => ({
        userId: doc.id,
        ...doc.data()
      }));
    },

    // Optional: additional filter
    async shouldSendToUser(userId) {
      return true;  // Send to all eligible users
    }
  }
};
```

## Firestore Collections

### `tokenProfile/{userId}` (read)
Queried to find users with exhausted tokens.

### `emailLog/{userId}` (read/write)
Tracks email sends for rate limiting:
```js
{
  userId: string,
  email: string,
  lastGeoTokenEmail: Timestamp,
  lastGenTokenEmail: Timestamp,
  // Add more fields as you add email types
  updatedAt: Timestamp
}
```

## Setup

### 1. Add Postmark API Key

```bash
firebase functions:secrets:set POSTMARK_API_KEY
```

### 2. Configure Postmark

1. Verify sender domain/email (`hello@3dstreet.com`)
2. Ensure "outbound" message stream is enabled

### 3. Deploy

```bash
# Deploy functions
firebase deploy --only functions:sendScheduledEmails,functions:triggerScheduledEmails

# Deploy Firestore rules
firebase deploy --only firestore:rules
```

## Schedule

The `sendScheduledEmails` function runs daily at **9:00 AM Pacific Time** (17:00 UTC).

To change the schedule, modify the cron expression:
```js
.schedule('0 17 * * *')  // minute hour day month weekday (UTC)
```

## Manual Triggering

For testing, use the `triggerScheduledEmails` callable function:

```js
// From client code
const trigger = firebase.functions().httpsCallable('triggerScheduledEmails');

// Process all email types
await trigger();

// Process specific types only
await trigger({ emailTypes: ['geoTokenExhaustion'] });
```

Or via Firebase CLI:
```bash
# Note: Requires authentication setup
firebase functions:shell
> triggerScheduledEmails({})
```

## Local Testing

### Using Emulators

1. Start emulators:
```bash
cd public/functions
npm run serve
```

2. The scheduled function won't auto-run in emulators. Use the callable trigger:
```js
// In your test script
const { triggerScheduledEmails } = require('./scheduledEmails');
// Mock the context and call directly
```

### Testing with Real Postmark

Create `public/functions/.env`:
```
POSTMARK_API_KEY=your-test-api-key
```

Use Postmark's test mode or sandbox server.

## Viewing Logs

```bash
# View scheduled function logs
firebase functions:log --only sendScheduledEmails

# Stream logs in real-time
firebase functions:log --only sendScheduledEmails --follow
```

## Monitoring

### Success Metrics
- Check Postmark Activity for delivery stats
- Function logs show sent/skipped counts per email type

### Log Output Example
```
Starting scheduled email job
Processing email type: geoTokenExhaustion
Found 15 eligible users for geoTokenExhaustion
Sent geoTokenExhaustion email to user@example.com: abc123
Completed geoTokenExhaustion: {"type":"geoTokenExhaustion","processed":15,"sent":3,"skipped":{"cooldown":10,"noEmail":1,"filtered":1,"error":0}}
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No emails sent | All users in cooldown | Check `emailLog` collection |
| No emails sent | All users are PRO | Expected behavior |
| Postmark 401 | Invalid API key | Verify secret |
| Postmark 422 | Invalid sender | Verify sender in Postmark |
| Function timeout | Too many users | Increase `timeoutSeconds` or batch |

## Cost Optimization

This scheduled approach is more cost-effective than trigger-based:

| Approach | Invocations/month | Notes |
|----------|-------------------|-------|
| Firestore trigger | ~N token operations | Fires on every update |
| Scheduled (daily) | ~30 | One query per email type |

## Security

- `emailLog` collection denies all client access (Cloud Functions only)
- User emails retrieved from Firebase Auth, not Firestore
- API key stored as Cloud Secret
- Manual trigger requires authentication
