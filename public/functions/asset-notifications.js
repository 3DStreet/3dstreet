/**
 * Asset Notification Functions
 *
 * Generic email notifications for completed asset generation jobs.
 * Supports splats, images, videos, and other asset types.
 */

// Postmark API endpoint
const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

/**
 * Asset type display names and icons for emails
 */
const ASSET_TYPE_CONFIG = {
  splat: {
    displayName: '3D Splat',
    icon: '🎯',
    description: '3D Gaussian Splat model'
  },
  image: {
    displayName: 'AI Image',
    icon: '🖼️',
    description: 'AI-generated image'
  },
  video: {
    displayName: 'AI Video',
    icon: '🎬',
    description: 'AI-generated video'
  },
  mesh: {
    displayName: '3D Mesh',
    icon: '🔷',
    description: '3D mesh model'
  }
};

/**
 * Provider display names
 */
const PROVIDER_CONFIG = {
  varjo: {
    displayName: 'Varjo Teleport',
    url: 'https://teleport.varjo.com'
  },
  'flux-pro': {
    displayName: 'Flux Pro 1.1',
    url: 'https://bfl.ai'
  },
  'flux-dev': {
    displayName: 'Flux Dev',
    url: 'https://bfl.ai'
  },
  replicate: {
    displayName: 'Replicate',
    url: 'https://replicate.com'
  }
};

/**
 * Send email via Postmark API
 */
async function sendPostmarkEmail(toEmail, subject, htmlBody, textBody) {
  const apiKey = process.env.POSTMARK_API_KEY;

  if (!apiKey) {
    console.warn('POSTMARK_API_KEY not configured, skipping email');
    return null;
  }

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({
      From: 'notify@3dstreet.com',
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Postmark API error sending to ${toEmail}: status=${response.status}, body=${errorText}`
    );
    throw new Error(`Postmark API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Generate email content for asset completion
 * @param {Object} options - Email options
 * @param {string} options.userName - User's display name
 * @param {string} options.assetName - Name of the asset
 * @param {string} options.assetType - Type of asset (splat, image, video, mesh)
 * @param {string} options.provider - Provider name (varjo, flux-pro, etc.)
 * @param {string} options.viewerUrl - URL to view the asset (optional)
 * @param {string} options.previewUrl - Preview image URL (optional)
 * @param {string} options.galleryUrl - URL to the gallery
 * @param {string} options.status - 'ready' or 'error'
 * @param {string} options.errorMessage - Error message if status is 'error'
 */
function generateAssetEmailContent(options) {
  const {
    userName,
    assetName,
    assetType,
    provider,
    viewerUrl,
    previewUrl,
    galleryUrl,
    status,
    errorMessage
  } = options;

  const typeConfig = ASSET_TYPE_CONFIG[assetType] || {
    displayName: assetType,
    icon: '📦',
    description: 'Generated asset'
  };

  const providerConfig = PROVIDER_CONFIG[provider] || {
    displayName: provider,
    url: null
  };

  const isError = status === 'error';
  const statusEmoji = isError ? '❌' : '✅';
  const statusText = isError ? 'failed' : 'is ready';

  // Subject line
  const subject = isError
    ? `${typeConfig.icon} Your ${typeConfig.displayName} generation failed`
    : `${typeConfig.icon} Your ${typeConfig.displayName} is ready!`;

  // Plain text version
  const textBody = `Hi ${userName},

${isError ? `Unfortunately, your ${typeConfig.displayName} generation has failed.` : `Great news! Your ${typeConfig.displayName} "${assetName}" is ready.`}

Asset: ${assetName}
Type: ${typeConfig.displayName}
Provider: ${providerConfig.displayName}
${isError ? `Error: ${errorMessage || 'Unknown error'}` : ''}
${viewerUrl ? `View: ${viewerUrl}` : ''}

${isError ? 'Please try again or contact support if the problem persists.' : 'View all your assets in your gallery:'}
${galleryUrl}

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you requested a ${typeConfig.displayName} generation on 3DStreet.
If you have questions, reply to this email or visit https://3dstreet.com/docs/`;

  // HTML version
  const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <div style="background-color: ${isError ? '#fef2f2' : '#f0fdf4'}; border-left: 4px solid ${isError ? '#ef4444' : '#22c55e'}; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
    <p style="margin: 0; font-size: 18px;">
      ${statusEmoji} Your <strong>${typeConfig.displayName}</strong> ${statusText}!
    </p>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Asset Name</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 500;">${assetName || 'Untitled'}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Type</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${typeConfig.icon} ${typeConfig.displayName}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Provider</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${providerConfig.displayName}</td>
    </tr>
    ${isError ? `<tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Error</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #ef4444;">${errorMessage || 'Unknown error'}</td>
    </tr>` : ''}
  </table>

  ${previewUrl && !isError ? `
  <div style="text-align: center; margin-bottom: 24px;">
    <img src="${previewUrl}" alt="Preview" style="max-width: 100%; max-height: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
  </div>
  ` : ''}

  <div style="text-align: center; margin: 30px 0;">
    ${viewerUrl && !isError ? `
    <a href="${viewerUrl}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-right: 12px;">View ${typeConfig.displayName}</a>
    ` : ''}
    <a href="${galleryUrl}" style="display: inline-block; background-color: ${isError ? '#6366f1' : '#f3f4f6'}; color: ${isError ? 'white' : '#333'}; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">${isError ? 'Try Again' : 'Open Gallery'}</a>
  </div>

  ${isError ? `
  <p style="color: #666;">If this problem persists, please contact support or try with a different input file.</p>
  ` : ''}

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you requested a ${typeConfig.displayName} generation on 3DStreet.<br>
    If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`;

  return { subject, textBody, htmlBody };
}

/**
 * Send asset completion notification email
 * @param {Object} options - Notification options
 * @param {string} options.email - Recipient email
 * @param {string} options.userName - User's display name
 * @param {string} options.assetName - Name of the asset
 * @param {string} options.assetType - Type (splat, image, video, mesh)
 * @param {string} options.provider - Provider name
 * @param {string} options.viewerUrl - URL to view the asset
 * @param {string} options.previewUrl - Preview image URL
 * @param {string} options.status - 'ready' or 'error'
 * @param {string} options.errorMessage - Error message if status is 'error'
 */
async function sendAssetReadyEmail(options) {
  const {
    email,
    userName = 'there',
    assetName = 'Untitled',
    assetType = 'asset',
    provider = 'unknown',
    viewerUrl,
    previewUrl,
    status = 'ready',
    errorMessage
  } = options;

  if (!email) {
    console.warn('No email provided, skipping notification');
    return null;
  }

  const galleryUrl = 'https://3dstreet.app/generator/#gallery';

  const { subject, textBody, htmlBody } = generateAssetEmailContent({
    userName,
    assetName,
    assetType,
    provider,
    viewerUrl,
    previewUrl,
    galleryUrl,
    status,
    errorMessage
  });

  try {
    const result = await sendPostmarkEmail(email, subject, htmlBody, textBody);
    console.log(
      `Asset ${status} email sent to ${email} for ${assetType} "${assetName}"`,
      result?.MessageID ? `MessageID: ${result.MessageID}` : ''
    );
    return result;
  } catch (error) {
    console.error(`Failed to send asset ${status} email to ${email}:`, error);
    // Don't throw - email failure shouldn't break the main flow
    return null;
  }
}

module.exports = {
  sendAssetReadyEmail,
  sendPostmarkEmail,
  generateAssetEmailContent,
  ASSET_TYPE_CONFIG,
  PROVIDER_CONFIG
};
