const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { REPLICATE_MODELS } = require('./replicate-models.js');
const { assertAppCheck } = require('./app-check.js');

// Guard a uid before using it in a Storage/Firestore path. Mirrors the splat
// path's validateSplatUserId so a bad uid can't escape the user subtree.
function validateMeshUserId(userId) {
  if (
    !userId ||
    typeof userId !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(userId)
  ) {
    throw new Error('Invalid user id for mesh path');
  }
}

/**
 * Download a generated GLB from fal and persist it as a first-class `mesh`
 * asset (Storage + Firestore), mirroring saveSplatToGallery in replicate.js.
 * Runs server-side so the large binary streams straight from fal's CDN to
 * Storage without round-tripping through the browser.
 */
async function saveMeshToGallery(userId, glbUrl, job) {
  validateMeshUserId(userId);

  const assetId = job.predictionId
    ? `fal3d-${job.predictionId}`
    : crypto.randomUUID();
  const filename = `${assetId}.glb`;
  const storagePath = `users/${userId}/assets/meshes/${filename}`;
  const downloadToken = crypto.randomUUID();

  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const objectMetadata = {
    contentType: 'model/gltf-binary',
    // Immutable content (keyed by assetId): cache for a year so the editor and
    // preview modal reuse the browser HTTP cache. Matches saveSplatToGallery.
    cacheControl: 'public, max-age=31536000',
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
      assetRole: 'original',
      assetId
    }
  };

  const response = await fetch(glbUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download mesh from fal (${response.status})`);
  }
  const writeStream = file.createWriteStream({ metadata: objectMetadata });
  await pipeline(Readable.fromWeb(response.body), writeStream);

  // Streamed, so read the byte count back authoritatively for the asset doc /
  // quota trigger.
  const [meta] = await file.getMetadata();
  const size = Number(meta.size) || 0;

  const storageUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin
    .firestore()
    .collection('users')
    .doc(userId)
    .collection('assets')
    .doc(assetId)
    .set({
      assetId,
      userId,
      type: 'mesh',
      category: 'ai-render',
      storagePath,
      storageUrl,
      name: job.assetName || 'Generated 3D Model',
      filename,
      originalFilename: job.originalFilename || filename,
      size,
      mimeType: 'model/gltf-binary',
      generationMetadata: {
        model: job.attribution?.model || 'fal-3d',
        model_name: job.attribution?.modelName || '3D Model',
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

  return { assetId, storageUrl, name: job.assetName || 'Generated 3D Model' };
}

// fal.ai image → 3D mesh (GLB) generation. Synchronous callable: submit to the
// fal queue, poll to completion, download+save the GLB, then charge tokens.
// These endpoints (Hunyuan3D v2, TRELLIS 2) are image-to-3D only: a reference
// image is required (no text prompt input).
const generateFalMesh = functions
  .runWith({
    secrets: ['FAL_KEY'],
    timeoutSeconds: 300 // 5 minutes; 3D generation typically runs 30-90s
  })
  .https.onCall(async (data, context) => {
    if (!process.env.FAL_KEY) {
      console.error('CRITICAL: FAL_KEY secret not loaded');
      throw new functions.https.HttpsError(
        'failed-precondition',
        '3D generation service is not properly configured.'
      );
    }

    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to generate 3D models.'
      );
    }
    assertAppCheck(context);

    const userId = context.auth.uid;
    const { input_image, model_id, scene_id, source = 'generator' } = data;

    const modelConfig = REPLICATE_MODELS[model_id];
    if (!modelConfig || modelConfig.type !== 'fal-3d') {
      console.error(`Invalid fal 3D model: ${model_id}`);
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid model: ${model_id}`
      );
    }

    // These models are image-to-3D only.
    if (!input_image) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'This model requires a reference image. Please add an image to generate a 3D model.'
      );
    }

    const tokenCost = modelConfig.tokenCost || 3;

    let tokenData;
    try {
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (tokenError) {
      console.error(`Error retrieving token data for user ${userId}:`, tokenError);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to retrieve token information: ${tokenError.message}`
      );
    }
    if (!tokenData) {
      throw new functions.https.HttpsError(
        'internal',
        'Failed to retrieve token information. Please try again.'
      );
    }
    if (!tokenData.genToken || tokenData.genToken < tokenCost) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Not enough generation tokens. This model requires ${tokenCost} token(s), but you have ${tokenData.genToken || 0}.`
      );
    }

    const generationStartTime = Date.now();
    let falRequestId = null;
    let tempImagePath = null;

    try {
      // Stage the reference image. If it's a base64 data URL, upload it to a
      // temp Storage object and hand fal a public URL (same as fal-proxy).
      let imageUrl;
      if (input_image.startsWith('data:image/')) {
        const matches = input_image.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new functions.https.HttpsError(
            'invalid-argument',
            'Invalid base64 image format.'
          );
        }
        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filename = `temp-fal3d-input-${userId}-${Date.now()}.jpg`;
        tempImagePath = `temp/${filename}`;

        const bucket = admin.storage().bucket();
        const tempFile = bucket.file(tempImagePath);
        await tempFile.save(imageBuffer, {
          metadata: {
            contentType: mimeType,
            expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          }
        });
        await tempFile.makePublic();
        imageUrl = `https://storage.googleapis.com/${bucket.name}/${tempImagePath}`;
      } else {
        // Already a URL.
        imageUrl = input_image;
        tempImagePath = null;
      }

      // Build the model-specific payload. imageField/params come from the model
      // config because the two endpoints differ (input_image_url vs image_url).
      const falPayload = {
        [modelConfig.imageField]: imageUrl,
        ...(modelConfig.params || {})
      };

      const endpoint = modelConfig.endpoint;
      const submitResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${process.env.FAL_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(falPayload)
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error(`fal 3D submit error: ${submitResponse.status} - ${errorText}`);
        throw new Error(`fal.ai API error: ${submitResponse.status}`);
      }

      const submitResult = await submitResponse.json();
      const requestId = submitResult.request_id;
      falRequestId = requestId || null;
      const statusUrl = submitResult.status_url;
      const responseUrl = submitResult.response_url;

      if (!requestId || !statusUrl || !responseUrl) {
        console.error('Missing fields in fal 3D response:', JSON.stringify(submitResult));
        throw new Error('Invalid response from fal.ai - missing request_id/status_url/response_url');
      }

      // Poll for the result. 140 attempts × 2s ≈ 4.6 min, bounded by the 300s
      // function timeout.
      let attempts = 0;
      const maxAttempts = 140;
      let result = null;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const statusResponse = await fetch(statusUrl, {
          method: 'GET',
          headers: { Authorization: `Key ${process.env.FAL_KEY}` }
        });

        if (!statusResponse.ok) {
          attempts++;
          continue;
        }

        const statusResult = await statusResponse.json();

        if (statusResult.status === 'COMPLETED') {
          if (statusResult.response) {
            result = statusResult.response;
            break;
          }
          const resultResponse = await fetch(responseUrl, {
            method: 'GET',
            headers: { Authorization: `Key ${process.env.FAL_KEY}` }
          });
          if (resultResponse.ok) {
            result = await resultResponse.json();
            break;
          }
        } else if (statusResult.status === 'FAILED') {
          throw new Error(statusResult.error || 'fal.ai 3D generation failed');
        }

        attempts++;
      }

      if (!result) {
        throw new Error('fal.ai 3D generation timed out');
      }

      // Extract the GLB URL. fal 3D models return the mesh under model_mesh;
      // accept a couple of aliases defensively.
      const meshUrl =
        result.model_mesh?.url ||
        result.model_glb?.url ||
        result.mesh?.url ||
        result.glb?.url;
      if (!meshUrl) {
        console.error('Unexpected fal 3D output:', JSON.stringify(result));
        throw new Error('No mesh URL returned from fal.ai');
      }

      // Persist the GLB as a mesh asset (server-side download + save).
      const saved = await saveMeshToGallery(userId, meshUrl, {
        predictionId: requestId,
        assetName: `${modelConfig.name} Model`,
        originalFilename: `${modelConfig.assetSlug || 'model'}.glb`,
        attribution: modelConfig.attribution,
        source
      });

      // Charge tokens only after a successful save.
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
        remainingTokens = Math.max(0, currentTokens - tokenCost);
        transaction.update(tokenProfileRef, {
          genToken: remainingTokens,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Best-effort temp cleanup.
      if (tempImagePath) {
        admin
          .storage()
          .bucket()
          .file(tempImagePath)
          .delete()
          .catch((err) => console.warn('Failed to cleanup temp 3D input:', err.message));
      }

      // Fire-and-forget audit log (same shape as the fal image path).
      db.collection('generationLog')
        .add({
          userId,
          provider: 'fal',
          model: modelConfig.endpoint,
          modelId: model_id,
          generationType: 'mesh',
          tokenCost,
          processingTimeMs: Date.now() - generationStartTime,
          providerPredictionId: falRequestId,
          status: 'succeeded',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
        .catch((err) => console.error('Failed to write generationLog:', err));

      return {
        success: true,
        assetId: saved.assetId,
        model_url: saved.storageUrl,
        name: saved.name,
        scene_id: scene_id || null,
        remainingTokens
      };
    } catch (error) {
      console.error('Error generating 3D model with fal.ai:', error.message);

      // Best-effort temp cleanup on failure too.
      if (tempImagePath) {
        admin
          .storage()
          .bucket()
          .file(tempImagePath)
          .delete()
          .catch(() => {});
      }

      admin
        .firestore()
        .collection('generationLog')
        .add({
          userId,
          provider: 'fal',
          model: modelConfig.endpoint,
          modelId: model_id,
          generationType: 'mesh',
          tokenCost,
          processingTimeMs: Date.now() - generationStartTime,
          providerPredictionId: falRequestId,
          status: 'failed',
          error: error.message,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
        .catch((err) => console.error('Failed to write generationLog:', err));

      if (
        error.code &&
        (error.code.startsWith('resource-exhausted') ||
          error.code.startsWith('unauthenticated') ||
          error.code.startsWith('invalid-argument') ||
          error.code.startsWith('failed-precondition'))
      ) {
        throw error;
      }
      throw new functions.https.HttpsError(
        'internal',
        `Failed to generate 3D model: ${error.message}`
      );
    }
  });

module.exports = { generateFalMesh };
