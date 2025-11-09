const functions = require('firebase-functions');
const Replicate = require('replicate');
const admin = require('firebase-admin');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');

// Model version to name mapping
const AI_MODEL_NAMES = {
  '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755': 'Kontext Real Earth',
  '2af3274cfd12ae2e0a87619bef1e7df80df2fbcf02d8d9dff23c74e6ca1d5f1d': 'Flux Kontext Pro',
  'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0': 'Nano Banana',
  '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569': 'Seedream v4'
};

// Helper function to post AI-generated images to Discord
async function postAIImageToDiscord(userId, imageUrl, prompt, modelVersion, sceneId) {
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
          text: '3DStreet Editor Snapshot AI Render',
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

// Replicate API function for image generation
const generateReplicateImage = functions
  .runWith({ secrets: ["REPLICATE_API_TOKEN", "ALLOWED_PRO_TEAM_DOMAINS", "DISCORD_WEBHOOK_URL"] })
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
    const { prompt, input_image, guidance = 2.5, num_inference_steps = 30, model_version, scene_id } = data;


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


    if (!tokenData.genToken || tokenData.genToken <= 0) {
        throw new functions.https.HttpsError('resource-exhausted', 'No generation tokens available');
    }

    // Validate required data
    if (!prompt || !input_image) {
      console.error(`Missing required data - prompt: ${!!prompt}, input_image: ${!!input_image}`);
      throw new functions.https.HttpsError('invalid-argument', 'Missing required prompt or input_image.');
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

      // Use provided model version or default to Kontext Real Earth
      const defaultModelVersion = "2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755";
      const modelVersionToUse = model_version || defaultModelVersion;


      // Different models use different input parameter names and formats
      let modelInput = {
        prompt: prompt,
        guidance: guidance,
        num_inference_steps: num_inference_steps
      };

      // Check if this is the Nano Banana model (uses different input format)
      if (modelVersionToUse === 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0') {
        // Nano Banana uses image_input as an array
        modelInput.image_input = [imageUrl];
        modelInput.output_format = 'jpg';
        // Remove parameters that Nano Banana doesn't use
        delete modelInput.guidance;
        delete modelInput.num_inference_steps;
      } else if (modelVersionToUse === '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569') {
        // Seedream uses image_input as an array and different parameters
        modelInput.image_input = [imageUrl];
        modelInput.size = '2K';
        modelInput.aspect_ratio = 'match_input_image';
        modelInput.output_format = 'jpg';
        // Remove parameters that Seedream doesn't use
        delete modelInput.guidance;
        delete modelInput.num_inference_steps;
      } else {
        // Kontext models use input_image as string
        modelInput.input_image = imageUrl;
        modelInput.output_format = 'jpg';
      }

      const prediction = await replicate.predictions.create({
        version: modelVersionToUse,
        input: modelInput
      });


      // Wait for the prediction to complete
      const output = await replicate.wait(prediction);


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
        if (currentTokens <= 0) {
          throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
        }

        // Calculate new token count (prevent going below 0)
        const newTokenCount = Math.max(0, currentTokens - 1);
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
        console.error('Unexpected output format from Replicate:', output);
        throw new Error('Invalid output format from Replicate API');
      }

      // Post AI-generated image to Discord (non-blocking)
      // This runs in the background and won't fail the image generation if it errors
      postAIImageToDiscord(userId, finalImageUrl, prompt, modelVersionToUse, scene_id)
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
      
      // If it's a Replicate error, include more details
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        throw new functions.https.HttpsError('internal', `Replicate API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      
      throw new functions.https.HttpsError('internal', `Failed to generate image: ${error.message}`);
    }
  });

module.exports = { generateReplicateImage };