#!/usr/bin/env node
/**
 * Varjo Teleport API - Check Capture Status Script
 *
 * CLI tool to check capture processing status and download completed models.
 *
 * Usage:
 *   VARJO_CLIENT_ID=xxx VARJO_CLIENT_SECRET=yyy node check-capture.mjs <capture_eid> [format]
 *
 * Or with .env file:
 *   node check-capture.mjs <capture_eid> [format]
 *
 * Arguments:
 *   capture_eid - The EID returned from upload-capture.mjs
 *   format      - Output format (default: ply)
 *                 Options: ply, sogs-sh0, ksplat-v2-compress0, ksplat-v2-compress1, ksplat-v2-compress2
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
    '     VARJO_CLIENT_ID=xxx VARJO_CLIENT_SECRET=yyy node check-capture.mjs <eid>'
  );
  console.error('');
  console.error('  2. Create a .env file in scripts/varjo/:');
  console.error('     VARJO_CLIENT_ID=your_client_id');
  console.error('     VARJO_CLIENT_SECRET=your_client_secret');
  process.exit(1);
}

const AUTH_ENDPOINT = 'https://signin.teleport.varjo.com/oauth2/token';
const API_BASE = 'https://teleport.varjo.com';

const VALID_FORMATS = [
  'ply',
  'sogs-sh0',
  'ksplat-v2-compress0',
  'ksplat-v2-compress1',
  'ksplat-v2-compress2'
];

/**
 * Authenticate with Varjo OAuth2 and get access token
 */
async function getAccessToken() {
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

  const { access_token } = await authResponse.json();
  return access_token;
}

/**
 * Get all captures and find the one matching the EID
 */
