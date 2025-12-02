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

### Token Exhaustion (`tokenExhaustion`)

Sends ONE email per user, ever, when they exhaust either token type.

| Condition | Template Used |
|-----------|---------------|
| `genToken == 0` | AI token exhaustion (prioritized) |
| `geoToken == 0` | Geo token exhaustion |

**Behavior:**
- Queries users with `geoToken == 0` OR `genToken == 0`
- Skips PRO users
- Sends only ONE email per user lifetime (tracked via `tokenExhaustionEmailSent`)
- Selects template based on which token is exhausted (AI prioritized if both)

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
    emailLogField: 'welcomeEmailSent',  // Track in emailLog

    // Query users who need this email
    async getEligibleUsers(db) {
      const snapshot = await db.collection('users')
        .where('emailVerified', '==', true)
        .get();
      return snapshot.docs.map(doc => ({
        userId: doc.id,
        ...doc.data()
      }));
    },

    // Optional: additional filter
    async shouldSendToUser(userId) {
      return true;
    },

    // Static template (or use getTemplateKey for dynamic selection)
    templateKey: 'welcome'
  }
};
```

### Dynamic Template Selection

For email types that select different templates based on user data:

```js
myEmailType: {
  emailLogField: 'myEmailSent',
  async getEligibleUsers(db) { ... },

  // Dynamic template selection based on user data
  getTemplateKey(userData) {
    if (userData.someCondition) {
      return 'templateA';
    }
    return 'templateB';
  }
}
```

## Firestore Collections

### `tokenProfile/{userId}` (read)
Queried to find users with exhausted tokens.

### `emailLog/{userId}` (read/write)
Tracks email sends:
```js
{
  userId: string,
  email: string,
  tokenExhaustionEmailSent: Timestamp,  // If exists, email was sent
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

The `sendScheduledEmails` function runs daily at **9:00 AM Pacific Time**.

To change the schedule, modify the cron expression:
```js
.schedule('0 9 * * *')  // minute hour day month weekday (in configured timezone)
```

## Manual Triggering

For testing, use the `triggerScheduledEmails` callable function:

```js
// From client code (browser console on 3dstreet.app or dev site)
const trigger = firebase.functions().httpsCallable('triggerScheduledEmails');

// DRY RUN (default) - see what would be sent without actually sending
const dryRunResult = await trigger({ dryRun: true });
console.log(dryRunResult.data);
// Returns: { success: true, dryRun: true, results: [{ type: 'tokenExhaustion', wouldSend: [...], ... }] }

// ACTUALLY SEND emails (must explicitly set dryRun: false)
await trigger({ dryRun: false });

// Process specific types only
await trigger({ emailTypes: ['tokenExhaustion'], dryRun: true });
```

**Important:** The function defaults to `dryRun: true` for safety. You must explicitly pass `dryRun: false` to send real emails.

## Viewing Logs

```bash
# View scheduled function logs
firebase functions:log --only sendScheduledEmails

# Stream logs in real-time
firebase functions:log --only sendScheduledEmails --follow
```

## Monitoring

### Log Output Example
```
Starting scheduled email job
Processing email type: tokenExhaustion
Found 15 eligible users for tokenExhaustion
Sent tokenExhaustion (genTokenExhaustion) email to user@example.com: abc123
Completed tokenExhaustion: {"type":"tokenExhaustion","processed":15,"sent":3,"skipped":{"alreadySent":10,"noEmail":1,"filtered":1,"error":0}}
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No emails sent | All users already emailed | Check `emailLog` collection |
| No emails sent | All users are PRO | Expected behavior |
| Postmark 401 | Invalid API key | Verify secret |
| Postmark 422 | Invalid sender | Verify sender in Postmark |

## Security

- `emailLog` collection denies all client access (Cloud Functions only)
- User emails retrieved from Firebase Auth, not Firestore
- API key stored as Cloud Secret
- Manual trigger requires authentication
