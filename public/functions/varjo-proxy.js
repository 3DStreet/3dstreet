/**
 * Varjo Teleport API Proxy Functions
 *
 * Firebase Cloud Functions for proxying requests to the Varjo Teleport API.
 * Handles authentication, token management, and secure API key storage.
 *
 * Splat jobs are stored in users/{userId}/assets collection alongside other
 * gallery assets, with status tracking for processing state.
 *
 * Architecture:
 * 1. User initiates capture → asset created with status 'uploading'
 * 2. User uploads directly to Varjo via presigned URLs
 * 3. Finalize upload → status 'processing', tokens deducted
 * 4. Varjo webhook fires when complete → varjoWebhook handler
 * 5. Server downloads PLY, uploads to Firebase Storage
 * 6. Asset updated to status 'ready', email sent to user
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');
const { sendAssetReadyEmail } = require('./asset-notifications.js');

const AUTH_ENDPOINT = 'https://signin.teleport.varjo.com/oauth2/token';
const API_BASE = 'https://teleport.varjo.com';

/**
 * Calculate token cost based on input size and type
 * @param {number} bytesize - File size in bytes
 * @param {string} inputType - 'video' or 'bulk-images'
 * @returns {number} Token cost
 */
function calculateSplatTokenCost(bytesize, inputType) {
  const mb = bytesize / (1024 * 1024);

  if (inputType === 'video') {
    if (mb < 100) return 20;
    if (mb < 500) return 40;
    return 60;
  } else {
    // bulk-images (ZIP) - estimate image count from file size (average 5MB per image)
    const estimatedImages = Math.ceil(bytesize / (5 * 1024 * 1024));
    if (estimatedImages < 50) return 15;
    if (estimatedImages < 200) return 30;
    return 50;
  }
}

/**
 * Get Varjo OAuth2 access token
 * @returns {Promise<string>} Access token
 */
async function getVarjoAccessToken() {
  const clientId = process.env.VARJO_CLIENT_ID;
  const clientSecret = process.env.VARJO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Varjo API credentials not configured'
    );
  }

  const response = await fetch(AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid profile email'
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Varjo auth failed:', response.status, text);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to authenticate with Varjo API'
    );
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Get user's assets collection reference
 * @param {string} userId - User ID
 * @returns {FirebaseFirestore.CollectionReference} Collection reference
 */
function getUserAssetsCollection(userId) {
  return admin.firestore().collection('users').doc(userId).collection('assets');
}

/**
 * Download file from URL and upload to Firebase Storage
 * @param {string} downloadUrl - URL to download from
 * @param {string} storagePath - Firebase Storage path
 * @returns {Promise<string>} - Public download URL
 */
async function downloadAndUploadToStorage(downloadUrl, storagePath) {
  const bucket = admin.storage().bucket();

  // Download the file
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload to Firebase Storage
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000' // 1 year cache
    }
  });

  // Make the file publicly accessible and get URL
  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  return publicUrl;
}

/**
 * Get user display name from email or auth record
 * @param {string} email - User email
 * @param {string} userId - User ID (optional)
 * @returns {string} Display name
 */
async function getUserDisplayName(email, userId) {
  if (userId) {
    try {
      const userRecord = await getAuth().getUser(userId);
      if (userRecord.displayName) {
        return userRecord.displayName;
      }
    } catch (error) {
      // Fall through to email-based name
    }
  }
  // Extract name from email
  return email ? email.split('@')[0] : 'there';
}

/**
 * Initialize a Varjo capture and return presigned upload URLs
 *
 * This function creates a capture on Varjo and pre-fetches ALL presigned URLs
 * so the client can upload directly without additional round trips.
 *
 * Creates a splat asset in the user's gallery with status 'uploading'.
 */
