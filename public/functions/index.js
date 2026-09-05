const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();
const { getGeoidHeight } = require('./geoid-height.js');
const { generateReplicateImage, generateReplicateVideo, generateReplicateSplat, getGenerationJobStatus, setGenerationJobNotify, replicateJobWebhook, modalJobWebhook, falJobWebhook } = require('./replicate.js');
const { checkAndRefillImageTokens, checkUserProStatus } = require('./token-management.js');
const { createStripeSession, checkActiveSubscriptions, createStripeBillingPortal, handleSubscriptionWebhook, stripeWebhook } = require('./stripe.js');
const { generateFalImage } = require('./fal-proxy.js');
const { generateFalMesh } = require('./fal-3d.js');
const { assertAppCheck } = require('./app-check.js');
const { sendScheduledEmails, triggerScheduledEmails } = require('./scheduled/scheduledEmails.js');
const { triggerLifecycleEmail, postmarkSubscriptionWebhook } = require('./email/lifecycle-email.js');
const { sendWelcomeEmail } = require('./email/lifecycle-triggers.js');
const { lifecycleEmailSweep, triggerLifecycleSweep } = require('./email/lifecycle-sweeps.js');
const { auditUserSubscriptions, auditUserSubscriptionsHttp } = require('./utilities/user-audit.js');
const { onAssetWritten, getUploadQuota } = require('./asset-quota.js');
const { purgeSoftDeletedAssets, triggerPurgeSoftDeletedAssets } = require('./scheduled/asset-gc.js');
const { reconcileAssetUsage, triggerReconcileAssetUsage } = require('./scheduled/asset-usage-reconcile.js');
const { checkAssetUsageHealth, triggerCheckAssetUsageHealth } = require('./scheduled/asset-usage-health.js');
const { cleanupOrphanedStorage, triggerCleanupOrphanedStorage } = require('./scheduled/asset-orphan-cleanup.js');
const { reconcileGenerationJobs, triggerReconcileGenerationJobs } = require('./scheduled/generation-job-reconcile.js');
const { onSplatAssetCreated } = require('./rad-dispatch.js');
const { generateEditorChat } = require('./ai-chat-proxy.js');

// Re-export the getGeoidHeight function
exports.getGeoidHeight = getGeoidHeight;

// Re-export the Replicate functions
exports.generateReplicateImage = generateReplicateImage;
exports.generateReplicateVideo = generateReplicateVideo;
exports.generateReplicateSplat = generateReplicateSplat;
exports.getGenerationJobStatus = getGenerationJobStatus;
exports.setGenerationJobNotify = setGenerationJobNotify;
exports.replicateJobWebhook = replicateJobWebhook;
exports.modalJobWebhook = modalJobWebhook;
exports.falJobWebhook = falJobWebhook;

// Re-export the token management functions
exports.checkAndRefillImageTokens = checkAndRefillImageTokens;
exports.checkUserProStatus = checkUserProStatus;

// Re-export the Stripe billing functions (checkout, portal, webhooks) — see stripe.js
exports.createStripeSession = createStripeSession;
exports.checkActiveSubscriptions = checkActiveSubscriptions;
exports.createStripeBillingPortal = createStripeBillingPortal;
exports.handleSubscriptionWebhook = handleSubscriptionWebhook;
exports.stripeWebhook = stripeWebhook;

// Re-export the fal.ai proxy function
exports.generateFalImage = generateFalImage;

// Re-export the fal.ai 3D mesh generation function
exports.generateFalMesh = generateFalMesh;

// Re-export the scheduled email functions
exports.sendScheduledEmails = sendScheduledEmails;
exports.triggerScheduledEmails = triggerScheduledEmails;

// Lifecycle emails — admin test callable, Postmark Subscription Change
// webhook (opt-outs → emailPrefs), welcome-on-signup trigger, and the hourly
// sweep for time-based emails. See docs/email-lifecycle.md.
exports.triggerLifecycleEmail = triggerLifecycleEmail;
exports.postmarkSubscriptionWebhook = postmarkSubscriptionWebhook;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.lifecycleEmailSweep = lifecycleEmailSweep;
exports.triggerLifecycleSweep = triggerLifecycleSweep;

