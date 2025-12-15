#!/usr/bin/env node
/**
 * Varjo Teleport API - Upload Capture Script
 *
 * CLI tool to test uploading video/images to Varjo Teleport for 3D Gaussian splat processing.
 *
 * Usage:
 *   VARJO_CLIENT_ID=xxx VARJO_CLIENT_SECRET=yyy node upload-capture.mjs <file.mp4|file.zip>
 *
 * Or with .env file:
 *   node upload-capture.mjs <file.mp4|file.zip>
 *
 * Environment variables:
 *   VARJO_CLIENT_ID     - OAuth2 client ID from Varjo Developer Dashboard
 *   VARJO_CLIENT_SECRET - OAuth2 client secret from Varjo Developer Dashboard
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file if it exists
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const CLIENT_ID = process.env.VARJO_CLIENT_ID;
const CLIENT_SECRET = process.env.VARJO_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: VARJO_CLIENT_ID and VARJO_CLIENT_SECRET must be set');
  console.error('');
  console.error('Options:');
  console.error('  1. Set environment variables:');
  console.error(
    '     VARJO_CLIENT_ID=xxx VARJO_CLIENT_SECRET=yyy node upload-capture.mjs <file>'
  );
  console.error('');
  console.error('  2. Create a .env file in scripts/varjo/:');
  console.error('     VARJO_CLIENT_ID=your_client_id');
  console.error('     VARJO_CLIENT_SECRET=your_client_secret');
  process.exit(1);
}

const AUTH_ENDPOINT = 'https://signin.teleport.varjo.com/oauth2/token';
const API_BASE = 'https://teleport.varjo.com';

/**
 * Authenticate with Varjo OAuth2 and get access token
 */
async function getAccessToken() {
  console.log('Authenticating with Varjo...');

  const authResponse = await fetch(AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'openid profile email'
    })
  });

  if (!authResponse.ok) {
    console.error('Authentication failed:', authResponse.status);
    const text = await authResponse.text();
    console.error(text);
    process.exit(1);
  }

  const { access_token, expires_in } = await authResponse.json();
  console.log(`Authentication successful! Token expires in ${expires_in}s`);
  return access_token;
}

/**
 * Create a new capture on Varjo
 */
async function createCapture(accessToken, name, bytesize, inputDataFormat) {
  console.log(`Creating capture: ${name} (${bytesize} bytes, ${inputDataFormat})`);

  const response = await fetch(`${API_BASE}/api/v1/captures`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      bytesize,
      input_data_format: inputDataFormat
    })
  });

  if (!response.ok) {
    console.error('Failed to create capture:', response.status);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const capture = await response.json();
  console.log(`Created capture with EID: ${capture.eid}`);
  console.log(`  Parts: ${capture.num_parts}, Chunk size: ${capture.chunk_size}`);

  return capture;
}

/**
 * Get presigned upload URL for a specific part
 */
async function getUploadUrl(accessToken, eid, partNo, bytesize) {
  const response = await fetch(
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

  if (!response.ok) {
    console.error(`Failed to get upload URL for part ${partNo}`);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const { upload_url } = await response.json();
  return upload_url;
}

/**
 * Upload file in chunks to Varjo
 */
async function uploadFile(accessToken, filePath, capture) {
  const { eid, num_parts, chunk_size } = capture;
  const fd = fs.openSync(filePath, 'r');
  const parts = [];

  console.log(`\nUploading ${num_parts} parts...`);

  for (let partNo = 1; partNo <= num_parts; partNo++) {
    // Get presigned URL for this part
    const uploadUrl = await getUploadUrl(
      accessToken,
      eid,
      partNo,
      fs.statSync(filePath).size
    );

    // Read chunk from file
    const buffer = Buffer.alloc(chunk_size);
    const bytesRead = fs.readSync(fd, buffer, 0, chunk_size, null);
    const chunk = buffer.subarray(0, bytesRead);

    // Upload chunk
    const progress = Math.round((partNo / num_parts) * 100);
    process.stdout.write(
      `\r  Part ${partNo}/${num_parts} (${bytesRead} bytes) - ${progress}%`
    );

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: chunk
    });

    if (!putResponse.ok) {
      console.error(`\nFailed to upload part ${partNo}:`, putResponse.status);
      process.exit(1);
    }

    // Extract ETag from response
    const etag = putResponse.headers.get('etag').replace(/"/g, '');
    parts.push({ number: partNo, etag });
  }

  fs.closeSync(fd);
  console.log('\n');

  return parts;
}

/**
 * Finalize the upload and start processing
 */
async function finalizeUpload(accessToken, eid, parts) {
  console.log('Finalizing upload...');

  const response = await fetch(`${API_BASE}/api/v1/captures/${eid}/uploaded`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ eid, parts })
  });

  if (!response.ok) {
    console.error('Failed to finalize upload:', response.status);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const result = await response.json();
  console.log('Upload finalized!');
  console.log(`  State: ${result.state}`);

  return result;
}

/**
 * Detect input format based on file extension
 */
function detectInputFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.mp4' || ext === '.mov') {
    return 'video';
  } else if (ext === '.zip') {
    return 'bulk-images';
  } else {
    console.error(`Unsupported file type: ${ext}`);
    console.error('Supported types: .mp4, .mov (video), .zip (bulk-images)');
    process.exit(1);
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Main entry point
 */
async function main() {
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: node upload-capture.mjs <file.mp4|file.zip>');
    console.error('');
    console.error('Examples:');
    console.error('  node upload-capture.mjs my-video.mp4');
    console.error('  node upload-capture.mjs my-images.zip');
    process.exit(1);
  }

  const filePath = path.resolve(filename);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const bytesize = fs.statSync(filePath).size;
  const inputDataFormat = detectInputFormat(filename);
  const captureName = path.basename(filePath);

  console.log('='.repeat(60));
  console.log('Varjo Teleport Upload');
  console.log('='.repeat(60));
  console.log(`File: ${captureName}`);
  console.log(`Size: ${formatBytes(bytesize)}`);
  console.log(`Format: ${inputDataFormat}`);
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Authenticate
  const accessToken = await getAccessToken();

  // Step 2: Create capture
  const capture = await createCapture(
    accessToken,
    captureName,
    bytesize,
    inputDataFormat
  );

  // Step 3: Upload file in chunks
  const parts = await uploadFile(accessToken, filePath, capture);

  // Step 4: Finalize upload
  const result = await finalizeUpload(accessToken, capture.eid, parts);

  // Output summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Upload Complete!');
  console.log('='.repeat(60));
  console.log(`Capture EID: ${capture.eid}`);
  console.log(`State: ${result.state}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Check status: node check-capture.mjs ${capture.eid}`);
  console.log('  2. Processing typically takes 5-30 minutes');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
