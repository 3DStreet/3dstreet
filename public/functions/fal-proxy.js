const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { REPLICATE_MODELS } = require('./replicate-models.js');
const { assertAppCheck } = require('./app-check.js');
// Shared fal plumbing: webhook-attached queue submit URL, submit-failure
// refund, and gallery-metadata sanitizer. One-directional require (fal-3d.js
// requires nothing from this module), so there's no cycle.
const {
  falQueueSubmitUrl,
  refundFalJobInline,
  sanitizeGalleryMetadata,
  sanitizeNotifyBatch
} = require('./fal-3d.js');

// fal.ai image generation (flux-2 edit family). Asynchronous since #1835:
// stage the input, write a pending `kind: 'image'` / `provider: 'fal'` job to
// the async queue, charge tokens at submit (refunded once on failure), submit
// to fal's queue (with a completion webhook, #1832), and return the jobId
// immediately. The old synchronous form polled fal inline for up to ~4 min
// while the client saved the result to the gallery itself — a closed
// tab/modal lost the image. Completion (gallery save + Discord post) now
// happens server-side in the shared terminal processor
// (replicate.js:processTerminalPrediction, kind 'image'), reached by the fal
// webhook, the client poll, and the reconciler via fetchFalPrediction.
const generateFalImage = functions
  .runWith({
    secrets: ['FAL_KEY'],
    // Submit-and-return: only stages the image + submits, so no long poll.
    timeoutSeconds: 120
  })
  .https
  .onCall(async (data, context) => {

    // Check if required secrets are loaded
    if (!process.env.FAL_KEY) {
      console.error('CRITICAL: FAL_KEY secret not loaded');
      throw new functions.https.HttpsError('failed-precondition', 'Image generation service is not properly configured.');
    }

    // Verify user is authenticated
    if (!context.auth) {
      console.error('Unauthenticated request to generateFalImage');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to generate images.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const {
      prompt,
      input_image,
      model_id,
      scene_id,
      source = 'generator',
      guidance_scale = 2.5,
      num_inference_steps = 28,
      image_size = { width: 1600, height: 900 }, // 16:9 widescreen default
      notify,
      gallery_metadata
    } = data;

    // Opt-in completion email — default OFF for images (they usually render
    // in seconds; see generateReplicateImage).
    const wantsEmail = notify?.email === true;

    // Get the model configuration
    const modelConfig = REPLICATE_MODELS[model_id];
    if (!modelConfig || modelConfig.type !== 'fal') {
      console.error(`Invalid fal.ai model: ${model_id}`);
      throw new functions.https.HttpsError('invalid-argument', `Invalid model: ${model_id}`);
    }

    const tokenCost = modelConfig.tokenCost || 2;

    let tokenData;
    try {
      // Use the centralized token management function to handle pro users, token refilling, and profile creation
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (tokenError) {
      console.error(`Error retrieving token data for user ${userId}:`, tokenError);
      throw new functions.https.HttpsError('internal', `Failed to retrieve token information: ${tokenError.message}`);
    }

    // Check if tokenData is null or undefined
    if (!tokenData) {
      console.error(`Failed to get token data for user ${userId} - tokenData is null/undefined`);
      throw new functions.https.HttpsError('internal', 'Failed to retrieve token information. Please try again.');
    }

    if (!tokenData.genToken || tokenData.genToken < tokenCost) {
      throw new functions.https.HttpsError('resource-exhausted', `Not enough generation tokens. This model requires ${tokenCost} token(s), but you have ${tokenData.genToken || 0}.`);
    }

    // Validate required data - prompt is always required, input_image is required for edit models
    if (!prompt) {
      console.error(`Missing required prompt`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required prompt.');
    }

    // fal.ai edit models require an input image
    if (!input_image) {
      console.error(`Missing required input image for fal.ai edit model: ${model_id}`);
      throw new functions.https.HttpsError('invalid-argument', 'This model requires a source image. Please upload a reference image.');
    }

    const db = admin.firestore();
    // jobId (a uuid) is the Firestore doc id; the fal request_id is stored as
    // providerJobId. Frozen at submit so the webhook/poll/reconciler converge.
    const jobId = crypto.randomUUID();
    const webhookSecret = crypto.randomUUID();
    const jobRef = db
      .collection('users')
      .doc(userId)
      .collection('generationJobs')
      .doc(jobId);

    // Stable names for the saved gallery asset, fixed at submit so every
    // finalize path produces identical metadata.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const originalFilename = `ai-image-${stamp}.jpg`;
    const assetName = `AI Image ${stamp}`;

    let tempImagePath = null;

    try {
      let imageUrl = null;

      // If input_image is a base64 data URL, upload it to Firebase Storage
      // first. The staged path is recorded on the job doc (tempFilePath) and
      // deleted by the terminal processor when the job finishes.
      if (input_image.startsWith('data:image/')) {
        // Extract the base64 data and mime type
        const matches = input_image.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new functions.https.HttpsError('invalid-argument', 'Invalid base64 image format.');
        }

        const mimeType = matches[1];
        const base64Data = matches[2];
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Generate a unique filename
        const timestamp = Date.now();
        const filename = `temp-fal-input-${context.auth.uid}-${timestamp}.jpg`;
        tempImagePath = `temp/${filename}`;

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const file = bucket.file(tempImagePath);

        await file.save(imageBuffer, {
          metadata: {
            contentType: mimeType,
            // Set to expire in 1 hour
            expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          }
        });

        // Make the file publicly readable
        await file.makePublic();

        // Get the public URL
        imageUrl = `https://storage.googleapis.com/${bucket.name}/${tempImagePath}`;
      } else {
        // input_image is already a URL
        imageUrl = input_image;
      }

      // Write the pending job BEFORE charging/submitting, mirroring the other
      // submit paths — a crash mid-submit becomes a visible, reconcilable row.
      await jobRef.set({
        status: 'queued',
        providerStatus: null,
        kind: 'image',
        provider: 'fal',
        providerJobId: null,
        statusUrl: null,
        responseUrl: null,
        model: modelConfig.name,
        modelId: model_id,
        endpoint: modelConfig.endpoint,
        source,
        tokenCost,
        tokenCharged: false,
        refunded: false,
        tempFilePath: tempImagePath || null,
        webhookSecret,
        originalFilename,
        assetName,
        // Everything the terminal processor needs to finish the job without a
        // browser: gallery generationMetadata + the Discord post inputs.
        generationParams: {
          model_id,
          model_name: modelConfig.name,
          prompt,
          guidance: guidance_scale,
          num_inference_steps,
          scene_id: scene_id || null
        },
        // Client extras merged into the saved asset's generationMetadata (the
        // editor's sceneTitle/cameraState/renderMode — see saveImageToGallery).
        galleryMetadata: sanitizeGalleryMetadata(gallery_metadata),
        notify: {
          email: wantsEmail,
          pending: wantsEmail,
          // Editor 4x renders stamp a shared batch identity so the whole
          // batch produces at most one email (first finisher decides).
          ...sanitizeNotifyBatch(notify)
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Charge at submit and set `tokenCharged` in the same transaction, so
      // every later refund path (poll, webhook, reconciler) observes
      // tokenCharged:true and refunds exactly once.
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      let remainingTokens = 0;
      let tokensBefore = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);
        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }
        const currentTokens = tokenDoc.data().genToken || 0;
        tokensBefore = currentTokens;
        if (currentTokens < tokenCost) {
          throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
        }
        remainingTokens = Math.max(0, currentTokens - tokenCost);
        transaction.update(tokenProfileRef, {
          genToken: remainingTokens,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        transaction.update(jobRef, { tokenCharged: true });
      });

      // Fire-and-forget: write token deduction audit log
      db.collection('tokenLog')
        .add({
          userId,
          type: 'deduction',
          tokensBefore,
          tokensAfter: remainingTokens,
          tokenCost,
          source: 'image-generation',
          relatedModel: modelConfig.name,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
        .catch((err) => console.error('Failed to write tokenLog:', err));

      // Build the fal.ai request payload
      const falPayload = {
        prompt: prompt,
        image_urls: [imageUrl],
        image_size: image_size, // Preset string or {width, height} object
        guidance_scale: guidance_scale,
        num_inference_steps: num_inference_steps,
        enable_safety_checker: true,
        output_format: 'jpeg'
      };

      // Add LoRA configuration if model has loras
      if (modelConfig.loras && modelConfig.loras.length > 0) {
        falPayload.loras = modelConfig.loras;
      }

      console.log(`Submitting fal.ai image job for user ${userId} with model ${model_id} (cost: ${tokenCost} tokens)`);

      // Submit the request to fal.ai queue. fal_webhook makes fal call
      // falJobWebhook on completion for real-time finalize + email; the client
      // poll and the reconciler remain as backstops.
      const submitResponse = await fetch(
        falQueueSubmitUrl(modelConfig.endpoint, {
          jobId,
          userId,
          webhookSecret
        }),
        {
          method: 'POST',
          headers: {
            'Authorization': `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(falPayload)
        }
      );

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error(`fal.ai submit error: ${submitResponse.status} - ${errorText}`);
        throw new Error(`fal.ai API error: ${submitResponse.status}`);
      }

      const submitResult = await submitResponse.json();
      const requestId = submitResult.request_id;
      const statusUrl = submitResult.status_url;
      const responseUrl = submitResult.response_url;

      if (!requestId || !statusUrl || !responseUrl) {
        console.error('Missing required fields in fal.ai response:', JSON.stringify(submitResult, null, 2));
        throw new Error('Invalid response from fal.ai - missing request_id, status_url, or response_url');
      }

      // Record the provider identity so the webhook/poll/reconciler can
      // finalize it.
      await jobRef.update({
        providerJobId: requestId,
        statusUrl,
        responseUrl,
        providerStatus: 'IN_QUEUE'
      });

      return {
        success: true,
        jobId,
        status: 'queued',
        remainingTokens
      };
    } catch (error) {
      console.error('Error submitting image to fal.ai:', error.message);

      // Refund if we already charged, and finalize the job as failed so it
      // doesn't sit non-terminal until the reconciler's give-up window.
      await refundFalJobInline(db, userId, jobRef, tokenCost);
      await jobRef
        .update({
          status: 'failed',
          error: error.message,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        })
        .catch(() => {});

      // Best-effort temp cleanup.
      if (tempImagePath) {
        admin
          .storage()
          .bucket()
          .file(tempImagePath)
          .delete()
          .catch(() => {});
      }

      // Fire-and-forget: write failed generation audit log
      admin.firestore().collection('generationLog').add({
        userId,
        provider: 'fal',
        model: modelConfig.endpoint,
        modelId: model_id,
        generationType: 'image',
        tokenCost,
        status: 'failed',
        error: error.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      // Check if it's a Firebase HttpsError and rethrow
      if (
        error.code &&
        (error.code.startsWith('resource-exhausted') ||
          error.code.startsWith('unauthenticated') ||
          error.code.startsWith('invalid-argument') ||
          error.code.startsWith('failed-precondition') ||
          error.code.startsWith('not-found'))
      ) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', `Failed to generate image: ${error.message}`);
    }
  });

module.exports = { generateFalImage };
