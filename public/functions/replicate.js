const functions = require('firebase-functions');
const Replicate = require('replicate');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

// Replicate API function for image generation
const generateReplicateImage = functions
  .runWith({ secrets: ["REPLICATE_API_TOKEN"] })
  .https
  .onCall(async (data, context) => {
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to generate images.');
    }

    const userId = context.auth.uid;
    const { prompt, input_image, guidance = 2.5, num_inference_steps = 30 } = data;
    
    // Check if user is Pro or has tokens
    const db = admin.firestore();
    let canProceed = false;
    let isProUser = false;

    // Check if user has Pro subscription or is from pro domains
    try {
      const userRecord = await getAuth().getUser(userId);
      
      // Check for Pro subscription via custom claims
      if (userRecord.customClaims && userRecord.customClaims.plan === 'PRO') {
        canProceed = true;
        isProUser = true;
      }
      
      // Check for pro domains (uoregon.edu)
      const PRO_DOMAINS = ['uoregon.edu'];
      if (!isProUser && userRecord.email) {
        const userDomain = PRO_DOMAINS.find(domain => userRecord.email.includes(domain));
        if (userDomain) {
          canProceed = true;
          isProUser = true;
          console.log(`User ${userRecord.email} granted pro access via domain: ${userDomain}`);
        }
      }
    } catch (error) {
      console.log('Error checking user claims:', error);
    }

    // If not Pro, check tokens
    if (!canProceed) {
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tokenProfileRef.get();
      
      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data();
        if (tokenData.imageToken > 0) {
          canProceed = true;
        }
      } else {
        // Create initial token profile with 3 tokens for each type
        await tokenProfileRef.set({
          userId: userId,
          geoToken: 3,
          imageToken: 3,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        canProceed = true;
      }
    }

    if (!canProceed) {
      throw new functions.https.HttpsError('permission-denied', 'No tokens or Pro subscription available');
    }

    // Validate required data
    if (!prompt || !input_image) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required prompt or input_image.');
    }

    try {
      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
      });

      let imageUrl = input_image;

      // If input_image is a base64 data URL, upload it to Firebase Storage first
      if (input_image.startsWith('data:image/')) {
        console.log('Converting base64 image to public URL...');
        
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
        
        console.log('Uploaded temp image to:', imageUrl);
      }

      console.log('Calling Replicate with:', {
        prompt,
        input_image: imageUrl,
        guidance,
        num_inference_steps
      });

      const prediction = await replicate.predictions.create({
        version: "2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755",
        input: {
          prompt: prompt,
          input_image: imageUrl,
          guidance: guidance,
          num_inference_steps: num_inference_steps
        }
      });

      console.log('Replicate prediction created:', prediction);

      // Wait for the prediction to complete
      const output = await replicate.wait(prediction);

      console.log('Replicate output:', output);
      console.log('Replicate output type:', typeof output);
      console.log('Replicate output keys:', Object.keys(output || {}));

      // Clean up temp file if we created one
      if (input_image.startsWith('data:image/') && imageUrl !== input_image) {
        try {
          const bucket = admin.storage().bucket();
          const filename = imageUrl.split('/').pop();
          await bucket.file(`temp/${filename}`).delete();
          console.log('Cleaned up temp file:', filename);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }

      // Decrement token if not a Pro user (only after successful image generation)
      let remainingTokens = null;
      if (!isProUser) {
        const tokenProfileRef = db.collection('tokenProfile').doc(userId);
        const tokenDoc = await tokenProfileRef.get();
        
        if (tokenDoc.exists) {
          const currentTokens = tokenDoc.data().imageToken;
          const newTokenCount = Math.max(0, currentTokens - 1);
          
          await tokenProfileRef.update({
            imageToken: newTokenCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          remainingTokens = newTokenCount;
        }
      }

      // Handle different output formats from Replicate
      const imageUrl = Array.isArray(output) ? output[0] : output;
      
      return { 
        success: true, 
        image_url: imageUrl,
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