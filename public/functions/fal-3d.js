const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { checkAndRefillImageTokensInternal, chargeGenerationTokens } = require('./token-management.js');
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

// Authoritative fal status fetch, shared by every finalize path (client poll,
// falJobWebhook, reconciler — the webhook body is never trusted, so all three
// converge here). Returns a Replicate-shaped prediction ({ status, output,
// error }) so the shared terminal processor handles it uninstrumented, or
// { absent: true } if fal no longer knows the request (expired/unknown). The
// `output` on success is a plain URL string (GLB for mesh jobs, image URL for
// image jobs — selected by job.kind), which extractSplatUrl in replicate.js
// resolves the same as a splat/video output.
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
      // Throw (like the status fetch above) rather than fall through with an
      // empty response: a transient non-OK here must stay retryable, or a
      // COMPLETED job gets finalized as failed and can never be resurrected.
      if (!r.ok) {
        throw new Error(`fal response fetch failed: ${r.status}`);
      }
      response = await r.json();
    }

    // Image models (flux-2 edit family) return { images: [{ url }] }.
    if (job.kind === 'image') {
      const falImageUrl = response?.images?.[0]?.url || null;
      if (!falImageUrl) {
        console.error('Unexpected fal image output:', JSON.stringify(response));
        return {
          prediction: {
            status: 'failed',
            error: 'No image URL returned from fal.ai.'
          }
        };
      }
      return { prediction: { status: 'succeeded', output: falImageUrl } };
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

// Client-supplied extras for the saved gallery asset's generationMetadata
// (e.g. the editor's sceneTitle/cameraState/renderMode, which power the
// gallery's scene link and focus-camera button). The image submit callables
// store this on the job doc so the server-side persist can write metadata
// the old client-side save used to write. Owner-scoped data (the user could
// already write arbitrary metadata onto their own asset docs client-side),
// but sanitize shape and bound size so a job doc can't be ballooned.
function sanitizeGalleryMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    // Round-trip through JSON to drop undefined/functions/cycles.
    const clean = JSON.parse(JSON.stringify(raw));
    if (JSON.stringify(clean).length > 20000) return null;
    return clean;
  } catch {
    return null;
  }
}

// Batch identity for the one-email-per-user-action contract (editor 4x
// render): the client stamps the same batchId (+ batchTotal) on every job it
// submits for a single action, and sendGenerationOutcomeEmail lets only the
// batch's first finisher decide whether an email goes out. Untrusted client
// input — validate shape, never interpolate unvalidated.
function sanitizeNotifyBatch(notify) {
  const batchId =
    typeof notify?.batchId === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(notify.batchId)
      ? notify.batchId
      : null;
  if (!batchId) return {};
  const batchTotal =
    Number.isInteger(notify?.batchTotal) &&
    notify.batchTotal >= 2 &&
    notify.batchTotal <= 16
      ? notify.batchTotal
      : null;
  return { batchId, ...(batchTotal && { batchTotal }) };
}

// Build the fal queue submit URL with our completion webhook attached
// (fal_webhook query param — fal POSTs it when the request reaches a terminal
// state). This gives fal kinds the same real-time, browser-independent
// finalize + email path the Replicate kinds get from replicateJobWebhook
// (issue #1832); the client poll and the reconciler stay unchanged as
// backstops for a dropped delivery. The webhook target (falJobWebhook,
// defined in replicate.js next to the shared handler) is gated by the uid +
// internal jobId + per-job secret in ITS query string; the webhook body is
// never trusted — the handler re-fetches authoritatively via
// fetchFalPrediction. Shared by the mesh and image submit paths.
function falQueueSubmitUrl(endpoint, { jobId, userId, webhookSecret }) {
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    admin.app().options.projectId;
  const region = process.env.FUNCTION_REGION || 'us-central1';
  const webhookUrl =
    `https://${region}-${projectId}.cloudfunctions.net/falJobWebhook` +
    `?jobId=${jobId}&uid=${userId}&token=${webhookSecret}`;
  return `https://queue.fal.run/${endpoint}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
}

// Refund a charged fal job once (submit-time failure path; mesh + image
// kinds). Duplicated from replicate.js's refundSplatToken rather than
// imported, to keep fal-3d.js free of a require on replicate.js (replicate.js
// requires THIS module).
async function refundFalJobInline(db, userId, jobRef, tokenCost) {
  try {
    let refundedNow = false;
    let relatedModel = null;
    let refundSource = 'generation-failed';
    await db.runTransaction(async (tx) => {
      refundedNow = false; // reset — the transaction may retry
      const jobDoc = await tx.get(jobRef);
      const job = jobDoc.exists ? jobDoc.data() : {};
      if (!job.tokenCharged || job.refunded) return;
      relatedModel = job.model || null;
      refundSource = `${job.kind || 'mesh'}-generation-failed`;
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokenDoc = await tx.get(tokenProfileRef);
      if (tokenDoc.exists) {
        tx.update(tokenProfileRef, {
          genToken: (tokenDoc.data().genToken || 0) + tokenCost,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      tx.update(jobRef, { refunded: true });
      refundedNow = true;
    });

    // Fire-and-forget: audit the refund, same ledger entry refundSplatToken
    // writes, so tokenLog balances against generationLog for fal failures too.
    if (refundedNow) {
      db.collection('tokenLog')
        .add({
          userId,
          type: 'refund',
          tokenCost,
          source: refundSource,
          relatedModel,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
        .catch((err) => console.error('Failed to write tokenLog:', err));
    }
  } catch (err) {
    console.error('Failed to refund fal job token:', err);
  }
}

// fal.ai image → 3D mesh (GLB) generation. Submit-and-return: stage the input,
// write a pending `kind: 'mesh'` job to the async queue, charge tokens at submit
// (refunded once on failure), submit to fal's queue (with a completion webhook,
// #1832), and return the jobId immediately. The webhook finalizes + emails in
// real time; the client poll drives live UI and the reconciler backstops a
// dropped delivery. These endpoints (Hunyuan3D v2, TRELLIS 2) are image-to-3D
// only: a reference image is required (no text prompt input).
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
    const webhookSecret = crypto.randomUUID();
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
        webhookSecret,
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

      // Charge at submit and set `tokenCharged` in the same transaction
      // (chargeGenerationTokens), so every later refund path (poll,
      // reconciler) observes tokenCharged:true and refunds exactly once.
      const { remainingTokens } = await chargeGenerationTokens(db, {
        userId,
        jobRef,
        tokenCost,
        source: 'mesh-generation',
        relatedModel: modelConfig.attribution?.modelName || modelConfig.name
      });

      // Submit to fal's queue. imageField/params come from the model config
      // because the two endpoints differ (input_image_url vs image_url).
      // fal_webhook makes fal call falJobWebhook on completion for real-time
      // finalize + email; the poll/reconciler paths remain as backstops.
      const falPayload = {
        [modelConfig.imageField]: imageUrl,
        ...(modelConfig.params || {})
      };
      const submitResponse = await fetch(
        falQueueSubmitUrl(modelConfig.endpoint, {
          jobId,
          userId,
          webhookSecret
        }),
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

module.exports = {
  generateFalMesh,
  saveMeshToGallery,
  fetchFalPrediction,
  falQueueSubmitUrl,
  refundFalJobInline,
  sanitizeGalleryMetadata,
  sanitizeNotifyBatch
};