const initVarjoCapture = functions
  .runWith({
    secrets: ['VARJO_CLIENT_ID', 'VARJO_CLIENT_SECRET'],
    timeoutSeconds: 60
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to create captures.'
      );
    }

    const userId = context.auth.uid;
    const { name, bytesize, input_data_format } = data;

    // Get user email for notifications
    let userEmail = null;
    try {
      const userRecord = await getAuth().getUser(userId);
      userEmail = userRecord.email;
    } catch (error) {
      console.warn('Could not get user email:', error);
    }

    // Validate input
    if (!name || !bytesize || !input_data_format) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: name, bytesize, input_data_format'
      );
    }

    if (!['video', 'bulk-images'].includes(input_data_format)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'input_data_format must be "video" or "bulk-images"'
      );
    }

    // Check file size limits (max 1GB for video, 500MB for images)
    const maxSize =
      input_data_format === 'video' ? 1024 * 1024 * 1024 : 500 * 1024 * 1024;
    if (bytesize > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      throw new functions.https.HttpsError(
        'invalid-argument',
        `File too large. Maximum size is ${maxMB}MB for ${input_data_format}`
      );
    }

    // Calculate token cost
    const estimatedTokens = calculateSplatTokenCost(bytesize, input_data_format);

    // Check user tokens
    let tokenData;
    try {
      tokenData = await checkAndRefillImageTokensInternal(userId);
    } catch (error) {
      console.error('Token check failed:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to check token balance'
      );
    }

    if (!tokenData || !tokenData.genToken || tokenData.genToken < estimatedTokens) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Insufficient tokens. This capture requires ${estimatedTokens} tokens, but you have ${tokenData?.genToken || 0}.`
      );
    }

    try {
      // Get Varjo access token
      const accessToken = await getVarjoAccessToken();

      // Create capture on Varjo
      const createResponse = await fetch(`${API_BASE}/api/v1/captures`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          bytesize,
          input_data_format
        })
      });

      if (!createResponse.ok) {
        const text = await createResponse.text();
        console.error('Varjo create capture failed:', createResponse.status, text);
        throw new functions.https.HttpsError(
          'internal',
          'Failed to create capture on Varjo'
        );
      }

      const capture = await createResponse.json();
      const { eid, num_parts, chunk_size } = capture;

      // Pre-fetch ALL presigned upload URLs
      const uploadUrls = [];
      for (let partNo = 1; partNo <= num_parts; partNo++) {
        const urlResponse = await fetch(
          `${API_BASE}/api/v1/captures/${eid}/create-upload-url/${partNo}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ eid, bytesize })
          }
        );

        if (!urlResponse.ok) {
          console.error(`Failed to get upload URL for part ${partNo}`);
          throw new functions.https.HttpsError(
            'internal',
            `Failed to get upload URL for part ${partNo}`
          );
        }

        const { upload_url } = await urlResponse.json();
        uploadUrls.push({ part_no: partNo, url: upload_url });
      }

      // Create splat asset in user's gallery with 'uploading' status
      const assetsCollection = getUserAssetsCollection(userId);
      const assetRef = assetsCollection.doc(); // Auto-generate ID
      const assetId = assetRef.id;

      await assetRef.set({
        // Standard gallery asset fields
        type: 'splat',
        category: 'splat-output',
        userId,
        userEmail, // Store for notification
        status: 'uploading',

        // Provider info (allows for future providers)
        provider: 'varjo',
        providerData: {
          eid
        },

        // Input metadata
        name,
        bytesize,
        inputDataFormat: input_data_format,

        // Token tracking
        estimatedTokens,
        tokensCharged: 0,

        // Output fields (populated when complete via webhook)
        storagePath: null,
        storageUrl: null,
        outputUrl: null,
        viewerUrl: null,

        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        assetId,
        capture: {
          eid,
          num_parts,
          chunk_size
        },
        upload_urls: uploadUrls,
        estimated_tokens: estimatedTokens
      };
    } catch (error) {
      if (error.code) {
        throw error; // Re-throw Firebase errors
      }
      console.error('Error in initVarjoCapture:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to initialize capture: ${error.message}`
      );
    }
  });

/**
 * Finalize a Varjo upload after the client has uploaded all parts
 *
 * This function marks the upload as complete and starts processing.
 * Tokens are deducted at this point.
 */