// Re-export the user audit functions
exports.auditUserSubscriptions = auditUserSubscriptions;
exports.auditUserSubscriptionsHttp = auditUserSubscriptionsHttp;

// Asset upload quota tracking (Firestore trigger + callable pre-flight)
exports.onAssetWritten = onAssetWritten;
exports.getUploadQuota = getUploadQuota;

// Asset garbage collection (daily scheduled + admin-only manual trigger)
exports.purgeSoftDeletedAssets = purgeSoftDeletedAssets;
exports.triggerPurgeSoftDeletedAssets = triggerPurgeSoftDeletedAssets;

// Asset storage usage reconciliation (weekly scheduled + admin-only manual trigger)
exports.reconcileAssetUsage = reconcileAssetUsage;
exports.triggerReconcileAssetUsage = triggerReconcileAssetUsage;

// Storage usage health probe — daily growth + over-cap awareness on System Health
exports.checkAssetUsageHealth = checkAssetUsageHealth;
exports.triggerCheckAssetUsageHealth = triggerCheckAssetUsageHealth;

// Orphaned Storage object cleanup (monthly scheduled + admin-only manual trigger)
exports.cleanupOrphanedStorage = cleanupOrphanedStorage;
exports.triggerCleanupOrphanedStorage = triggerCleanupOrphanedStorage;

// Async generation job reconciliation — dropped-webhook backstop for splat (and
// future async kinds). Every 10 min scheduled + admin-only manual trigger.
exports.reconcileGenerationJobs = reconcileGenerationJobs;
exports.triggerReconcileGenerationJobs = triggerReconcileGenerationJobs;

// --- RAD conversion (splat optimized variant) -----------------------------
exports.onSplatAssetCreated = onSplatAssetCreated;

// Editor AI Assistant — server-side gate for the Vertex/Gemini chat. The client
// no longer calls Firebase AI Logic directly (model selection was abusable); all
// model access now goes through this authenticated, rate-limited, model-locked
// callable. See ai-chat-proxy.js.
exports.generateEditorChat = generateEditorChat;

exports.getScene = functions
  .https
  .onRequest(async (req, res) => {
    // Extract scene id from the path, remove the .json part
    res.set('Access-Control-Allow-Origin', '*');
    const documentId = req.path
      .split('/')
      .filter(Boolean)[1]
      .replace('.json', '');
    if (!documentId) {
      res.status(400).send({ error: 'Scene ID is required' });
      return;
    }

    try {
      const doc = await admin
        .firestore()
        .collection('scenes')
        .doc(documentId)
        .get();
      if (!doc.exists) {
        res
          .status(404)
          .send({ error: `Scene not found. DocumentID: ${documentId}` });
      } else {
        res.send(doc.data());
      }
    } catch {
      res.status(500).send({ error: 'Error retrieving scene' });
    }
  });

// Discord webhook function for sharing scenes
exports.shareToDiscord = functions
  .runWith({ secrets: ['DISCORD_WEBHOOK_URL'] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to share scenes.');
    }
    assertAppCheck(context);

    const { title, location, username, sceneUrl, imageUrl } = data;

    // Validate required data
    if (!title || !username || !sceneUrl) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required scene data.');
    }

    // Create Discord message with embed for rich preview
    const message = {
      content: `🙋 **${username}** shared a new scene!`,
      embeds: [{
        title: title,
        description: location ? `📍 ${location}` : undefined,
        url: sceneUrl,
        color: 0x6366F1, // Indigo color for the embed stripe
        image: imageUrl ? {
          url: imageUrl
        } : undefined,
        footer: {
          text: '3DStreet',
          icon_url: 'https://3dstreet.app/favicon-32x32.png'
        },
        timestamp: new Date().toISOString()
      }]
    };

    try {
      const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      return { success: true, message: 'Scene shared to Discord successfully!' };
    } catch (error) {
      console.error('Error sharing to Discord:', error);
      throw new functions.https.HttpsError('internal', 'Failed to share scene to Discord.');
    }
  });
