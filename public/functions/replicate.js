const functions = require('firebase-functions/v1');
const Replicate = require('replicate');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { AI_MODEL_NAMES, DEFAULT_MODEL_VERSION, MODEL_VERSIONS, REPLICATE_MODELS } = require('./replicate-models.js');
const { assertAppCheck } = require('./app-check.js');
// Modal compute backend — vid2scene runs there (Replicate's on-demand tier
// preempts long jobs). Provider adapter only; the job/billing machinery in
// this file is shared across providers.
const { MODAL_SECRETS, enqueueModalJob, fetchModalPrediction } = require('./modal-backend.js');
// Real-time completion email: the webhook calls this the instant a job finishes
// so the user isn't waiting on the 10-min reconciler sweep. Shared, idempotent
// send (the sweep is the backstop). No circular dep: scheduledEmails doesn't
// require this module.
const { sendGenerationReadyEmail } = require('./scheduled/scheduledEmails.js');

// Helper function to post AI-generated images to Discord
async function postAIImageToDiscord(userId, imageUrl, prompt, modelVersion, sceneId, source = 'editor') {
  // Only proceed if Discord webhook is configured
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.log('Discord webhook not configured, skipping Discord post');
    return;
  }

  try {
    // Get username from social profile
    const db = admin.firestore();
    const socialProfileRef = db.collection('socialProfile').doc(userId);
    const socialProfileDoc = await socialProfileRef.get();

    let username = 'anonymous';
    if (socialProfileDoc.exists) {
      username = socialProfileDoc.data().username || 'anonymous';
    }

    // Get model name from version ID
    const modelName = AI_MODEL_NAMES[modelVersion] || 'AI Model';

    // Truncate prompt if it's too long for Discord
    const truncatedPrompt = prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;

    // Construct scene URL if sceneId is provided
    const sceneUrl = sceneId ? `https://3dstreet.app/#scenes/${sceneId}` : null;

    // Determine footer text based on source parameter
    // Default to 'editor' for backwards compatibility
    const footerText = source === 'generator' ? '3DStreet AI Generator' : '3DStreet Editor Snapshot AI Render';

    // Create Discord message with embed
    const message = {
      content: `🎨 **${username}** generated a new AI image!`,
      embeds: [{
        title: `${modelName} Render`,
        description: `**Prompt:** ${truncatedPrompt}`,
        url: sceneUrl, // Add clickable link to the scene
        color: 0x9333EA, // Purple color for AI generations
        image: {
          url: imageUrl
        },
        footer: {
          text: footerText,
          icon_url: 'https://3dstreet.app/favicon-32x32.png'
        },
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error(`Discord API error: ${response.status}`);
    } else {
      console.log(`AI image successfully posted to Discord for user ${userId}`);
    }
  } catch (error) {
    // Don't throw error - we don't want Discord posting to fail the image generation
    console.error('Error posting AI image to Discord:', error);
  }
}

// Helper function to post AI-generated videos to Discord
async function postAIVideoToDiscord(userId, videoUrl, prompt, modelName, durationSeconds, sceneId) {
  // Only proceed if Discord webhook is configured
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.log('Discord webhook not configured, skipping Discord post');
    return;
  }

  try {
    // Get username from social profile
    const db = admin.firestore();
    const socialProfileRef = db.collection('socialProfile').doc(userId);
    const socialProfileDoc = await socialProfileRef.get();

    let username = 'anonymous';
    if (socialProfileDoc.exists) {
      username = socialProfileDoc.data().username || 'anonymous';
    }

    // Truncate prompt if it's too long for Discord
    const truncatedPrompt = prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;

    // Construct scene URL if sceneId is provided
    const sceneUrl = sceneId ? `https://3dstreet.app/#scenes/${sceneId}` : null;

    // Create Discord message with video
    // Include video URL in description so Discord can auto-embed it
    const message = {
      content: `🎬 **${username}** generated a new AI video!\n${videoUrl}`,
      embeds: [{
        title: `${modelName} Video (${durationSeconds}s)`,
        description: `**Prompt:** ${truncatedPrompt}`,
        url: sceneUrl, // Add clickable link to the scene
        color: 0x3B82F6, // Blue color for video generations
        footer: {
          text: 'AI Video Generator',
          icon_url: 'https://3dstreet.app/favicon-32x32.png'
        },
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error(`Discord API error: ${response.status}`);
    } else {
      console.log(`AI video successfully posted to Discord for user ${userId}`);
    }
  } catch (error) {
    // Don't throw error - we don't want Discord posting to fail the video generation
    console.error('Error posting AI video to Discord:', error);
  }
}

// Replicate API function for image generation
const generateReplicateImage = functions
  .runWith({
    secrets: ["REPLICATE_API_TOKEN", "ALLOWED_PRO_TEAM_DOMAINS", "DISCORD_WEBHOOK_URL"],
    timeoutSeconds: 300 // 5 minutes - image generation can take several minutes
  })
  .https
  .onCall(async (data, context) => {

    // Check if required secrets are loaded
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('CRITICAL: REPLICATE_API_TOKEN secret not loaded');
      throw new functions.https.HttpsError('failed-precondition', 'Image generation service is not properly configured.');
    }

    // Verify user is authenticated
    if (!context.auth) {
      console.error('Unauthenticated request to generateReplicateImage');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to generate images.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const { prompt, input_image, guidance = 2.5, num_inference_steps = 30, model_version, model_id, scene_id, source = 'editor' } = data;

    // Determine the model to use and its token cost
    // First try model_id (key-based lookup), then fall back to model_version (hash-based lookup)
    let modelConfig = null;
    let modelVersionToUse = null;

    if (model_id && REPLICATE_MODELS[model_id]) {
      modelConfig = REPLICATE_MODELS[model_id];
      modelVersionToUse = modelConfig.version || null; // May be null for modelName-based models
    }

    if (!modelConfig) {
      modelVersionToUse = model_version || DEFAULT_MODEL_VERSION;
      modelConfig = Object.values(REPLICATE_MODELS).find(m => m.version === modelVersionToUse);
    }

    const tokenCost = modelConfig?.tokenCost || 1; // Default to 1 if not found

    let tokenData;
    try {
      // Use the centralized token management function to handle pro users, token refilling, and profile creation
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (tokenError) {
      console.error(`Error retrieving token data for user ${userId}:`, tokenError);
      console.error('Token error stack:', tokenError.stack);
      throw new functions.https.HttpsError('internal', `Failed to retrieve token information: ${tokenError.message}`);
    }

    // Check if tokenData is null or undefined (error in token management)
    if (!tokenData) {
      console.error(`Failed to get token data for user ${userId} - tokenData is null/undefined`);
      throw new functions.https.HttpsError('internal', 'Failed to retrieve token information. Please try again.');
    }


    if (!tokenData.genToken || tokenData.genToken < tokenCost) {
        throw new functions.https.HttpsError('resource-exhausted', `Not enough generation tokens. This model requires ${tokenCost} token(s), but you have ${tokenData.genToken || 0}.`);
    }

    // Validate required data - prompt is always required, input_image is optional
    if (!prompt) {
      console.error(`Missing required prompt`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required prompt.');
    }


    const db = admin.firestore();
    let prediction;
    let generationStartTime;

    try {
      // Check if Replicate API token is available
      if (!process.env.REPLICATE_API_TOKEN) {
        console.error('REPLICATE_API_TOKEN is not configured');
        throw new functions.https.HttpsError('failed-precondition', 'Image generation service is not configured. Please contact support.');
      }

      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
        useFileOutput: false
      });

      let imageUrl = input_image;

      // If input_image is a base64 data URL, upload it to Firebase Storage first
      if (input_image && input_image.startsWith('data:image/')) {

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
        const filename = `temp-ai-input-${context.auth.uid}-${timestamp}.jpg`;

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const file = bucket.file(`temp/${filename}`);

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
        imageUrl = `https://storage.googleapis.com/${bucket.name}/temp/${filename}`;
              }


      // Different models use different input parameter names and formats
      let modelInput = {
        prompt: prompt,
        guidance: guidance,
        num_inference_steps: num_inference_steps
      };

      // Check if this is a Nano Banana model (uses different input format)
      if (modelVersionToUse === MODEL_VERSIONS.NANO_BANANA || modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_PRO || modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_2) {
        // Nano Banana models use image_input as an array (optional)
        if (imageUrl) {
          modelInput.image_input = [imageUrl];
          modelInput.aspect_ratio = 'match_input_image';
        }
        // Nano Banana Pro and Nano Banana 2 support higher resolution
        if (modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_PRO || modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_2) {
          modelInput.resolution = '2K'; // Can be '1K', '2K', or '4K'
        }
        modelInput.output_format = 'jpg';
        // Remove parameters that Nano Banana models don't use
        delete modelInput.guidance;
        delete modelInput.num_inference_steps;
      } else if (modelVersionToUse === MODEL_VERSIONS.SEEDREAM_4 || model_id === 'seedream-4.5') {
        // Seedream uses image_input as an array and different parameters (optional)
        if (imageUrl) {
          modelInput.image_input = [imageUrl];
        }
        modelInput.size = '2K';
        // Note: output_format and aspect_ratio are omitted for seedream-4.5
        // as the API uses default aspect_ratio of match_input_image
        // Remove parameters that Seedream doesn't use
        delete modelInput.guidance;
        delete modelInput.num_inference_steps;
      } else {
        // Kontext models use input_image as string (optional)
        if (imageUrl) {
          modelInput.input_image = imageUrl;
        }
        modelInput.output_format = 'jpg';
      }

      generationStartTime = Date.now();
      if (modelConfig?.modelName) {
        // Model-name-based calling (for models without version hashes, e.g. Seedream 4.5)
        prediction = await replicate.predictions.create({
          model: modelConfig.modelName,
          input: modelInput
        });
      } else {
        prediction = await replicate.predictions.create({
          version: modelVersionToUse,
          input: modelInput
        });
      }

      // Wait for the prediction to complete
      const output = await replicate.wait(prediction);
      const generationElapsedMs = Date.now() - generationStartTime;


      // Clean up temp file if we created one
      if (input_image && input_image.startsWith('data:image/') && imageUrl !== input_image) {
        try {
          const bucket = admin.storage().bucket();
          const filename = imageUrl.split('/').pop();
          await bucket.file(`temp/${filename}`).delete();
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      // Decrement token for ALL users (only after successful image generation)
      // Pro users get monthly refills but still use tokens
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      // Use a transaction to atomically check and decrement tokens
      // This prevents negative balances when multiple requests run concurrently
      let remainingTokens = 0;
      let tokensBefore = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }

        const currentTokens = tokenDoc.data().genToken || 0;
        tokensBefore = currentTokens;

        // Check if user has enough tokens (should already be checked, but verify in transaction)
        if (currentTokens < tokenCost) {
          throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
        }

        // Calculate new token count (prevent going below 0)
        const newTokenCount = Math.max(0, currentTokens - tokenCost);
        remainingTokens = newTokenCount;

        // Update the token count
        transaction.update(tokenProfileRef, {
          genToken: newTokenCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Fire-and-forget: write generation audit log
      db.collection('generationLog').add({
        userId,
        provider: 'replicate',
        model: modelConfig?.modelName || AI_MODEL_NAMES[modelVersionToUse] || modelVersionToUse,
        generationType: 'image',
        tokenCost,
        processingTimeMs: generationElapsedMs,
        providerPredictionId: prediction.id,
        status: 'succeeded',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      // Fire-and-forget: write token deduction audit log
      db.collection('tokenLog').add({
        userId,
        type: 'deduction',
        tokensBefore,
        tokensAfter: remainingTokens,
        tokenCost,
        source: 'image-generation',
        relatedModel: modelConfig?.modelName || AI_MODEL_NAMES[modelVersionToUse] || modelVersionToUse,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write tokenLog:', err));

      // Handle different output formats from Replicate
      // The output from replicate.wait() is the prediction object with an 'output' property
      let finalImageUrl;
      if (output && output.output) {
        // The output.output can be an array or a single URL
        finalImageUrl = Array.isArray(output.output) ? output.output[0] : output.output;
      } else if (Array.isArray(output)) {
        finalImageUrl = output[0];
      } else if (typeof output === 'string') {
        finalImageUrl = output;
      } else {
        console.error('Unexpected output format from Replicate:', JSON.stringify(output, null, 2));
        console.error('Full prediction object:', JSON.stringify(prediction, null, 2));
        throw new Error('Invalid output format from Replicate API');
      }

      // Validate that we got a valid URL
      if (!finalImageUrl || typeof finalImageUrl !== 'string') {
        console.error('Invalid image URL received:', finalImageUrl);
        console.error('Full output object:', JSON.stringify(output, null, 2));
        throw new Error('No valid image URL returned from Replicate');
      }

      // Post AI-generated image to Discord (non-blocking)
      // This runs in the background and won't fail the image generation if it errors
      postAIImageToDiscord(userId, finalImageUrl, prompt, modelVersionToUse, scene_id, source)
        .catch(err => console.error('Discord posting failed:', err));

      return {
        success: true,
        image_url: finalImageUrl,
        message: 'Image generated successfully!',
        remainingTokens: remainingTokens
      };
    } catch (error) {
      console.error('Error generating image with Replicate:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);

      // Fire-and-forget: write failed generation audit log
      db.collection('generationLog').add({
        userId,
        provider: 'replicate',
        model: modelConfig?.modelName || AI_MODEL_NAMES[modelVersionToUse] || modelVersionToUse,
        generationType: 'image',
        tokenCost,
        processingTimeMs: generationStartTime ? Date.now() - generationStartTime : null,
        providerPredictionId: prediction?.id || null,
        status: 'failed',
        error: error.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      // If it's a Replicate error, include more details
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));

        // Better error message handling
        let errorMessage = 'Replicate API error';
        if (error.response.status) {
          errorMessage += `: ${error.response.status}`;
        }
        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage += ` - ${error.response.data}`;
          } else if (error.response.data.detail) {
            errorMessage += ` - ${error.response.data.detail}`;
          } else if (error.response.data.error) {
            errorMessage += ` - ${error.response.data.error}`;
          } else {
            errorMessage += ` - ${JSON.stringify(error.response.data)}`;
          }
        }

        throw new functions.https.HttpsError('internal', errorMessage);
      }

      // Check if it's a Firebase HttpsError and rethrow
      if (error.code && error.code.startsWith('resource-exhausted')) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', `Failed to generate image: ${error.message}`);
    }
  });

// Replicate API function for video generation
const generateReplicateVideo = functions
  .runWith({
    secrets: ["REPLICATE_API_TOKEN", "DISCORD_WEBHOOK_URL"],
    timeoutSeconds: 540 // 9 minutes - video generation can take several minutes
  })
  .https
  .onCall(async (data, context) => {

    // Check if required secrets are loaded
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('CRITICAL: REPLICATE_API_TOKEN secret not loaded');
      throw new functions.https.HttpsError('failed-precondition', 'Video generation service is not properly configured.');
    }

    // Verify user is authenticated
    if (!context.auth) {
      console.error('Unauthenticated request to generateReplicateVideo');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to generate videos.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const { prompt, input_image, model_name = 'lightricks/ltx-2-fast', aspect_ratio = '16:9', duration_seconds = 5 } = data;

    // Per-model token costs based on duration
    const VIDEO_TOKEN_COSTS = {
      'kwaivgi/kling-v3-video': { tokenCost5s: 20, tokenCost10s: 40 },
      'google/veo-3.1': { tokenCost5s: 20, tokenCost10s: 40 },
      'google/veo-3.1-fast': { tokenCost5s: 10, tokenCost10s: 20 },
      'bytedance/seedance-1-pro-fast': { tokenCost5s: 7, tokenCost10s: 14 },
      'wan-video/wan-2.6-i2v': { tokenCost5s: 15, tokenCost10s: 30 },
      'lightricks/ltx-2-fast': { tokenCost5s: 5, tokenCost10s: 10 }
    };

    // Calculate token cost based on model and duration
    const modelCosts = VIDEO_TOKEN_COSTS[model_name] || { tokenCost5s: 10, tokenCost10s: 20 };
    const tokenCost = duration_seconds === 10 ? modelCosts.tokenCost10s : modelCosts.tokenCost5s;

    let tokenData;
    try {
      // Use the centralized token management function
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (tokenError) {
      console.error(`Error retrieving token data for user ${userId}:`, tokenError);
      throw new functions.https.HttpsError('internal', `Failed to retrieve token information: ${tokenError.message}`);
    }

    // Check if tokenData is valid
    if (!tokenData) {
      console.error(`Failed to get token data for user ${userId} - tokenData is null/undefined`);
      throw new functions.https.HttpsError('internal', 'Failed to retrieve token information. Please try again.');
    }

    // Check if user has enough tokens for this generation
    if (!tokenData.genToken || tokenData.genToken < tokenCost) {
      throw new functions.https.HttpsError('resource-exhausted', `Insufficient tokens. This video requires ${tokenCost} tokens, but you have ${tokenData.genToken || 0}.`);
    }

    // Validate required data
    if (!prompt) {
      console.error(`Missing required data - prompt: ${!!prompt}`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required prompt.');
    }

    if (!input_image) {
      console.error(`Missing required data - input_image: ${!!input_image}`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required input image.');
    }

    const db = admin.firestore();
    let videoGenerationStartTime;

    try {
      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
        useFileOutput: false
      });

      let imageUrl = input_image;

      // If input_image is a base64 string, upload it to Firebase Storage first
      if (!input_image.startsWith('http://') && !input_image.startsWith('https://')) {
        // Assume it's base64 data (without the data URL prefix since we strip it client-side)
        // Reconstruct the data URL
        const base64Data = input_image;
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Generate a unique filename
        const timestamp = Date.now();
        const filename = `temp-video-input-${context.auth.uid}-${timestamp}.jpg`;

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const file = bucket.file(`temp/${filename}`);

        await file.save(imageBuffer, {
          metadata: {
            contentType: 'image/jpeg',
            // Set to expire in 1 hour
            expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          }
        });

        // Make the file publicly readable
        await file.makePublic();

        // Get the public URL
        imageUrl = `https://storage.googleapis.com/${bucket.name}/temp/${filename}`;
        console.log(`Uploaded input image to: ${imageUrl}`);
      }

      // Supported models
      const supportedModels = {
        'bytedance/seedance-1-pro-fast': 'SeeDance 1 Pro Fast',
        'wan-video/wan-2.2-i2v-fast': 'Wan 2.2 I2V Fast',
        'wan-video/wan-2.6-i2v': 'Wan 2.6 I2V',
        'kwaivgi/kling-v2.5-turbo-pro': 'Kling v2.5 Turbo Pro',
        'kwaivgi/kling-v3-video': 'Kling v3.0 Pro',
        'lightricks/ltx-2-fast': 'LTX-2 Fast',
        'google/veo-3.1': 'Veo 3.1',
        'google/veo-3.1-fast': 'Veo 3.1 Fast'
      };

      // Validate model name
      if (!supportedModels[model_name]) {
        throw new functions.https.HttpsError('invalid-argument', `Unsupported model: ${model_name}`);
      }

      // Prepare model input based on the model
      const modelInput = {
        prompt: prompt,
        image: imageUrl, // Add the image URL
      };

      // Add model-specific parameters
      if (model_name === 'bytedance/seedance-1-pro-fast') {
        // SeeDance model parameters
        modelInput.aspect_ratio = aspect_ratio;
        modelInput.duration = duration_seconds; // SeeDance accepts 2-12 seconds
        modelInput.resolution = '1080p'; // Use highest quality
        // Note: SeeDance does not support audio control parameters
      } else if (model_name === 'wan-video/wan-2.2-i2v-fast') {
        // Wan Video 2.2 model parameters (legacy)
        modelInput.resolution = '720p'; // 720p or 480p
        modelInput.go_fast = true;
        // Map duration to num_frames (at 16 fps default)
        // 5 seconds = 80 frames, 10 seconds = 160 frames
        // Model accepts 81-121 frames, so cap at 121 for 10s
        modelInput.num_frames = duration_seconds === 10 ? 121 : 81;
        modelInput.frames_per_second = 16;
        modelInput.interpolate_output = true;
      } else if (model_name === 'wan-video/wan-2.6-i2v') {
        // Wan Video 2.6 model parameters
        modelInput.resolution = '1080p';
        modelInput.duration = duration_seconds;
      } else if (model_name === 'kwaivgi/kling-v2.5-turbo-pro') {
        // Kling v2.5 model parameters (legacy) - uses start_image instead of image
        delete modelInput.image;
        modelInput.start_image = imageUrl;
        modelInput.aspect_ratio = aspect_ratio;
        modelInput.duration = duration_seconds;
      } else if (model_name === 'kwaivgi/kling-v3-video') {
        // Kling v3.0 model parameters - uses start_image instead of image
        delete modelInput.image;
        modelInput.start_image = imageUrl;
        modelInput.mode = 'pro';
        modelInput.aspect_ratio = aspect_ratio;
        modelInput.duration = duration_seconds;
      } else if (model_name === 'lightricks/ltx-2-fast') {
        // LTX model parameters - uses duration in seconds (not frames or aspect_ratio)
        // LTX accepts: 6, 8, 10, 12, 14, 16, 18, or 20 seconds
        // We'll map our 5/10 second options to 6/10 for LTX
        modelInput.duration = duration_seconds === 10 ? 10 : 6;
        modelInput.generate_audio = false; // LTX is the only model that supports audio control
      } else if (model_name === 'google/veo-3.1' || model_name === 'google/veo-3.1-fast') {
        // Veo 3.1 model parameters
        // Veo accepts duration: 4, 6, or 8 seconds only
        modelInput.aspect_ratio = aspect_ratio;
        modelInput.duration = duration_seconds <= 5 ? 4 : 8;
        modelInput.generate_audio = false;
      }

      console.log(`Generating ${duration_seconds}s video for user ${userId} with model ${model_name} (tokenCost: ${tokenCost})`);
      console.log('Model input parameters:', JSON.stringify(modelInput, null, 2));

      // Use run() with model name instead of predictions.create with version
      videoGenerationStartTime = Date.now();
      const output = await replicate.run(model_name, {
        input: modelInput
      });
      const videoGenerationElapsedMs = Date.now() - videoGenerationStartTime;

      console.log(`Video generation completed for user ${userId}`);

      // Decrement tokens for ALL users (only after successful video generation)
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      let remainingTokens = 0;
      let videoTokensBefore = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }

        const currentTokens = tokenDoc.data().genToken || 0;
        videoTokensBefore = currentTokens;

        // Verify user still has enough tokens (double-check after generation)
        if (currentTokens < tokenCost) {
          throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
        }

        // Deduct the appropriate number of tokens based on duration
        const newTokenCount = Math.max(0, currentTokens - tokenCost);
        remainingTokens = newTokenCount;

        transaction.update(tokenProfileRef, {
          genToken: newTokenCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Fire-and-forget: write generation audit log
      db.collection('generationLog').add({
        userId,
        provider: 'replicate',
        model: model_name,
        generationType: 'video',
        tokenCost,
        processingTimeMs: videoGenerationElapsedMs,
        providerPredictionId: null, // replicate.run() doesn't expose prediction ID; use predictions.create() if needed
        status: 'succeeded',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      // Fire-and-forget: write token deduction audit log
      db.collection('tokenLog').add({
        userId,
        type: 'deduction',
        tokensBefore: videoTokensBefore,
        tokensAfter: remainingTokens,
        tokenCost,
        source: 'video-generation',
        relatedModel: model_name,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write tokenLog:', err));

      // Handle different output formats from Replicate
      let finalVideoUrl;
      if (output && output.output) {
        finalVideoUrl = Array.isArray(output.output) ? output.output[0] : output.output;
      } else if (Array.isArray(output)) {
        finalVideoUrl = output[0];
      } else if (typeof output === 'string') {
        finalVideoUrl = output;
      } else {
        console.error('Unexpected output format from Replicate:', output);
        throw new Error('Invalid output format from Replicate API');
      }

      console.log(`Video generation successful for user ${userId}: ${finalVideoUrl}`);

      // Post AI-generated video to Discord (non-blocking)
      // This runs in the background and won't fail the video generation if it errors
      const readableModelName = supportedModels[model_name] || model_name;
      postAIVideoToDiscord(userId, finalVideoUrl, prompt, readableModelName, duration_seconds, data.scene_id)
        .catch(err => console.error('Discord posting failed:', err));

      return {
        success: true,
        video_url: finalVideoUrl,
        message: 'Video generated successfully!',
        remainingTokens: remainingTokens
      };
    } catch (error) {
      console.error('Error generating video with Replicate:', error);
      console.error('Error details:', error.message);

      // Fire-and-forget: write failed generation audit log
      db.collection('generationLog').add({
        userId,
        provider: 'replicate',
        model: model_name,
        generationType: 'video',
        tokenCost,
        processingTimeMs: videoGenerationStartTime ? Date.now() - videoGenerationStartTime : null,
        providerPredictionId: null, // replicate.run() doesn't expose prediction ID; use predictions.create() if needed
        status: 'failed',
        error: error.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      // If it's a Replicate error, include more details
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        throw new functions.https.HttpsError('internal', `Replicate API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }

      throw new functions.https.HttpsError('internal', `Failed to generate video: ${error.message}`);
    }
  });

// Replicate API function for image → Gaussian Splat generation (SHARP).
// Asynchronous: this creates the Replicate prediction and returns its id
// immediately, then the client polls getGenerationJobStatus until terminal.
// SHARP can sit in a cold-boot queue for minutes, so we never hold the callable
// connection open for the whole run — an idle connection held that long gets
// dropped, surfacing as a spurious client error even though the job ultimately
// succeeds on Replicate.
const generateReplicateSplat = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', 'ALLOWED_PRO_TEAM_DOMAINS', ...MODAL_SECRETS],
    // Creation only (stage source + submit) — but a scaled-to-zero Modal
    // enqueue endpoint can cold-start for minutes, so give submit headroom.
    timeoutSeconds: 300
  })
  .https
  .onCall(async (data, context) => {
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('CRITICAL: REPLICATE_API_TOKEN secret not loaded');
      throw new functions.https.HttpsError('failed-precondition', 'Splat generation service is not properly configured.');
    }

    if (!context.auth) {
      console.error('Unauthenticated request to generateReplicateSplat');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to generate splats.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const { input_image, input_video, model_id = 'sharp-ml', source = 'generator', notify } = data;

    // Opt-in completion email. `pending: true` is the flag the notify sweep
    // (generation-job-reconcile.js) queries on; it clears when the email is
    // sent OR when a live poll acks the result (tab was open → no email needed).
    const wantsEmail = notify?.email === true;

    const modelConfig = REPLICATE_MODELS[model_id] || REPLICATE_MODELS['sharp-ml'];
    const tokenCost = modelConfig?.tokenCost || 1;
    // 'image' (base64 staged here) vs 'video' (client-uploaded to Storage).
    const inputKind = modelConfig?.inputKind || 'image';
    // Which compute backend runs this model. Everything except the submit /
    // status-fetch / result-save mechanics is provider-agnostic.
    const provider = modelConfig?.provider || 'replicate';

    let tokenData;
    try {
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (tokenError) {
      console.error(`Error retrieving token data for user ${userId}:`, tokenError);
      throw new functions.https.HttpsError('internal', `Failed to retrieve token information: ${tokenError.message}`);
    }

    if (!tokenData) {
      throw new functions.https.HttpsError('internal', 'Failed to retrieve token information. Please try again.');
    }

    if (!tokenData.genToken || tokenData.genToken < tokenCost) {
      throw new functions.https.HttpsError('resource-exhausted', `Not enough generation tokens. This model requires ${tokenCost} token(s), but you have ${tokenData.genToken || 0}.`);
    }

    if (inputKind === 'video') {
      if (!input_video) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required input video.');
      }
    } else if (!input_image) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required input image.');
    }

    const db = admin.firestore();
    let tempFilePath = null;

    try {
      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
        useFileOutput: false
      });

      // The Replicate model needs a publicly-fetchable source URL. How we get
      // one depends on the input kind:
      //   image → accept an https URL or a base64 data URL we stage in Storage
      //   video → the client already uploaded the file to Storage (videos are
      //           too large to base64 through a callable); we just make the
      //           uploaded path briefly fetchable for Replicate.
      // Either way the staged source is recorded in `tempFilePath` and deleted
      // once the job finishes (cleanupSplatTempFile, via job.tempFilePath).
      let sourceUrl;
      if (inputKind === 'video') {
        if (input_video.startsWith('http://') || input_video.startsWith('https://')) {
          sourceUrl = input_video; // already a fetchable URL
        } else {
          const bucket = admin.storage().bucket();
          const file = bucket.file(input_video);
          await file.makePublic();
          sourceUrl = `https://storage.googleapis.com/${bucket.name}/${input_video}`;
          tempFilePath = input_video;
        }
      } else {
        let imageUrl = input_image;
        if (input_image.startsWith('data:image/')) {
          const matches = input_image.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid base64 image format.');
          }
          const mimeType = matches[1];
          const base64Data = matches[2];
          const imageBuffer = Buffer.from(base64Data, 'base64');

          const timestamp = Date.now();
          const filename = `temp-splat-input-${userId}-${timestamp}.jpg`;
          const bucket = admin.storage().bucket();
          const file = bucket.file(`temp/${filename}`);
          await file.save(imageBuffer, {
            metadata: {
              contentType: mimeType,
              expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
            }
          });
          await file.makePublic();
          imageUrl = `https://storage.googleapis.com/${bucket.name}/temp/${filename}`;
          tempFilePath = `temp/${filename}`;
        }
        sourceUrl = imageUrl;
      }

      // SHARP (kfarr/sharp-ml) takes a single `image` input and returns a
      // .ply Gaussian Splat. It's a community model (not an official Replicate
      // model), so the bare `owner/name` predictions endpoint 404s — we must
      // pin an explicit version. Resolve the latest version at runtime so the
      // model owner can re-push without a code change. (Replicate only — a
      // Modal deployment is itself the pinned version.)
      let splatVersion = null;
      if (provider === 'replicate') {
        const [modelOwner, modelSlug] = modelConfig.modelName.split('/');
        const splatModel = await replicate.models.get(modelOwner, modelSlug);
        splatVersion = splatModel?.latest_version?.id;
        if (!splatVersion) {
          throw new Error(`Could not resolve a version for ${modelConfig.modelName}`);
        }
      }

      // Generate the durable job identity up front. The internal `jobId` (a
      // uuid) is the Firestore doc id, NOT the Replicate prediction id — that's
      // stored as `providerJobId`. This lets us write a `pending` row BEFORE
      // submit (a crash mid-submit becomes a visible, reconcilable job), keeps
      // job identity uniform across providers/kinds, and lets the webhook URL
      // carry a stable jobId that's frozen at submit time.
      const jobId = crypto.randomUUID();
      const webhookSecret = crypto.randomUUID();
      const jobRef = db
        .collection('users').doc(userId)
        .collection('generationJobs').doc(jobId);

      // Stable names for the saved gallery asset, fixed at submit so both the
      // webhook and poll paths produce identical metadata. Model-aware so the
      // gallery distinguishes SHARP vs vid2scene outputs (falls back to SHARP).
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const assetSlug = modelConfig.assetSlug || 'sharp-splat';
      const assetLabel = modelConfig.assetLabel || 'SHARP Splat';
      const originalFilename = `${assetSlug}-${stamp}.ply`;
      const assetName = `${assetLabel} ${stamp}`;

      // Write the pending job before submitting. Completion is handled two ways,
      // both converging on the same idempotent processing:
      //   1. A Replicate webhook (replicateJobWebhook) — fires when the job
      //      finishes and saves the splat to the gallery server-side, so it
      //      works even if the user has closed the browser.
      //   2. Client polling (getGenerationJobStatus) — drives live UI when the
      //      tab is open and acts as a fallback if webhook delivery fails.
      // We store a normalized status vocabulary (queued|running|saving|
      // succeeded|failed|canceled) and keep the raw provider value as
      // `providerStatus`, so the reconciler's "find non-terminal jobs" query
      // stays provider-agnostic.
      await jobRef.set({
        status: 'queued',
        providerStatus: null,
        kind: 'splat',
        provider,
        providerJobId: null,
        model: modelConfig.modelName,
        modelId: model_id,
        source,
        tokenCost,
        tokenCharged: false,
        refunded: false,
        tempFilePath: tempFilePath || null,
        webhookSecret,
        originalFilename,
        assetName,
        // Attribution surfaced on the saved asset's generationMetadata. Stored on
        // the job so the server-side persist (saveSplatToGallery) is model-aware
        // without re-deriving it. Falls back to SHARP for older jobs.
        attribution: modelConfig.attribution || {
          model: 'apple/sharp-ml',
          modelName: 'SHARP (Image to Splat)',
          sourceType: 'image'
        },
        notify: { email: wantsEmail, pending: wantsEmail },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Charge BEFORE creating the prediction, and set `tokenCharged` in the
      // same transaction as the deduction. The flag is therefore committed
      // before any prediction exists for a webhook to fire against, so every
      // later refund path (webhook, poll, reconciler) is guaranteed to observe
      // tokenCharged:true and refund exactly once. The old "create then charge"
      // order left a window where a near-instant webhook read tokenCharged:false,
      // no-op'd its refund, and the charge then stuck with no asset and no refund.
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      let remainingTokens = 0;
      let tokensBefore = 0;
      try {
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
          const newTokenCount = Math.max(0, currentTokens - tokenCost);
          remainingTokens = newTokenCount;
          transaction.update(tokenProfileRef, {
            genToken: newTokenCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          transaction.update(jobRef, { tokenCharged: true });
        });
      } catch (chargeError) {
        await jobRef.update({
          status: 'failed',
          error: 'Token charge failed.',
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await cleanupSplatTempFile(tempFilePath);
        throw chargeError;
      }

      db.collection('tokenLog').add({
        userId,
        type: 'deduction',
        tokensBefore,
        tokensAfter: remainingTokens,
        tokenCost,
        source: 'splat-generation',
        relatedModel: modelConfig.modelName,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write tokenLog:', err));

      // The webhook URL carries the owner uid (to locate the job doc), the
      // internal jobId (the doc id), and a per-job secret (to gate the
      // endpoint). We never trust the webhook body; both paths re-fetch the
      // prediction from Replicate authoritatively. Region comes from the
      // runtime env so a region change doesn't strand already-frozen URLs.
      const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        admin.app().options.projectId;
      const region = process.env.FUNCTION_REGION || 'us-central1';
      const webhookFn = provider === 'modal' ? 'modalJobWebhook' : 'replicateJobWebhook';
      const webhookUrl =
        `https://${region}-${projectId}.cloudfunctions.net/${webhookFn}` +
        `?jobId=${jobId}&uid=${userId}&token=${webhookSecret}`;

      let prediction;
      try {
        if (provider === 'modal') {
          // Fire-and-forget enqueue; the returned call_id is the provider job
          // id. Synthesize a Replicate-shaped prediction ('starting' normalizes
          // to 'queued') so the post-submit bookkeeping below is shared.
          const callId = await enqueueModalJob({
            videoUrl: sourceUrl,
            jobId,
            webhookUrl,
            pipeline: modelConfig.pipeline
          });
          prediction = { id: callId, status: 'starting' };
        } else {
          prediction = await replicate.predictions.create({
            version: splatVersion,
            // The cog accepts the same per-tier quality knobs as inputs, so
            // the Replicate fallback honors the tier too.
            input:
              inputKind === 'video'
                ? { video: sourceUrl, ...(modelConfig.pipeline || {}) }
                : { image: sourceUrl },
            webhook: webhookUrl,
            webhook_events_filter: ['completed']
          });
        }
      } catch (createError) {
        // Already paid above — refund (once) before failing the job so a submit
        // failure never costs the user a token.
        const refunded = await refundSplatToken(db, userId, jobRef, {
          tokenCharged: true,
          refunded: false,
          tokenCost,
          model: modelConfig.modelName
        });
        if (typeof refunded !== 'undefined') remainingTokens = refunded;
        await jobRef.update({
          status: 'failed',
          error: `Failed to create prediction: ${createError.message}`,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await cleanupSplatTempFile(tempFilePath);
        throw createError;
      }

      // Record the provider identity so the webhook + poll + reconciler can
      // re-fetch authoritatively. A webhook for a near-instant prediction can
      // fire before this runs (it falls back to req.body.id), so we only advance
      // the status while it's still the pre-submit 'queued' — never regress a
      // status a racing completion path already moved past.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        const j = snap.data() || {};
        const update = { providerJobId: prediction.id };
        if (j.status === 'queued') {
          update.status = normalizeReplicateStatus(prediction.status);
          update.providerStatus = prediction.status || null;
        }
        tx.update(jobRef, update);
      });

      return {
        success: true,
        jobId,
        status: normalizeReplicateStatus(prediction.status),
        remainingTokens
      };
    } catch (error) {
      console.error('Error creating splat prediction:', error);

      // Best-effort cleanup of the staged input on failure.
      await cleanupSplatTempFile(tempFilePath);

      db.collection('generationLog').add({
        userId,
        provider,
        model: modelConfig.modelName,
        generationType: 'splat',
        tokenCost,
        status: 'failed',
        error: error.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      if (error.response) {
        const detail = error.response.data?.detail || error.response.data || error.response.status;
        throw new functions.https.HttpsError('internal', `Replicate API error: ${detail}`);
      }
      throw new functions.https.HttpsError('internal', `Failed to create splat: ${error.message}`);
    }
  });

// Best-effort delete of a staged splat input image. Safe to call with null, or
// twice — failures are swallowed.
async function cleanupSplatTempFile(tempFilePath) {
  if (!tempFilePath) return;
  try {
    await admin.storage().bucket().file(tempFilePath).delete();
  } catch (cleanupError) {
    console.warn('Failed to cleanup temp splat input:', cleanupError);
  }
}

// How long a `status: 'saving'` claim is trusted before another caller may
// re-take it. A save that's killed mid-flight (e.g. an OOM while downloading a
// large .ply) never releases its claim, so without this the job would wedge in
// 'saving' forever. Sized well above a normal download+upload.
const SAVING_CLAIM_TTL_MS = 3 * 60 * 1000;

// Map a raw Replicate prediction status onto our own normalized vocabulary
// (queued|running|succeeded|failed|canceled). Keeping a provider-agnostic enum
// in the job doc means the reconciler's "non-terminal" query never needs a
// per-provider list of in-flight strings. `saving` is an internal claim state,
// not a provider status, so it isn't produced here.
function normalizeReplicateStatus(status) {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'starting':
      return 'queued';
    case 'processing':
    default:
      return 'running';
  }
}

// SHARP's output can come back as a bare string, an array, or an object with a
// url/output field depending on the client path. Normalize to a single URL.
function extractSplatUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return typeof output[0] === 'string' ? output[0] : null;
  if (typeof output.output !== 'undefined') return extractSplatUrl(output.output);
  if (typeof output.url === 'string') return output.url;
  return null;
}

// Refund a failed splat job's charge exactly once, guarded by the job's
// `refunded` flag inside a transaction. Returns the resulting token count, or
// undefined if there was nothing to refund / the refund failed.
async function refundSplatToken(db, userId, jobRef, job) {
  if (job.refunded || !job.tokenCharged) return undefined;
  const tokenCost = job.tokenCost || 1;
  const tokenProfileRef = db.collection('tokenProfile').doc(userId);
  let remainingTokens;
  try {
    await db.runTransaction(async (transaction) => {
      const jobDoc = await transaction.get(jobRef);
      if (jobDoc.exists && jobDoc.data().refunded) {
        return; // another poll already refunded
      }
      const tokenDoc = await transaction.get(tokenProfileRef);
      if (!tokenDoc.exists) {
        transaction.update(jobRef, { refunded: true });
        return;
      }
      const currentTokens = tokenDoc.data().genToken || 0;
      remainingTokens = currentTokens + tokenCost;
      transaction.update(tokenProfileRef, {
        genToken: remainingTokens,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      transaction.update(jobRef, { refunded: true });
    });
  } catch (error) {
    console.error('Failed to refund splat token:', error);
    return undefined;
  }
  if (typeof remainingTokens !== 'undefined') {
    db.collection('tokenLog').add({
      userId,
      type: 'refund',
      tokenCost,
      source: 'splat-generation-failed',
      relatedModel: job.model,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('Failed to write tokenLog:', err));
  }
  return remainingTokens;
}

// Copy the finished .ply from Replicate's (short-lived) CDN URL into the user's
// gallery server-side — the same asset contract assetsService.addAsset writes
// client-side (Storage file + users/{uid}/assets/{assetId} doc), so the editor
// Assets panel and the onAssetWritten quota trigger pick it up unchanged. We
// set a firebaseStorageDownloadTokens so anonymous viewers can load the file.
//
// The transfer is *streamed* (download piped straight into the Storage write
// stream) rather than buffered via arrayBuffer/Buffer — so memory stays flat
// (a few MB) regardless of splat size, instead of holding two full copies of
// the file. This is what lets the function run in modest memory.
// Stable, UUID-shaped asset id derived from the Replicate predictionId. Retries
// of the same generation (a save that crashed mid-flight, the reconciler
// re-taking a stale claim, a racing webhook+poll) MUST converge on one asset id
// so they overwrite the same Storage object + asset doc instead of creating a
// duplicate — a fresh random id per attempt would write a second file and fire
// onAssetWritten again, double-counting the splat's bytes against the quota.
function deterministicAssetId(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return (
    h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) +
    '-' + h.slice(16, 20) + '-' + h.slice(20, 32)
  );
}

async function saveSplatToGallery(userId, plyUrl, job) {
  validateSplatUserId(userId);

  // Keyed on predictionId so a retry reuses the same object/doc (see above).
  // Falls back to a random id only if a caller somehow omits predictionId.
  const assetId = deterministicAssetId(job.predictionId || crypto.randomUUID());
  const filename = `${assetId}.ply`;
  const storagePath = `users/${userId}/assets/splats/${filename}`;
  const downloadToken = crypto.randomUUID();

  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const objectMetadata = {
    contentType: 'application/octet-stream',
    // Immutable content (keyed by assetId): cache for a year so the editor
    // and the preview-modal iframe reuse the browser HTTP cache instead of
    // re-downloading. Matches assetsService.uploadToStorage for uploads.
    cacheControl: 'public, max-age=31536000',
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
      assetRole: 'original',
      assetId
    }
  };

  if (plyUrl.startsWith('gs://')) {
    // Modal staged the finished .ply in OUR OWN bucket (vid2scene-staging/),
    // so the "save" is a same-bucket server-side copy — metadata-only, no
    // bytes move through this function.
    const match = plyUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match || match[1] !== bucket.name) {
      throw new Error(`Unexpected splat staging location: ${plyUrl}`);
    }
    const stagingFile = bucket.file(match[2]);
    await stagingFile.copy(file);
    await file.setMetadata(objectMetadata);
    // Staging object served its purpose. Best-effort: a retry that finds it
    // gone will also find the job already 'succeeded' and never reach here.
    stagingFile.delete().catch(err =>
      console.warn('Failed to delete staged splat:', err.message)
    );
  } else {
    const response = await fetch(plyUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download splat from provider (${response.status})`);
    }
    const writeStream = file.createWriteStream({
      // Leave resumable at its default (true): it uploads in chunks and keeps
      // memory bounded. resumable:false would buffer the whole payload to
      // compute a single request — the very thing we're avoiding.
      metadata: objectMetadata
    });
    await pipeline(Readable.fromWeb(response.body), writeStream);
  }

  // Copied/streamed, so the byte count isn't in hand — read it back
  // authoritatively from the stored object for the asset doc / quota trigger.
  const [meta] = await file.getMetadata();
  const size = Number(meta.size) || 0;

  const storageUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

  const originalFilename = job.originalFilename || filename;
  const lastDot = originalFilename.lastIndexOf('.');
  const defaultName =
    lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin
    .firestore()
    .collection('users').doc(userId)
    .collection('assets').doc(assetId)
    .set({
      assetId,
      userId,
      type: 'splat',
      category: 'splat-output',
      storagePath,
      storageUrl,
      name: job.assetName || defaultName,
      filename,
      originalFilename,
      size,
      mimeType: 'application/octet-stream',
      generationMetadata: {
        // User-facing attribution, taken from the job's `attribution` (set at
        // submit from the model config) so this is model-aware — SHARP credits
        // Apple, vid2scene credits samuelm2/vid2scene. The actual Replicate path
        // that ran is preserved on the job doc + as predictionId below. This is
        // the value the gallery card / mesh-details modal display via
        // getAssetSourceLabel. Falls back to SHARP for older jobs.
        model: job.attribution?.model || 'apple/sharp-ml',
        model_name: job.attribution?.modelName || 'SHARP (Image to Splat)',
        sourceType: job.attribution?.sourceType || 'image',
        source: job.source || 'generator',
        predictionId: job.predictionId || null,
        timestamp: new Date().toISOString()
      },
      createdAt: now,
      updatedAt: now,
      uploadedAt: now,
      publishedAt: now,
      visibility: 'public',
      tags: [],
      collections: [],
      deleted: false
    });

  return { assetId, storageUrl };
}

// Guard a uid before using it in a Storage/Firestore path. Mirrors the client's
// validateUserIdForPath so a forged webhook uid can't escape the user subtree.
function validateSplatUserId(userId) {
  if (!userId || typeof userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('Invalid user id for splat path');
  }
}

// Modal split-shape rate card ($/h, 2026-06 list prices): GPU + the stage's
// CPU/RAM reservations (SfM: 16 cpu + 24 GiB; train: 4 cpu + 16 GiB). Drives
// the advisory estCostUsd on generationLog rows so margin (tokenCost vs cost)
// is trackable over time. Real billing truth stays the Modal dashboard —
// update these alongside any rate or deploy-shape change.
const MODAL_STAGE_RATES_PER_HOUR = {
  sfm: { T4: 0.59 + 16 * 0.047 + 24 * 0.008, L4: 0.8 + 16 * 0.047 + 24 * 0.008 },
  train: { T4: 0.59 + 4 * 0.047 + 16 * 0.008, L4: 0.8 + 4 * 0.047 + 16 * 0.008 }
};

// Rate-card cost estimate from the Modal app's per-stage timings (seconds of
// compute + the GPU each stage actually landed on). Null when there's nothing
// to price (Replicate-fallback jobs, failed-before-SfM, unknown GPU).
function estimateModalCostUsd(metrics) {
  if (!metrics) return null;
  const gpuKey = (name) =>
    /L4/i.test(name || '') ? 'L4' : /T4/i.test(name || '') ? 'T4' : null;
  let usd = 0;
  let priced = false;
  const sfmGpu = gpuKey(metrics.sfm_gpu);
  if (metrics.sfm_seconds > 0 && sfmGpu) {
    usd += (metrics.sfm_seconds / 3600) * MODAL_STAGE_RATES_PER_HOUR.sfm[sfmGpu];
    priced = true;
  }
  const trainGpu = gpuKey(metrics.train_gpu);
  if (metrics.train_seconds > 0 && trainGpu) {
    usd += (metrics.train_seconds / 3600) * MODAL_STAGE_RATES_PER_HOUR.train[trainGpu];
    priced = true;
  }
  return priced ? Math.round(usd * 100) / 100 : null;
}

// Idempotently handle a terminal Replicate prediction. Called by BOTH the
// webhook and the poller, possibly concurrently, so the success path claims the
// save by flipping status → 'saving' in a transaction; only the winner uploads.
// Failure refunds once (guarded by refundSplatToken). Returns a client-facing
// status object.
async function processTerminalPrediction(db, userId, jobRef, prediction) {
  const normalized = normalizeReplicateStatus(prediction.status);

  if (normalized === 'succeeded') {
    // Claim the save so a racing caller can't double-upload. The claim is
    // time-bounded: a stale 'saving' (older than SAVING_CLAIM_TTL_MS, i.e. a
    // prior save that was killed before releasing it) can be re-taken.
    let claimed = false;
    let job = {};
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      job = snap.data() || {};
      if (job.status === 'succeeded') {
        return; // already saved
      }
      // A job the reconciler (or a prior failure path) already finalized as
      // failed/canceled — and refunded the token for — must NOT be resurrected
      // into success by a late provider report. Doing so would hand the user a
      // free asset after returning their token. Stay terminal.
      if (
        job.status === 'failed' ||
        job.status === 'canceled' ||
        job.refunded
      ) {
        return;
      }
      if (job.status === 'saving') {
        const startedAt =
          job.savingStartedAt && job.savingStartedAt.toMillis
            ? job.savingStartedAt.toMillis()
            : 0;
        if (Date.now() - startedAt < SAVING_CLAIM_TTL_MS) {
          return; // a live save is in progress; don't double-upload
        }
        // stale claim — the prior save likely crashed; re-take it.
      }
      claimed = true;
      tx.update(jobRef, {
        status: 'saving',
        savingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStatus: prediction.status
      });
    });

    if (!claimed) {
      const snap = await jobRef.get();
      const j = snap.data() || {};
      // Already saved by a racing caller.
      if (j.status === 'succeeded') {
        return { status: 'succeeded', splat_url: j.splatUrl, assetId: j.assetId };
      }
      // Already finalized as failed/canceled (e.g. the reconciler gave up and
      // refunded) — surface the terminal status so the client stops polling
      // instead of waiting on a save that will never come.
      if (j.status === 'failed' || j.status === 'canceled') {
        return { status: j.status, assetId: j.assetId, error: j.error };
      }
      // A live save is in progress — report it as still running so the client
      // keeps polling; it'll flip to 'succeeded' shortly.
      return {
        status: 'running',
        splat_url: j.splatUrl,
        assetId: j.assetId,
        error: j.error
      };
    }

    const splatUrl = extractSplatUrl(prediction.output);
    if (!splatUrl) {
      console.error('Unexpected SHARP output:', JSON.stringify(prediction.output, null, 2));
      const remainingTokens = await refundSplatToken(db, userId, jobRef, job);
      await cleanupSplatTempFile(job.tempFilePath);
      await jobRef.update({
        status: 'failed',
        error: 'Invalid output from model.',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { status: 'failed', error: 'Invalid output from model.', remainingTokens };
    }

    try {
      const { assetId, storageUrl } = await saveSplatToGallery(userId, splatUrl, {
        ...job,
        predictionId: job.providerJobId || jobRef.id
      });
      await cleanupSplatTempFile(job.tempFilePath);
      await jobRef.update({
        status: 'succeeded',
        assetId,
        splatUrl: storageUrl,
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      db.collection('generationLog').add({
        userId,
        provider: job.provider || 'replicate',
        model: job.model,
        // The tier (vid2scene-basic/vid2scene/vid2scene-max) — `model` is the
        // same provider slug for every tier, so per-tier duration stats (the
        // generator's "how long does this usually take" data) need this.
        modelId: job.modelId || null,
        generationType: 'splat',
        tokenCost: job.tokenCost,
        // Submit → saved-to-gallery, i.e. the user-perceived duration. Image/
        // video generations record their equivalent; splats were missing it.
        // NOTE this includes provider queue wait (a capacity-starved job can
        // sit hours before compute starts) — metrics below is the compute-only
        // view, so use that for cost analysis and this for user-facing ETAs.
        processingTimeMs: job.createdAt?.toMillis
          ? Date.now() - job.createdAt.toMillis()
          : null,
        // Per-stage compute reported by the Modal app ({sfm,train}_{seconds,gpu})
        // and its rate-card $ estimate — the cost half of the margin tracking
        // that tokenCost is the revenue half of. Null on the Replicate fallback.
        metrics: prediction.metrics || null,
        estCostUsd: estimateModalCostUsd(prediction.metrics),
        status: 'succeeded',
        source: job.source,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('Failed to write generationLog:', err));
      return { status: 'succeeded', splat_url: storageUrl, assetId };
    } catch (saveError) {
      console.error('Failed to save splat to gallery:', saveError);
      // Release the claim so a webhook retry / next poll can re-attempt.
      await jobRef.update({ status: 'running' });
      throw new functions.https.HttpsError('internal', `Failed to save splat: ${saveError.message}`);
    }
  }

  if (normalized === 'failed' || normalized === 'canceled') {
    const snap = await jobRef.get();
    const job = snap.data() || {};
    const remainingTokens = await refundSplatToken(db, userId, jobRef, job);
    await cleanupSplatTempFile(job.tempFilePath);
    await jobRef.update({
      status: normalized,
      providerStatus: prediction.status,
      error: prediction.error || 'Splat generation failed.',
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    db.collection('generationLog').add({
      userId,
      provider: job.provider || 'replicate',
      model: job.model,
      modelId: job.modelId || null,
      generationType: 'splat',
      tokenCost: job.tokenCost,
      processingTimeMs: job.createdAt?.toMillis
        ? Date.now() - job.createdAt.toMillis()
        : null,
      status: 'failed',
      error: prediction.error || null,
      source: job.source,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('Failed to write generationLog:', err));
    return {
      status: normalized,
      error: prediction.error || 'Splat generation failed.',
      remainingTokens
    };
  }

  // queued | running — not terminal yet. Keep the raw status fresh for debugging.
  await jobRef.update({ status: normalized, providerStatus: prediction.status || null });
  return { status: normalized };
}

// Poller companion to the generation submit functions. Drives live UI while
// the tab is open and acts as a fallback if webhook delivery fails. Reads the
// job doc first (the webhook may have already finished the work), otherwise
// asks the provider and runs the shared idempotent processor. Generic across
// Replicate kinds today; provider dispatch becomes a registry when fal/Teleport
// land.
// A live poll from an open tab is itself proof the user is present to see the
// result, so we stamp the job's notify ack and clear its `pending` flag. That
// suppresses the completion email: the notify sweep only emails opted-in jobs
// the client never acked (i.e. the tab was closed). Best-effort — a failed write
// just risks an email the user didn't strictly need.
async function ackClientSeen(jobRef, job) {
  if (!job?.notify?.pending) return; // not opted-in, or already acked/sent
  try {
    await jobRef.update({
      'notify.pending': false,
      'notify.clientAckedAt': admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.warn('Failed to ack client-seen for notify suppression:', err.message);
  }
}

const getGenerationJobStatus = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', ...MODAL_SECRETS],
    // saveSplatToGallery streams the .ply through (no full-file buffering), so
    // memory no longer scales with splat size. 512 MB is fixed headroom over the
    // firebase-admin cold-start baseline, not sized to the file.
    memory: '512MB',
    // The save (download from Replicate's CDN → resumable upload to Storage) can
    // take well over the 60s default for a large .ply. If the callable is killed
    // mid-save the 'saving' claim never releases and the job wedges, so give the
    // save real headroom; the stale-claim TTL + reconciler are only the backstop.
    timeoutSeconds: 300
  })
  .https
  .onCall(async (data, context) => {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new functions.https.HttpsError('failed-precondition', 'Generation service is not properly configured.');
    }
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const { jobId } = data || {};
    if (!jobId) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing jobId.');
    }

    const db = admin.firestore();
    const jobRef = db.collection('users').doc(userId).collection('generationJobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Unknown generation job.');
    }
    const job = jobSnap.data();

    // Terminal in our records (likely the webhook already handled it).
    if (job.status === 'succeeded' && job.splatUrl) {
      await ackClientSeen(jobRef, job);
      return { status: 'succeeded', splat_url: job.splatUrl, assetId: job.assetId };
    }
    if (job.status === 'failed' || job.status === 'canceled') {
      return { status: job.status, error: job.error || 'Generation failed.' };
    }
    // Submitted but the provider id hasn't been recorded yet (brief create
    // window). Report queued; the next poll will have it.
    if (!job.providerJobId) {
      return { status: job.status || 'queued' };
    }
    // queued | running | saving → re-fetch from the provider and run the shared
    // processor. It owns the (stale-aware) save claim, so calling it while
    // another caller is mid-save is safe, and it recovers a crashed save.

    let prediction;
    try {
      if (job.provider === 'modal') {
        const fetched = await fetchModalPrediction(admin, job, jobId);
        if (fetched.absent) {
          // Provider lost the job (expired result) — keep reporting the stored
          // status; the reconciler's give-up window owns declaring it dead.
          return { status: job.status || 'running' };
        }
        prediction = fetched.prediction;
      } else {
        const replicate = new Replicate({
          auth: process.env.REPLICATE_API_TOKEN,
          useFileOutput: false
        });
        prediction = await replicate.predictions.get(job.providerJobId);
      }
    } catch (error) {
      console.error('Failed to fetch prediction status:', error);
      throw new functions.https.HttpsError('internal', `Failed to fetch generation status: ${error.message}`);
    }

    const result = await processTerminalPrediction(db, userId, jobRef, prediction);
    // If this poll is what carried the job to success, the tab is open — ack it
    // so the completion email is suppressed.
    if (result.status === 'succeeded') await ackClientSeen(jobRef, job);
    return result;
  });

// Provider webhook target — makes completion browser-independent. The provider
// POSTs here when a job finishes. We don't trust the payload: the uid +
// internal jobId + per-job secret in the query string gate the request, then we
// re-derive the result authoritatively (Replicate: re-fetch the prediction;
// Modal: status endpoint + staged-.ply existence in our own bucket) and run the
// shared idempotent processor (which saves the result to the gallery).
// Shared by replicateJobWebhook and modalJobWebhook — the job doc's `provider`
// drives the dispatch, and each provider's webhook URL is frozen at submit.
async function handleJobWebhook(req, res) {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }
    const { token, uid, jobId } = req.query;
    if (!uid || !jobId) {
      res.status(400).send('Missing uid or jobId');
      return;
    }

    try {
      validateSplatUserId(uid);
    } catch (e) {
      res.status(400).send('Invalid uid');
      return;
    }

    const db = admin.firestore();
    const jobRef = db.collection('users').doc(uid).collection('generationJobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      // Nothing to do (unknown / already GC'd). Ack so the provider stops retrying.
      res.status(200).send('ok');
      return;
    }
    const job = jobSnap.data();
    if (!job.webhookSecret || job.webhookSecret !== token) {
      res.status(403).send('Forbidden');
      return;
    }

    let prediction;
    if (job.provider === 'modal') {
      // Modal posts its webhook from inside the training container, moments
      // before the result is observable on the status endpoint — but the staged
      // .ply is already in our bucket by then, so fetchModalPrediction's
      // existence check resolves it. Modal sends the webhook exactly once (no
      // retry), so a transient error here just defers to the poll/reconciler.
      try {
        const fetched = await fetchModalPrediction(admin, job, jobId);
        if (fetched.absent) {
          res.status(200).send('ok');
          return;
        }
        prediction = fetched.prediction;
        // The webhook usually lands before the coordinator returns, so the
        // status endpoint hasn't got the result (and its timings) yet — the
        // existence check proves success without them. The webhook body is
        // authenticated by the per-job webhookSecret above, and timings are
        // advisory stats (never part of the success proof), so trusting the
        // body's copy here is fine.
        if (!prediction.metrics && req.body && req.body.timings) {
          prediction.metrics = req.body.timings;
        }
      } catch (error) {
        console.error('Webhook: failed to fetch Modal job state:', error);
        res.status(502).send('Upstream error');
        return;
      }
    } else {
      // Prefer the recorded provider id; fall back to the body id only as a
      // lookup key for the authoritative re-fetch (covers the brief
      // create→update window before providerJobId is persisted).
      const providerJobId = job.providerJobId || (req.body && req.body.id);
      if (!providerJobId) {
        res.status(200).send('ok'); // can't resolve yet; poll/reconciler will
        return;
      }

      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
        useFileOutput: false
      });

      try {
        prediction = await replicate.predictions.get(providerJobId);
      } catch (error) {
        console.error('Webhook: failed to fetch prediction:', error);
        res.status(502).send('Upstream error'); // Replicate will retry
        return;
      }
    }

    try {
      const result = await processTerminalPrediction(db, uid, jobRef, prediction);
      // Real-time completion email. The webhook is the provider's "it's done"
      // signal, so this is the moment to notify an away user — no 10-min sweep
      // wait. Best-effort and fully isolated: the helper is idempotent (it
      // claims the send so the sweep can't double-send) and restores the
      // pending flag on failure (the sweep retries). A send error must never
      // fail the webhook — the save already succeeded, and a 500 would make
      // Replicate redeliver and re-run the (idempotent) save for nothing.
      if (result && result.status === 'succeeded') {
        try {
          await sendGenerationReadyEmail(db, uid, jobRef);
        } catch (mailErr) {
          console.error('Webhook: completion email failed:', mailErr);
        }
      }
      res.status(200).send('ok');
    } catch (error) {
      console.error('Webhook: processing failed:', error);
      res.status(500).send('Processing error'); // provider may retry
    }
}

const replicateJobWebhook = functions
  .runWith({
    // POSTMARK_API_KEY: the webhook sends the completion email in real time
    // (sendGenerationReadyEmail), so it needs the Postmark secret in its env.
    secrets: ['REPLICATE_API_TOKEN', 'POSTMARK_API_KEY'],
    // Same streamed save as the poll path; 512 MB is fixed cold-start headroom,
    // not sized to the splat.
    memory: '512MB',
    // Same rationale as getGenerationJobStatus: the streamed save can exceed the
    // 60s default for a large .ply, and a kill mid-save wedges the job in
    // 'saving'. Replicate also retries the webhook, but don't rely on that.
    timeoutSeconds: 300
  })
  .https
  .onRequest(handleJobWebhook);

// Modal's webhook target. Same handler; the Modal save is a same-bucket copy
// (no streaming), but the memory/timeout stay matched to the shared path.
const modalJobWebhook = functions
  .runWith({
    secrets: [...MODAL_SECRETS, 'POSTMARK_API_KEY'],
    memory: '512MB',
    timeoutSeconds: 300
  })
  .https
  .onRequest(handleJobWebhook);

module.exports = {
  generateReplicateImage,
  generateReplicateVideo,
  generateReplicateSplat,
  getGenerationJobStatus,
  replicateJobWebhook,
  modalJobWebhook,
  // Internals reused by the scheduled reconciler (the dropped-webhook backstop).
  // Kept here so the idempotent save/charge/refund logic has a single home.
  processTerminalPrediction,
  refundSplatToken,
  cleanupSplatTempFile,
  normalizeReplicateStatus
};