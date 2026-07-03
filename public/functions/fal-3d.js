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

// fal is a poll-provider in the async job queue (like modal): there is no
// webhook, so completion is discovered by polling fal's status endpoint. This
// returns a Replicate-shaped prediction ({ status, output, error }) so the
// shared terminal processor and the reconciler handle it uninstrumented, or
// { absent: true } if fal no longer knows the request (expired/unknown). The
// `output` on success is the plain GLB URL string, which extractSplatUrl in
// replicate.js resolves the same as a splat/video output.
async function fetchFalPrediction(job) {
  const key = process.env.FAL_KEY;
  const statusUrl = job.statusUrl;
  const responseUrl = job.responseUrl;

  // No status URL recorded (submit crashed before it could be stored) — let the
  // reconciler's give-up window own declaring it dead.
  if (!statusUrl) return { absent: true };

  const statusResp = await fetch(statusUrl, {
    method: 'GET',
    headers: { Authorization: `Key ${key}` }
  });
  if (statusResp.status === 404) return { absent: true };
  if (!statusResp.ok) {
    throw new Error(`fal status fetch failed: ${statusResp.status}`);
  }
  const statusResult = await statusResp.json();
  const falStatus = statusResult.status;

  if (falStatus === 'COMPLETED') {
    let response = statusResult.response;
    if (!response && responseUrl) {
      const r = await fetch(responseUrl, {
        method: 'GET',
        headers: { Authorization: `Key ${key}` }
      });
      if (r.ok) response = await r.json();
    }
    // fal 3D models return the mesh under model_mesh; accept aliases defensively.
    const meshUrl =
      response?.model_mesh?.url ||
      response?.model_glb?.url ||
      response?.mesh?.url ||
      response?.glb?.url ||
      null;
    if (!meshUrl) {
      console.error('Unexpected fal 3D output:', JSON.stringify(response));
      return {
        prediction: {
          status: 'failed',
          error: 'No mesh URL returned from fal.ai.'
        }
      };
    }
    return { prediction: { status: 'succeeded', output: meshUrl } };
  }

  if (falStatus === 'FAILED' || falStatus === 'ERROR') {
    return {
      prediction: {
        status: 'failed',
        error: statusResult.error || 'fal.ai 3D generation failed.'
      }
    };
  }

  // IN_QUEUE / IN_PROGRESS → still working. Map to Replicate's vocabulary so
  // normalizeReplicateStatus lands on queued/running.
  return {
    prediction: {
      status: falStatus === 'IN_QUEUE' ? 'starting' : 'processing'
    }
  };
}