const finalizeVarjoUpload = functions
  .runWith({
    secrets: ['VARJO_CLIENT_ID', 'VARJO_CLIENT_SECRET'],
    timeoutSeconds: 60
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to finalize uploads.'
      );
    }

    const userId = context.auth.uid;
    const { assetId, eid, parts } = data;

    // Validate input
    if (!assetId || !eid || !parts || !Array.isArray(parts)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: assetId, eid, parts'
      );
    }

    const db = admin.firestore();
    const assetRef = getUserAssetsCollection(userId).doc(assetId);

    // Verify asset exists and belongs to user
    const assetDoc = await assetRef.get();
    if (!assetDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Splat asset not found');
    }

    const assetData = assetDoc.data();
    if (assetData.userId !== userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Asset does not belong to user'
      );
    }

    if (assetData.providerData?.eid !== eid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'EID mismatch'
      );
    }

    try {
      // Get Varjo access token
      const accessToken = await getVarjoAccessToken();

      // Finalize upload on Varjo
      const finalizeResponse = await fetch(
        `${API_BASE}/api/v1/captures/${eid}/uploaded`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ eid, parts })
        }
      );

      if (!finalizeResponse.ok) {
        const text = await finalizeResponse.text();
        console.error('Varjo finalize failed:', finalizeResponse.status, text);
        throw new functions.https.HttpsError(
          'internal',
          'Failed to finalize upload on Varjo'
        );
      }

      const result = await finalizeResponse.json();

      // Deduct tokens using atomic transaction
      const tokenProfileRef = db.collection('tokenProfile').doc(userId);
      const tokensToCharge = assetData.estimatedTokens;
      let remainingTokens = 0;

      await db.runTransaction(async (transaction) => {
        const tokenDoc = await transaction.get(tokenProfileRef);

        if (!tokenDoc.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            'Token profile not found'
          );
        }

        const currentTokens = tokenDoc.data().genToken || 0;

        if (currentTokens < tokensToCharge) {
          throw new functions.https.HttpsError(
            'resource-exhausted',
            'Insufficient tokens'
          );
        }

        const newTokenCount = Math.max(0, currentTokens - tokensToCharge);
        remainingTokens = newTokenCount;

        transaction.update(tokenProfileRef, {
          genToken: newTokenCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Update asset status to 'processing'
      // User can now close browser - webhook will handle completion
      await assetRef.update({
        status: 'processing',
        tokensCharged: tokensToCharge,
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        state: result.state || 'processing',
        message: 'Upload finalized, processing started. You will receive an email when complete.',
        tokensCharged: tokensToCharge,
        remainingTokens
      };
    } catch (error) {
      if (error.code) {
        throw error; // Re-throw Firebase errors
      }
      console.error('Error in finalizeVarjoUpload:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to finalize upload: ${error.message}`
      );
    }
  });

/**
 * Webhook handler for Varjo capture completion
 *
 * This is called by Varjo when a capture finishes processing.
 * It downloads the PLY file, uploads to Firebase Storage, and notifies the user.
 *
 * Expected webhook payload (assumed format - adjust based on actual docs):
 * {
 *   event: 'capture.ready' | 'capture.failed',
 *   eid: string,
 *   sid?: string,
 *   viewer_url?: string,
 *   timestamp: string
 * }
 *
 * Register this webhook URL with Varjo:
 * https://<project-id>.cloudfunctions.net/varjoWebhook
 */
const varjoWebhook = functions
  .runWith({
    secrets: ['VARJO_CLIENT_ID', 'VARJO_CLIENT_SECRET', 'VARJO_WEBHOOK_SECRET', 'POSTMARK_API_KEY'],
    timeoutSeconds: 300, // 5 minutes for download/upload
    memory: '1GB' // PLY files can be large
  })
  .https.onRequest(async (req, res) => {
    // Only accept POST
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.VARJO_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers['x-varjo-signature'] ||
                       req.headers['x-webhook-signature'] ||
                       req.headers['authorization'];

      // Common signature verification patterns:
      // 1. HMAC-SHA256 of body
      // 2. Bearer token
      // 3. Simple shared secret header
      if (signature !== webhookSecret && signature !== `Bearer ${webhookSecret}`) {
        // For HMAC, would need: crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex')
        console.error('Invalid webhook signature');
        res.status(401).send('Unauthorized');
        return;
      }
    }

    const payload = req.body;
    console.log('Varjo webhook received:', JSON.stringify(payload));

    // Extract event data - adjust field names based on actual Varjo webhook format
    const event = payload.event || payload.type || payload.status;
    const eid = payload.eid || payload.capture_id || payload.id;
    const sid = payload.sid || payload.share_id;
    const viewerUrl = payload.viewer_url || payload.viewerUrl;

    if (!eid) {
      console.error('Webhook missing eid');
      res.status(400).send('Missing capture identifier');
      return;
    }

    // Respond quickly to webhook - process async
    res.status(200).send('OK');

    const db = admin.firestore();

    try {
      // Find the asset by provider eid using collection group query
      const assetsQuery = await db.collectionGroup('assets')
        .where('provider', '==', 'varjo')
        .where('providerData.eid', '==', eid)
        .limit(1)
        .get();

      if (assetsQuery.empty) {
        console.error(`No asset found for eid: ${eid}`);
        return;
      }

      const assetDoc = assetsQuery.docs[0];
      const assetData = assetDoc.data();
      const assetRef = assetDoc.ref;
      const userId = assetData.userId;
      const assetId = assetDoc.id;

      // Handle failure
      if (event === 'capture.failed' || event === 'failed' || event === 'error') {
        const errorMsg = payload.error || payload.message || 'Processing failed';

        await assetRef.update({
          status: 'error',
          errorMessage: errorMsg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Notify user of failure
        if (assetData.userEmail) {
          const userName = await getUserDisplayName(assetData.userEmail, userId);
          await sendAssetReadyEmail({
            email: assetData.userEmail,
            userName,
            assetName: assetData.name,
            assetType: 'splat',
            provider: 'varjo',
            status: 'error',
            errorMessage: errorMsg
          });
        }
        return;
      }

      // Handle success - download and re-upload to our storage
      if (event === 'capture.ready' || event === 'ready' || event === 'completed' || !event) {
        // Get Varjo access token to fetch the model
        const accessToken = await getVarjoAccessToken();

        // Get download URL for PLY format
        // First, get the sid if we don't have it
        let shareSid = sid;
        if (!shareSid) {
          // Fetch capture details to get sid
          const capturesResponse = await fetch(`${API_BASE}/api/v1/captures`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (capturesResponse.ok) {
            const captures = await capturesResponse.json();
            const capture = captures.find((c) => c.eid === eid);
            if (capture) {
              shareSid = capture.sid;
            }
          }
        }

        if (!shareSid) {
          console.error(`Could not get sid for eid: ${eid}`);
          await assetRef.update({
            status: 'error',
            errorMessage: 'Could not retrieve share ID',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
        }

        // Get metadata with PLY download URL
        const metadataResponse = await fetch(
          `${API_BASE}/share/${shareSid}/metadata?profiles=ply`,
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );

        if (!metadataResponse.ok) {
          console.error('Failed to get metadata:', metadataResponse.status);
          await assetRef.update({
            status: 'error',
            errorMessage: 'Could not retrieve download URL',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
        }

        const metadata = await metadataResponse.json();
        const plyModel = metadata.models?.ply;

        if (!plyModel?.url) {
          console.error('No PLY URL in metadata');
          await assetRef.update({
            status: 'error',
            errorMessage: 'PLY format not available',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
        }

        // Download from Varjo and upload to Firebase Storage
        const storagePath = `users/${userId}/assets/splats/${assetId}.ply`;

        try {
          console.log(`Downloading PLY from Varjo and uploading to ${storagePath}`);
          const storageUrl = await downloadAndUploadToStorage(plyModel.url, storagePath);

          // Determine viewer URL
          const finalViewerUrl = viewerUrl ||
            payload.viewer_url ||
            `https://teleport.varjo.com/share/${shareSid}`;

          // Update asset with completion info
          await assetRef.update({
            status: 'ready',
            storagePath,
            storageUrl,
            outputUrl: plyModel.url, // Original Varjo URL (may expire)
            viewerUrl: finalViewerUrl,
            'providerData.sid': shareSid,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`Splat ready: ${assetId} for user ${userId}`);

          // Send email notification
          if (assetData.userEmail) {
            const userName = await getUserDisplayName(assetData.userEmail, userId);
            await sendAssetReadyEmail({
              email: assetData.userEmail,
              userName,
              assetName: assetData.name,
              assetType: 'splat',
              provider: 'varjo',
              viewerUrl: finalViewerUrl,
              status: 'ready'
            });
          }
        } catch (uploadError) {
          console.error('Failed to download/upload PLY:', uploadError);
          const errorMsg = 'Failed to save splat file';
          await assetRef.update({
            status: 'error',
            errorMessage: errorMsg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Notify user of upload failure
          if (assetData.userEmail) {
            const userName = await getUserDisplayName(assetData.userEmail, userId);
            await sendAssetReadyEmail({
              email: assetData.userEmail,
              userName,
              assetName: assetData.name,
              assetType: 'splat',
              provider: 'varjo',
              status: 'error',
              errorMessage: errorMsg
            });
          }
        }
      }
    } catch (error) {
      console.error('Webhook processing error:', error);
    }
  });

/**
 * Check Varjo capture status (manual polling fallback)
 *
 * This can be used as a fallback if webhooks aren't working,
 * or for users who want to check status without waiting for email.
 */
const checkVarjoStatus = functions
  .runWith({
    secrets: ['VARJO_CLIENT_ID', 'VARJO_CLIENT_SECRET'],
    timeoutSeconds: 30
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to check status.'
      );
    }

    const userId = context.auth.uid;
    const { assetId } = data;

    // Validate input
    if (!assetId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required field: assetId'
      );
    }

    const assetRef = getUserAssetsCollection(userId).doc(assetId);

    // Verify asset exists and belongs to user
    const assetDoc = await assetRef.get();
    if (!assetDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Splat asset not found');
    }

    const assetData = assetDoc.data();
    if (assetData.userId !== userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Asset does not belong to user'
      );
    }

    // If already complete or error, just return current status
    if (assetData.status === 'ready') {
      return {
        success: true,
        state: 'ready',
        storageUrl: assetData.storageUrl,
        viewerUrl: assetData.viewerUrl
      };
    }

    if (assetData.status === 'error') {
      return {
        success: true,
        state: 'error',
        message: assetData.errorMessage || 'Processing failed'
      };
    }

    const eid = assetData.providerData?.eid;
    if (!eid) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Asset missing provider data'
      );
    }

    try {
      // Get Varjo access token
      const accessToken = await getVarjoAccessToken();

      // Get capture status from Varjo
      const capturesResponse = await fetch(`${API_BASE}/api/v1/captures`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!capturesResponse.ok) {
        console.error('Failed to get captures:', capturesResponse.status);
        throw new functions.https.HttpsError(
          'internal',
          'Failed to get capture status from Varjo'
        );
      }

      const captures = await capturesResponse.json();
      const capture = captures.find((c) => c.eid === eid);

      if (!capture) {
        throw new functions.https.HttpsError(
          'not-found',
          'Capture not found on Varjo'
        );
      }

      // Map Varjo state to our status
      const normalizedState = capture.state.toLowerCase();
      const statusMap = {
        'uploading': 'uploading',
        'processing': 'processing',
        'ready': 'ready',
        'failed': 'error'
      };
      const newStatus = statusMap[normalizedState] || normalizedState;

      // If Varjo says ready but we haven't processed yet, trigger processing
      if (capture.state === 'READY' && assetData.status !== 'ready') {
        // Update status and let user know they may need to wait for webhook
        // or we can trigger the download here as a fallback
        await assetRef.update({
          'providerData.sid': capture.sid,
          viewerUrl: capture.viewer_url,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
          success: true,
          state: 'ready',
          message: 'Processing complete! Your splat will be saved shortly.',
          viewerUrl: capture.viewer_url
        };
      }

      return {
        success: true,
        state: newStatus,
        message: newStatus === 'processing'
          ? 'Still processing. You will receive an email when complete.'
          : `Current state: ${newStatus}`
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      console.error('Error in checkVarjoStatus:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to check status: ${error.message}`
      );
    }
  });

module.exports = {
  initVarjoCapture,
  finalizeVarjoUpload,
  checkVarjoStatus,
  varjoWebhook
};
