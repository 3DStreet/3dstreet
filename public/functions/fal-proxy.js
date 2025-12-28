const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { REPLICATE_MODELS, AI_MODEL_NAMES } = require('./replicate-models.js');

// Helper function to post AI-generated images to Discord
async function postAIImageToDiscord(userId, imageUrl, prompt, modelId, sceneId, source = 'generator') {
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

    // Get model name from model ID
    const modelName = AI_MODEL_NAMES[modelId] || 'fal.ai Model';

    // Truncate prompt if it's too long for Discord
    const truncatedPrompt = prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt;

    // Construct scene URL if sceneId is provided
    const sceneUrl = sceneId ? `https://3dstreet.app/#scenes/${sceneId}` : null;

    // Determine footer text based on source parameter
    const footerText = source === 'generator' ? '3DStreet AI Generator' : '3DStreet Editor Snapshot AI Render';

    // Create Discord message with embed
    const message = {
      content: `🎨 **${username}** generated a new AI image!`,
      embeds: [{
        title: `${modelName} Render`,
        description: `**Prompt:** ${truncatedPrompt}`,
        url: sceneUrl,
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

// fal.ai API function for image generation
const generateFalImage = functions
  .runWith({
    secrets: ["FAL_KEY", "DISCORD_WEBHOOK_URL"],
    timeoutSeconds: 300 // 5 minutes - image generation can take several minutes
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

    const userId = context.auth.uid;
    const { prompt, input_image, model_id, scene_id, source = 'generator', guidance_scale = 2.5, num_inference_steps = 28 } = data;

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

    if (!input_image) {
      console.error(`Missing required input image for edit model`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required input image.');
    }

    try {
      let imageUrl = input_image;

      // If input_image is a base64 data URL, upload it to Firebase Storage first
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
        console.log(`Uploaded input image to: ${imageUrl}`);
      }

      // Build the fal.ai request payload
      const falPayload = {
        prompt: prompt,
        image_urls: [imageUrl],
        guidance_scale: guidance_scale,
        num_inference_steps: num_inference_steps,
        enable_safety_checker: true,
        output_format: 'jpeg'
      };

      // Add LoRA configuration if model has loras
      if (modelConfig.loras && modelConfig.loras.length > 0) {
        falPayload.loras = modelConfig.loras;
      }

      console.log(`Generating fal.ai image for user ${userId} with model ${model_id} (cost: ${tokenCost} tokens)`);
      console.log('fal.ai payload:', JSON.stringify(falPayload, null, 2));

      // Submit the request to fal.ai queue
      const endpoint = modelConfig.endpoint;
      const submitResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.FAL_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(falPayload)
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error(`fal.ai submit error: ${submitResponse.status} - ${errorText}`);
        throw new Error(`fal.ai API error: ${submitResponse.status}`);
      }

      const submitResult = await submitResponse.json();
      console.log('fal.ai submit response:', JSON.stringify(submitResult, null, 2));

      const requestId = submitResult.request_id;
      const statusUrl = submitResult.status_url;
      const responseUrl = submitResult.response_url;

      if (!requestId || !statusUrl || !responseUrl) {
        console.error('Missing required fields in fal.ai response:', JSON.stringify(submitResult, null, 2));
        throw new Error('Invalid response from fal.ai - missing request_id, status_url, or response_url');
      }

      console.log(`fal.ai request submitted: ${requestId}`);
      console.log(`Using status_url from response: ${statusUrl}`);
      console.log(`Using response_url from response: ${responseUrl}`);

      // Poll for result using URLs from fal.ai response
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes with 2 second intervals
      let result = null;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

        const statusResponse = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Key ${process.env.FAL_KEY}`
          }
        });

        if (!statusResponse.ok) {
          const errorBody = await statusResponse.text();
          console.error(`fal.ai status check error: ${statusResponse.status} - ${errorBody}`);
          attempts++;
          continue;
        }

        const statusResult = await statusResponse.json();
        console.log(`fal.ai status (attempt ${attempts + 1}): ${statusResult.status}`);

        if (statusResult.status === 'COMPLETED') {
          // Per fal.ai docs, the response is embedded in the status response when COMPLETED
          if (statusResult.response) {
            result = statusResult.response;
            console.log('fal.ai result received successfully from status response');
            break;
          } else {
            // Fallback: try fetching from response_url if not embedded
            console.log('Response not embedded in status, trying response_url...');
            const resultResponse = await fetch(responseUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Key ${process.env.FAL_KEY}`
              }
            });

            if (resultResponse.ok) {
              result = await resultResponse.json();
              console.log('fal.ai result received from response_url');
              break;
            } else {
              const resultError = await resultResponse.text();
              console.error(`fal.ai result fetch error: ${resultResponse.status} - ${resultError}`);
            }
          }
        } else if (statusResult.status === 'FAILED') {
          const errorMessage = statusResult.error || 'fal.ai generation failed';
          console.error(`fal.ai generation failed: ${errorMessage}`);
          throw new Error(errorMessage);
        }

        attempts++;
      }

      if (!result) {
        throw new Error('fal.ai generation timed out');
      }

      // Clean up temp file if we created one
      if (input_image.startsWith('data:image/') && imageUrl !== input_image) {
        try {
          const bucket = admin.storage().bucket();
          const filename = imageUrl.split('/').pop();
          await bucket.file(`temp/${filename}`).delete();
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      // Extract image URL from result
      let finalImageUrl;
      if (result.images && result.images.length > 0) {
        finalImageUrl = result.images[0].url;
      } else {
        console.error('Unexpected output format from fal.ai:', JSON.stringify(result, null, 2));
        throw new Error('No image URL returned from fal.ai');
      }

      // Decrement token for ALL users (only after successful image generation)
      const db = admin.firestore();
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);

      let remainingTokens = 0;
      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'Token profile not found');
        }

        const currentTokens = tokenDoc.data().genToken || 0;

        if (currentTokens < tokenCost) {
          throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
        }

        const newTokenCount = Math.max(0, currentTokens - tokenCost);
        remainingTokens = newTokenCount;

        transaction.update(tokenProfileRef, {
          genToken: newTokenCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      console.log(`fal.ai generation successful for user ${userId}: ${finalImageUrl}`);

      // Post AI-generated image to Discord (non-blocking)
      postAIImageToDiscord(userId, finalImageUrl, prompt, model_id, scene_id, source)
        .catch(err => console.error('Discord posting failed:', err));

      return {
        success: true,
        image_url: finalImageUrl,
        message: 'Image generated successfully!',
        remainingTokens: remainingTokens
      };
    } catch (error) {
      console.error('Error generating image with fal.ai:', error);
      console.error('Error details:', error.message);

      // Check if it's a Firebase HttpsError and rethrow
      if (error.code && (error.code.startsWith('resource-exhausted') || error.code.startsWith('unauthenticated'))) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', `Failed to generate image: ${error.message}`);
    }
  });

module.exports = { generateFalImage };
