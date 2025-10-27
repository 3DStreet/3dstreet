const functions = require('firebase-functions');

const API_BASE_URL = 'https://api.us1.bfl.ai/v1';

// Allowed domains for image proxy (SSRF protection)
const ALLOWED_IMAGE_DOMAINS = [
  'api.bfl.ai',
  'api.us1.bfl.ai',
  'api.eu1.bfl.ai',
  'bfl.ai',
  'cdn.bfl.ai'
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
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

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

    const buffer = await response.buffer();
    res.send(buffer);
  } catch (error) {
    console.error('Proxy error:', error);
    if (!res.headersSent) {
      // Return generic error message to client, log full error server-side
      res.status(500).send('Failed to proxy image');
    }
  }
});

// Proxy endpoint for API POST requests
exports.bflApiProxy = functions
  .runWith({ secrets: ["BFL_API_KEY"] })
  .https
  .onRequest(async (req, res) => {
  try {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Get API key from environment
    const apiKey = getApiKey();

    // Extract endpoint from path
    // Firebase Hosting rewrites pass the FULL path including 'bflApiProxy'
    // e.g., /bflApiProxy/my_finetunes -> need to extract 'my_finetunes'
    const pathParts = req.path.split('/').filter(Boolean);
    const endpoint = pathParts.slice(1).join('/') || ''; // Skip 'bflApiProxy' prefix

    console.log(`Proxying ${req.method} request to ${endpoint}`);

    let targetUrl = `${API_BASE_URL}/${endpoint}`;

    // Handle GET request with query parameters
    if (req.method === 'GET') {
      // Special case for get_result
      if (endpoint === 'get_result' && req.query.id) {
        targetUrl = `${API_BASE_URL}/get_result?id=${req.query.id}`;
      } else {
        // Build query string from all query params
        const queryParams = new URLSearchParams(req.query).toString();
        if (queryParams) {
          targetUrl = `${targetUrl}?${queryParams}`;
        }
      }

      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-key': apiKey
        },
        timeout: 30000
      });

      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
        console.warn(`Received non-JSON response from ${endpoint}:`, data);
      }

      res.status(response.status).json(data);
    } else if (req.method === 'POST') {
      // Handle POST request
      const requestBody = req.body;

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-key': apiKey
        },
        body: JSON.stringify(requestBody),
        timeout: 60000
      });

      // Handle JSON parsing with try-catch
      let data;
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          console.warn(`Received non-JSON response from ${endpoint}:`, text);
          data = { error: 'Invalid response format', details: text };
        }
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        data = { error: 'Failed to parse API response' };
      }

      res.status(response.status).json(data);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API proxy error:', error);
    // Return generic error message to client, log full error server-side
    res.status(500).json({ error: 'API request failed' });
  }
});
