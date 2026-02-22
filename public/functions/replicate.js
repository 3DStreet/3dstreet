const functions = require('firebase-functions');
const Replicate = require('replicate');
const admin = require('firebase-admin');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { AI_MODEL_NAMES, DEFAULT_MODEL_VERSION, MODEL_VERSIONS, REPLICATE_MODELS } = require('./replicate-models.js');

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


    try {
      // Check if Replicate API token is available
      if (!process.env.REPLICATE_API_TOKEN) {
        console.error('REPLICATE_API_TOKEN is not configured');
        throw new functions.https.HttpsError('failed-precondition', 'Image generation service is not configured. Please contact support.');
      }

      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
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

      // Check if this is the Nano Banana or Nano Banana Pro model (uses different input format)
      if (modelVersionToUse === MODEL_VERSIONS.NANO_BANANA || modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_PRO) {
        // Nano Banana models use image_input as an array (optional)
        if (imageUrl) {
          modelInput.image_input = [imageUrl];
          modelInput.aspect_ratio = 'match_input_image';
        }
        // Nano Banana Pro supports higher resolution
        if (modelVersionToUse === MODEL_VERSIONS.NANO_BANANA_PRO) {
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
          modelInput.aspect_ratio = 'match_input_image';
        }
        modelInput.size = '2K';
        modelInput.output_format = 'jpg';
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

      let prediction;
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
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      // Use a transaction to atomically check and decrement tokens
      // This prevents negative balances when multiple requests run concurrently
      let remainingTokens = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }

        const currentTokens = tokenDoc.data().genToken || 0;

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

    const userId = context.auth.uid;
    const { prompt, input_image, model_name = 'lightricks/ltx-2-fast', aspect_ratio = '16:9', duration_seconds = 5 } = data;

    // Calculate token cost based on duration
    // 5 seconds = 10 tokens, 10 seconds = 20 tokens
    const tokenCost = duration_seconds === 10 ? 20 : 10;

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

    try {
      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
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
        'lightricks/ltx-2-fast': 'LTX-2 Fast'
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
      }

      console.log(`Generating ${duration_seconds}s video for user ${userId} with model ${model_name} (cost: ${tokenCost} tokens)`);
      console.log('Model input parameters:', JSON.stringify(modelInput, null, 2));

      // Use run() with model name instead of predictions.create with version
      const output = await replicate.run(model_name, {
        input: modelInput
      });

      console.log(`Video generation completed for user ${userId}`);

      // Decrement tokens for ALL users (only after successful video generation)
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      let remainingTokens = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }

        const currentTokens = tokenDoc.data().genToken || 0;

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

      // If it's a Replicate error, include more details
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        throw new functions.https.HttpsError('internal', `Replicate API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }

      throw new functions.https.HttpsError('internal', `Failed to generate video: ${error.message}`);
    }
  });

module.exports = { generateReplicateImage, generateReplicateVideo };