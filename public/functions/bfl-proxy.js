const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');

const API_BASE_URL = 'https://api.us1.bfl.ai/v1';

// Model endpoint to name mapping
const BFL_MODEL_NAMES = {
  'flux-pro-1.1': 'Flux Pro 1.1',
  'flux-pro': 'Flux Pro',
  'flux-pro-1.1-ultra': 'Flux Pro 1.1 Ultra',
  'flux-dev': 'Flux Dev',
  'flux-pro-1.0-fill': 'Flux Pro 1.0 Fill (Inpaint)',
  'flux-pro-1.0-expand': 'Flux Pro 1.0 Expand (Outpaint)',
  'flux-kontext-pro': 'Flux Kontext Pro',
  'flux-kontext-max': 'Flux Kontext Max'
};

// Helper function to post AI-generated images to Discord
async function postAIImageToDiscord(userId, imageUrl, prompt, modelEndpoint, sceneId) {
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

    // Get model name from endpoint
    const modelName = BFL_MODEL_NAMES[modelEndpoint] || 'BFL Model';

    // Truncate prompt if it's too long for Discord
    const truncatedPrompt = prompt && prompt.length > 200 ? prompt.substring(0, 200) + '...' : (prompt || 'No prompt');

    // Construct scene URL if sceneId is provided
    const sceneUrl = sceneId ? `https://3dstreet.app/#scenes/${sceneId}` : null;

    console.log(`Posting image to Discord: ${imageUrl}`);

    // Create Discord message with embed
    const message = {
      content: `🖼️ **${username}** generated a new AI image!`,
      embeds: [{
        title: `${modelName} Render`,
        description: `**Prompt:** ${truncatedPrompt}`,
        url: sceneUrl, // Add clickable link to the scene
        color: 0x9333EA, // Purple color for AI generations
        image: {
          url: imageUrl
        },
        footer: {
          text: '3DStreet AI Image Generator',
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

// Allowed domains for image proxy (SSRF protection)
const ALLOWED_IMAGE_DOMAINS = [
  'api.bfl.ai',
  'api.us1.bfl.ai',
  'api.eu1.bfl.ai',
  'bfl.ai',
  'cdn.bfl.ai',
  'delivery-us1.bfl.ai',
  'windows.net'  // Azure Blob Storage domains
];

// Get API key from environment
const getApiKey = () => {
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    console.error('BFL_API_KEY is not configured in environment');
    throw new Error('Image generation service is not configured');
  }
  return apiKey;
};

// Validate URL to prevent SSRF attacks
const isAllowedImageUrl = (urlString) => {
  try {
    const url = new URL(urlString);

    // Only allow HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }

    // Check if hostname is in allowed list or is subdomain of allowed domain
    return ALLOWED_IMAGE_DOMAINS.some(domain => {
      return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    });
  } catch (error) {
    // Invalid URL
    return false;
  }
};

// Proxy endpoint for images
exports.bflProxyImage = functions
  .https
  .onRequest(async (req, res) => {
  try {
    // Allowed domains (your domains only)
    const ALLOWED_DOMAINS = [
      'dev-3dstreet.web.app',
      '3dstreet.app',
      'www.3dstreet.app'
    ];

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    let isAllowed = false;
    let allowedOrigin = '*';

    // Check Origin header (sent for cross-origin requests)
    if (origin) {
      // Check exact domain match
      if (ALLOWED_DOMAINS.some(domain => origin === `https://${domain}`)) {
        isAllowed = true;
        allowedOrigin = origin;
      }
      // Allow localhost/127.0.0.1 on any port for development
      else if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        isAllowed = true;
        allowedOrigin = origin;
      }
    }
    // Check Referer header (sent for same-origin requests)
    else if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (ALLOWED_DOMAINS.includes(refererUrl.hostname) ||
            /^(localhost|127\.0\.0\.1)$/.test(refererUrl.hostname)) {
          isAllowed = true;
          // For same-origin, we can set CORS to the referer origin
          allowedOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
        }
      } catch (error) {
        console.warn('Invalid referer URL:', referer);
      }
    }

    if (isAllowed) {
      res.set('Access-Control-Allow-Origin', allowedOrigin);
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
    } else {
      // Origin not allowed or missing - block the request
      console.warn('Blocked request - Origin:', origin, 'Referer:', referer);
      return res.status(403).send('Forbidden');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('Image URL is required');
    }

    // Validate URL to prevent SSRF attacks
    if (!isAllowedImageUrl(imageUrl)) {
      console.warn('Blocked proxy request to disallowed URL:', imageUrl);
      return res.status(403).send('URL not allowed');
    }

    console.log('Proxying image:', imageUrl);

    const response = await fetch(imageUrl, {
      timeout: 30000
    });

    if (!response.ok) {
      console.warn(`Failed to fetch image from ${imageUrl}: ${response.status}`);
      return res.status(response.status).send('Failed to fetch image');
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Proxy error:', error);
    if (!res.headersSent) {
      // Return generic error message to client, log full error server-side
      res.status(500).send('Failed to proxy image');
    }
  }
});

// Proxy endpoint for API requests (callable function with auth and token billing)
exports.bflApiProxy = functions
  .runWith({ secrets: ["BFL_API_KEY", "ALLOWED_PRO_TEAM_DOMAINS", "DISCORD_WEBHOOK_URL"] })
  .https
  .onCall(async (data, context) => {
    try {
      // Verify user is authenticated
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to use image generation.');
      }

      const userId = context.auth.uid;
      const { endpoint, method = 'POST', params = {} } = data;

      if (!endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'Endpoint is required');
      }

      console.log(`User ${userId} calling BFL API: ${method} ${endpoint}`);

      // Check and refill tokens for Pro users, create profile for new users
      let tokenData;
      try {
        tokenData = await checkAndRefillImageTokensInternal(userId);
      } catch (error) {
        console.error('Error checking/refilling tokens:', error);
        throw new functions.https.HttpsError('internal', 'Failed to verify token status');
      }

      // Verify user has tokens available (only for POST requests that consume tokens)
      // GET requests (like get_result polling) don't consume tokens
      const shouldBillToken = method === 'POST' && !endpoint.includes('get_result');

      if (shouldBillToken) {
        if (!tokenData.genToken || tokenData.genToken <= 0) {
          throw new functions.https.HttpsError('resource-exhausted', 'No generation tokens available. Please purchase more tokens or upgrade to Pro.');
        }
      }

      // Get API key from environment
      const apiKey = getApiKey();

      // Build target URL
      let targetUrl = `${API_BASE_URL}/${endpoint}`;

      // Make the API call
      let response;
      if (method === 'GET') {
        // Build query string from params
        const queryParams = new URLSearchParams(params).toString();
        if (queryParams) {
          targetUrl = `${targetUrl}?${queryParams}`;
        }

        response = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-key': apiKey
          },
          timeout: 30000
        });
      } else if (method === 'POST') {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-key': apiKey
          },
          body: JSON.stringify(params),
          timeout: 60000
        });
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Method must be GET or POST');
      }

      // Parse response
      let result;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        console.warn(`Received non-JSON response from ${endpoint}:`, text);
        result = { error: 'Invalid response format', details: text };
      }

      // Check if API call was successful
      if (!response.ok) {
        console.error(`BFL API error (${response.status}):`, result);
        throw new functions.https.HttpsError('internal', `API request failed: ${result.error || result.detail || 'Unknown error'}`);
      }

      // Store generation metadata for Discord posting (non-blocking)
      // Only for model endpoints (not get_result)
      console.log(`Checking metadata storage: shouldBillToken=${shouldBillToken}, result.id=${result.id}, endpoint=${endpoint}, hasModelName=${!!BFL_MODEL_NAMES[endpoint]}`);

      if (shouldBillToken && result.id && BFL_MODEL_NAMES[endpoint]) {
        const db = admin.firestore();
        const metadataRef = db.collection('bflGenerationMetadata').doc(result.id);

        console.log(`Storing generation metadata for task ${result.id}, user ${userId}`);

        // Store metadata with TTL (will be cleaned up after posting to Discord or after 24 hours)
        metadataRef.set({
          userId: userId,
          prompt: params.prompt || null,
          modelEndpoint: endpoint,
          sceneId: params.scene_id || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
        }).then(() => {
          console.log(`Successfully stored metadata for task ${result.id}`);
        }).catch(err => {
          console.error('Failed to store generation metadata:', err);
          // Don't fail the request if metadata storage fails
        });
      } else {
        console.log(`Skipping metadata storage for endpoint ${endpoint}`);
      }

      // Deduct token after successful generation (atomic transaction)
      let remainingTokens = tokenData.genToken;

      if (shouldBillToken) {
        const db = admin.firestore();
        const tokenProfileRef = db.collection('tokenProfile').doc(userId);

        try {
          await db.runTransaction(async (transaction) => {
            const tokenDoc = await transaction.get(tokenProfileRef);

            if (!tokenDoc.exists) {
              throw new Error('Token profile disappeared during transaction');
            }

            const currentTokens = tokenDoc.data().genToken || 0;

            if (currentTokens <= 0) {
              throw new functions.https.HttpsError('resource-exhausted', 'Insufficient tokens');
            }

            const newTokenCount = Math.max(0, currentTokens - 1);
            remainingTokens = newTokenCount;

            transaction.update(tokenProfileRef, {
              genToken: newTokenCount,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });

          console.log(`Deducted 1 token from user ${userId}. Remaining: ${remainingTokens}`);
        } catch (error) {
          console.error('Error deducting token:', error);
          // Don't fail the request if token deduction fails after successful generation
          // Log the error but return the result
          console.error('WARNING: Token deduction failed but API call succeeded');
        }
      }

      // Post to Discord when image generation is complete
      // Check if this is a get_result endpoint returning a ready image
      console.log(`Discord check: endpoint=${endpoint}, status=${result.status}`);

      if (endpoint === 'get_result' && result.status === 'Ready') {
        console.log(`Image generation completed, checking for Discord post`);

        // Extract image URL from result
        let imageUrl = null;
        if (result.result) {
          if (result.result.sample) {
            imageUrl = result.result.sample;
          } else if (typeof result.result === 'string') {
            imageUrl = result.result;
          } else if (result.result.image) {
            imageUrl = result.result.image;
          } else if (result.result.url) {
            imageUrl = result.result.url;
          }
        }

        console.log(`Extracted imageUrl: ${imageUrl}, taskId: ${params.id}`);

        // If we have an image URL, try to post to Discord
        if (imageUrl && params.id) {
          console.log(`Attempting to retrieve metadata for task ${params.id}`);

          // Retrieve metadata from Firestore
          const db = admin.firestore();
          const metadataRef = db.collection('bflGenerationMetadata').doc(params.id);

          metadataRef.get()
            .then(async (doc) => {
              if (doc.exists) {
                console.log(`Found metadata for task ${params.id}, posting to Discord`);
                const metadata = doc.data();

                // Post to Discord (non-blocking)
                await postAIImageToDiscord(
                  metadata.userId,
                  imageUrl,
                  metadata.prompt,
                  metadata.modelEndpoint,
                  metadata.sceneId
                );

                // Clean up metadata after posting
                await metadataRef.delete();
                console.log(`Cleaned up generation metadata for task ${params.id}`);
              } else {
                console.log(`No metadata found for task ${params.id}, skipping Discord post`);
              }
            })
            .catch(err => {
              console.error('Error posting to Discord or cleaning up metadata:', err);
              // Don't fail the request if Discord posting fails
            });
        } else {
          console.log(`Cannot post to Discord: imageUrl=${!!imageUrl}, params.id=${params.id}`);
        }
      }

      // Return success response
      return {
        success: true,
        result: result,
        remainingTokens: remainingTokens
      };

    } catch (error) {
      console.error('BFL API proxy error:', error);

      // Re-throw HttpsError as-is
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      // Wrap other errors
      throw new functions.https.HttpsError('internal', `API request failed: ${error.message}`);
    }
  });