// Refund a charged fal mesh job once (submit-time failure path). Duplicated
// from replicate.js's refundSplatToken rather than imported, to keep fal-3d.js
// free of a require on replicate.js (replicate.js requires THIS module).
async function refundMeshTokenInline(db, userId, jobRef, tokenCost) {
  try {
    await db.runTransaction(async (tx) => {
      const jobDoc = await tx.get(jobRef);
      const job = jobDoc.exists ? jobDoc.data() : {};
      if (!job.tokenCharged || job.refunded) return;
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tx.get(tokenProfileRef);
      if (tokenDoc.exists) {
        tx.update(tokenProfileRef, {
          genToken: (tokenDoc.data().genToken || 0) + tokenCost,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      tx.update(jobRef, { refunded: true });
    });
  } catch (err) {
    console.error('Failed to refund mesh token:', err);
  }
}

// fal.ai image → 3D mesh (GLB) generation. Submit-and-return: stage the input,
// write a pending `kind: 'mesh'` job to the async queue, charge tokens at submit
// (refunded once on failure), submit to fal's queue, and return the jobId
// immediately. The client polls getGenerationJobStatus; the reconciler backstops
// a closed tab. These endpoints (Hunyuan3D v2, TRELLIS 2) are image-to-3D only:
// a reference image is required (no text prompt input).
const generateFalMesh = functions
  .runWith({
    secrets: ['FAL_KEY'],
    // Submit-and-return: only stages the image + submits, so no long poll. The
    // long-running fal job is finalized later by the poll/reconciler paths.
    timeoutSeconds: 120
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
    const { input_image, model_id, scene_id, source = 'generator', notify } = data;
    // Opt-in completion email. `pending: true` is the flag the notify sweep
    // queries on; it clears when the email sends or an open tab acks the result.
    const wantsEmail = notify?.email === true;

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

    // Fast, friendly insufficient-tokens check before we stage anything. The
    // charge transaction below re-checks authoritatively.
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
    if (!tokenData || !tokenData.genToken || tokenData.genToken < tokenCost) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Not enough generation tokens. This model requires ${tokenCost} token(s), but you have ${tokenData?.genToken || 0}.`
      );
    }

    const db = admin.firestore();
    // jobId (a uuid) is the Firestore doc id; the fal request_id is stored as
    // providerJobId. Frozen at submit so the poll/reconciler paths converge.
    const jobId = crypto.randomUUID();
    const jobRef = db
      .collection('users')
      .doc(userId)
      .collection('generationJobs')
      .doc(jobId);

    // Stable names for the saved gallery asset, fixed at submit so every
    // finalize path produces identical metadata.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const assetSlug = modelConfig.assetSlug || 'fal-3d';
    const assetLabel = modelConfig.assetLabel || `${modelConfig.name} Model`;
    const originalFilename = `${assetSlug}-${stamp}.glb`;
    const assetName = `${assetLabel} ${stamp}`;

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
      }

      // Write the pending job BEFORE charging/submitting, mirroring the splat and
      // video submit paths. Normalized status vocabulary keeps the reconciler's
      // "find non-terminal jobs" query provider-agnostic.
      await jobRef.set({
        status: 'queued',
        providerStatus: null,
        kind: 'mesh',
        provider: 'fal',
        providerJobId: null,
        statusUrl: null,
        responseUrl: null,
        model: modelConfig.attribution?.modelName || modelConfig.name,
        modelId: model_id,
        endpoint: modelConfig.endpoint,
        source,
        tokenCost,
        tokenCharged: false,
        refunded: false,
        tempFilePath: tempImagePath || null,
        originalFilename,
        assetName,
        attribution: modelConfig.attribution || {
          model: 'fal-3d',
          modelName: '3D Model',
          sourceType: 'image'
        },
        sceneId: scene_id || null,
        notify: { email: wantsEmail, pending: wantsEmail },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Charge at submit and set `tokenCharged` in the same transaction, so every
      // later refund path (poll, reconciler) observes tokenCharged:true and
      // refunds exactly once.
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
        transaction.update(jobRef, { tokenCharged: true });
      });

      // Submit to fal's queue. imageField/params come from the model config
      // because the two endpoints differ (input_image_url vs image_url).
      const falPayload = {
        [modelConfig.imageField]: imageUrl,
        ...(modelConfig.params || {})
      };
      const submitResponse = await fetch(
        `https://queue.fal.run/${modelConfig.endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(falPayload)
        }
      );
      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        console.error(`fal 3D submit error: ${submitResponse.status} - ${errorText}`);
        throw new Error(`fal.ai API error: ${submitResponse.status}`);
      }
      const submitResult = await submitResponse.json();
      const requestId = submitResult.request_id;
      const statusUrl = submitResult.status_url;
      const responseUrl = submitResult.response_url;
      if (!requestId || !statusUrl || !responseUrl) {
        console.error('Missing fields in fal 3D response:', JSON.stringify(submitResult));
        throw new Error('Invalid response from fal.ai - missing request_id/status_url/response_url');
      }

      // Record the provider identity so the poll/reconciler can finalize it.
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
      console.error('Error submitting 3D model to fal.ai:', error.message);

      // Refund if we already charged, and finalize the job as failed so it
      // doesn't sit non-terminal until the reconciler's give-up window.
      await refundMeshTokenInline(db, userId, jobRef, tokenCost);
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
        `Failed to start 3D generation: ${error.message}`
      );
    }
  });

module.exports = { generateFalMesh, saveMeshToGallery, fetchFalPrediction };
