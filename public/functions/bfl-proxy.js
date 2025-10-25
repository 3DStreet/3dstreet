const functions = require('firebase-functions');
const fetch = require('node-fetch');

const API_BASE_URL = 'https://api.us1.bfl.ai/v1';

// Middleware to check for API key
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'API key (x-key header) is required' });
  }
  req.apiKey = apiKey;
  next();
};

// Proxy endpoint for images
exports.bflProxyImage = functions.https.onRequest(async (req, res) => {
  try {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-key');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send('Image URL is required');
    }

    console.log('Proxying image:', imageUrl);

    const response = await fetch(imageUrl, {
      timeout: 30000
    });

    if (!response.ok) {
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
      res.status(500).send('Proxy error: ' + error.message);
    }
  }
});

// Proxy endpoint for API POST requests
exports.bflApiProxy = functions.https.onRequest(async (req, res) => {
  try {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-key');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Check for API key
    const apiKey = req.headers['x-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'API key (x-key header) is required' });
    }

    // Extract endpoint from path
    // Expected path: /bfl-api-proxy/{endpoint} or with query params
    const pathParts = req.path.split('/').filter(Boolean);
    const endpoint = pathParts[0] || '';

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

      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});
