const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { checkAndRefillImageTokensInternal } = require('./token-management.js');

const API_BASE_URL = 'https://api.us1.bfl.ai/v1';

// Allowed domains for image proxy (SSRF protection)
const ALLOWED_IMAGE_DOMAINS = [
  'api.bfl.ai',
  'api.us1.bfl.ai',
  'api.eu1.bfl.ai',
  'bfl.ai',
  'cdn.bfl.ai',
  'delivery-us1.bfl.ai'
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
  .runWith({ secrets: ["BFL_API_KEY", "ALLOWED_PRO_TEAM_DOMAINS"] })
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