async function getCapture(accessToken, eid) {
  const response = await fetch(`${API_BASE}/api/v1/captures`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    console.error('Failed to get captures:', response.status);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const captures = await response.json();
  const capture = captures.find((c) => c.eid === eid);

  if (!capture) {
    console.error(`Capture ${eid} not found`);
    console.error('');
    console.error('Available captures:');
    captures.forEach((c) => {
      console.error(`  ${c.eid} - ${c.name} (${c.state})`);
    });
    process.exit(1);
  }

  return capture;
}

/**
 * Get metadata for a completed capture
 */
async function getMetadata(accessToken, sid, format) {
  const response = await fetch(
    `${API_BASE}/share/${sid}/metadata?profiles=${format}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null; // Not ready yet
    }
    console.error(`Metadata request failed: ${response.status}`);
    const text = await response.text();
    console.error(text);
    return null;
  }

  return response.json();
}

/**
 * Download a file from URL
 */
async function downloadFile(url, filename) {
  console.log(`Downloading to ${filename}...`);

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Failed to download:', response.status);
    return false;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  console.log(`Downloaded: ${filename} (${formatBytes(buffer.length)})`);
  return true;
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
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString();
}

/**
 * Get file extension for format
 */
function getExtension(format) {
  if (format === 'ply') return 'ply';
  if (format.startsWith('ksplat')) return 'ksplat';
  if (format.startsWith('sogs')) return 'sogs';
  return 'bin';
}

/**
 * Print capture details
 */
function printCaptureDetails(capture) {
  console.log('');
  console.log('Capture Details:');
  console.log('='.repeat(50));
  console.log(`  EID:      ${capture.eid}`);
  console.log(`  SID:      ${capture.sid || 'N/A'}`);
  console.log(`  Name:     ${capture.name}`);
  console.log(`  State:    ${capture.state}`);
  console.log(`  Created:  ${formatDate(capture.created)}`);
  console.log(`  Uploaded: ${formatDate(capture.uploaded)}`);
  if (capture.viewer_url) {
    console.log(`  Viewer:   ${capture.viewer_url}`);
  }
  console.log('='.repeat(50));
}

/**
 * Poll for completion (optional continuous mode)
 */
async function pollForCompletion(accessToken, eid, format, interval = 10000) {
  console.log('');
  console.log(`Polling for completion every ${interval / 1000}s... (Ctrl+C to stop)`);
  console.log('');

  let lastState = null;
  let pollCount = 0;

  while (true) {
    pollCount++;
    const capture = await getCapture(accessToken, eid);

    if (capture.state !== lastState) {
      lastState = capture.state;
      console.log(`[Poll ${pollCount}] State: ${capture.state}`);
    } else {
      process.stdout.write(`\r[Poll ${pollCount}] State: ${capture.state}...`);
    }

    if (capture.state === 'READY') {
      console.log('');
      console.log('Processing complete!');
      return capture;
    }

    if (capture.state === 'FAILED') {
      console.log('');
      console.error('Processing failed!');
      return capture;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Main entry point
 */
async function main() {
  const eid = process.argv[2];
  const format = process.argv[3] || 'ply';
  const pollMode = process.argv.includes('--poll') || process.argv.includes('-p');

  if (!eid) {
    console.error('Usage: node check-capture.mjs <capture_eid> [format] [--poll]');
    console.error('');
    console.error('Arguments:');
    console.error('  capture_eid  The EID returned from upload-capture.mjs');
    console.error('  format       Output format (default: ply)');
    console.error('  --poll, -p   Continuously poll until complete');
    console.error('');
    console.error('Formats:');
    VALID_FORMATS.forEach((f) => console.error(`  ${f}`));
    console.error('');
    console.error('Examples:');
    console.error('  node check-capture.mjs abc123');
    console.error('  node check-capture.mjs abc123 ply');
    console.error('  node check-capture.mjs abc123 ksplat-v2-compress2');
    console.error('  node check-capture.mjs abc123 ply --poll');
    process.exit(1);
  }

  if (!VALID_FORMATS.includes(format)) {
    console.error(`Invalid format: ${format}`);
    console.error(`Valid formats: ${VALID_FORMATS.join(', ')}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Varjo Teleport Status Check');
  console.log('='.repeat(60));
  console.log(`Capture EID: ${eid}`);
  console.log(`Format: ${format}`);
  console.log('');

  // Authenticate
  console.log('Authenticating...');
  const accessToken = await getAccessToken();
  console.log('Authenticated!');

  // Get capture details
  let capture = await getCapture(accessToken, eid);
  printCaptureDetails(capture);

  // If poll mode and not ready, poll until complete
  if (pollMode && capture.state !== 'READY' && capture.state !== 'FAILED') {
    capture = await pollForCompletion(accessToken, eid, format);
    printCaptureDetails(capture);
  }

  // If not ready, show status and exit
  if (capture.state !== 'READY') {
    console.log('');
    if (capture.state === 'PROCESSING') {
      console.log('Capture is still processing.');
      console.log('Run this command again later to check status.');
      console.log('');
      console.log('Tip: Use --poll flag to wait for completion:');
      console.log(`  node check-capture.mjs ${eid} ${format} --poll`);
    } else if (capture.state === 'FAILED') {
      console.log('Capture processing failed.');
    } else {
      console.log(`Current state: ${capture.state}`);
    }
    process.exit(0);
  }

  // Get metadata for completed capture
  console.log('');
  console.log(`Fetching metadata for ${format} format...`);
  const metadata = await getMetadata(accessToken, capture.sid, format);

  if (!metadata) {
    console.error('Failed to get metadata');
    process.exit(1);
  }

  console.log('Metadata retrieved!');

  // Check if requested format is available
  if (!metadata.models || !metadata.models[format]) {
    console.error(`Format ${format} not available in metadata`);
    console.log('');
    console.log('Available formats:', Object.keys(metadata.models || {}));
    process.exit(1);
  }

  const model = metadata.models[format];
  console.log('');
  console.log('Model Info:');
  console.log(`  Format: ${format}`);
  console.log(`  URL: ${model.url ? 'Available' : 'Not available'}`);

  // Download the model
  if (model.url) {
    console.log('');
    const extension = getExtension(format);
    const filename = `${eid}_${format}.${extension}`;
    const success = await downloadFile(model.url, filename);

    if (success) {
      console.log('');
      console.log('='.repeat(60));
      console.log('Download Complete!');
      console.log('='.repeat(60));
      console.log(`File: ${filename}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. View in Varjo viewer:', capture.viewer_url);
      console.log('  2. Use in 3DStreet with gaussian_splatting component');
      console.log('='.repeat(60));
    }
  } else {
    console.error('No download URL available');
    console.log('');
    console.log('Full metadata:');
    console.log(JSON.stringify(metadata, null, 2));
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
