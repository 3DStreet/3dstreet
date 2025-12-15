# Varjo Teleport Integration

## Current Status: BLOCKED - Awaiting Webhook Documentation

**Last Updated:** December 15, 2025

### What's Built ✅
- CLI tools for testing upload and status checking
- Generator UI tab (`src/generator/splat.js`)
- Cloud functions for init, finalize, webhook, status (`public/functions/varjo-proxy.js`)
- Server-side PLY download and Firebase Storage upload
- Email notifications via Postmark (`public/functions/asset-notifications.js`)
- Firestore indexes for job tracking

### What's Blocking ⏸️
1. **Webhook documentation not available** - Varjo hasn't provided webhook docs yet
   - We've implemented a best-guess webhook handler that supports multiple payload formats
   - Need to verify: event names, field names, signature verification method
   - Webhook URL will be: `https://<project-id>.cloudfunctions.net/varjoWebhook`

2. **End-to-end testing** - Can't fully test until:
   - Firebase secrets are configured (`VARJO_CLIENT_ID`, `VARJO_CLIENT_SECRET`)
   - Webhook is registered with Varjo
   - A real capture is processed through the system

### To Resume Development
1. Get webhook documentation from Varjo (https://teleport.varjo.com/developers/webhooks/)
2. Update `varjoWebhook` handler in `public/functions/varjo-proxy.js` if payload format differs
3. Configure Firebase secrets and deploy
4. Register webhook URL with Varjo
5. Test end-to-end flow

See **CLAUDE.md** "Splat Generation" section for full architecture documentation.

---

# Varjo Teleport CLI Tools

CLI tools for testing the Varjo Teleport API integration.

## Prerequisites

1. **Varjo Developer Account**: Sign up at [Varjo Teleport](https://teleport.varjo.com/)
2. **API Credentials**: Get your `client_id` and `client_secret` from the Developer Dashboard
3. **Node.js 18+**: Required for native fetch support

## Setup

### Option 1: Environment Variables

```bash
export VARJO_CLIENT_ID=your_client_id
export VARJO_CLIENT_SECRET=your_client_secret
```

### Option 2: Create `.env` file

Create a `.env` file in this directory (`scripts/varjo/`):

```env
VARJO_CLIENT_ID=your_client_id
VARJO_CLIENT_SECRET=your_client_secret
```

## Usage

### 1. Upload a Capture

Upload a video or ZIP of images for processing:

```bash
# From the 3dstreet root directory
node scripts/varjo/upload-capture.mjs path/to/video.mp4

# Or with a ZIP of images
node scripts/varjo/upload-capture.mjs path/to/images.zip
```

Supported input formats:
- **Video**: `.mp4`, `.mov`
- **Images**: `.zip` (archive containing RGB images)

Output:
```
============================================================
Varjo Teleport Upload
============================================================
File: my-video.mp4
Size: 125.3 MB
Format: video
============================================================

Authenticating with Varjo...
Authentication successful! Token expires in 3600s
Creating capture: my-video.mp4 (131378472 bytes, video)
Created capture with EID: abc123xyz
  Parts: 3, Chunk size: 50000000

Uploading 3 parts...
  Part 3/3 (31378472 bytes) - 100%

Finalizing upload...
Upload finalized!
  State: processing

============================================================
Upload Complete!
============================================================
Capture EID: abc123xyz
State: processing

Next steps:
  1. Check status: node check-capture.mjs abc123xyz
  2. Processing typically takes 5-30 minutes
============================================================
```

### 2. Check Status & Download

Check the processing status and download the completed model:

```bash
# Basic status check
node scripts/varjo/check-capture.mjs <capture_eid>

# Specify output format
node scripts/varjo/check-capture.mjs <capture_eid> ply

# Poll until complete
node scripts/varjo/check-capture.mjs <capture_eid> ply --poll
```

Available output formats:
- `ply` - Standard PLY format (largest, most compatible)
- `sogs-sh0` - Varjo optimized format
- `ksplat-v2-compress0` - KSplat format, no compression
- `ksplat-v2-compress1` - KSplat format, medium compression
- `ksplat-v2-compress2` - KSplat format, high compression (smallest)

Output when complete:
```
============================================================
Varjo Teleport Status Check
============================================================
Capture EID: abc123xyz
Format: ply

Authenticating...
Authenticated!

Capture Details:
==================================================
  EID:      abc123xyz
  SID:      def456uvw
  Name:     my-video.mp4
  State:    READY
  Created:  12/15/2025, 10:30:00 AM
  Uploaded: 12/15/2025, 10:32:00 AM
  Viewer:   https://teleport.varjo.com/view/def456uvw
==================================================

Fetching metadata for ply format...
Metadata retrieved!

Model Info:
  Format: ply
  URL: Available

Downloading to abc123xyz_ply.ply...
Downloaded: abc123xyz_ply.ply (156.2 MB)

============================================================
Download Complete!
============================================================
File: abc123xyz_ply.ply

Next steps:
  1. View in Varjo viewer: https://teleport.varjo.com/view/def456uvw
  2. Use in 3DStreet with gaussian_splatting component
============================================================
```

## Capture States

| State | Description |
|-------|-------------|
| `UPLOADING` | File upload in progress |
| `PROCESSING` | Model generation in progress (5-30 min) |
| `READY` | Processing complete, model available for download |
| `FAILED` | Processing failed |

## Tips

1. **Large files**: Videos can be up to 1GB. The upload is automatically chunked.
2. **Processing time**: Expect 5-30 minutes depending on input size and complexity.
3. **Polling**: Use `--poll` flag to automatically wait for completion.
4. **Multiple formats**: You can download the same capture in different formats.

## Troubleshooting

### Authentication failed
- Verify your `VARJO_CLIENT_ID` and `VARJO_CLIENT_SECRET` are correct
- Check that your Varjo account has API access enabled

### Upload failed
- Ensure the file is a valid MP4/MOV video or ZIP archive
- Check file size is within limits (max ~1GB)

### Processing failed
- Video may not have enough visual overlap for reconstruction
- Try a longer video or more images with better coverage

## API Reference

For more details, see the [Varjo Teleport API Documentation](https://teleport.varjo.com/docs/).
