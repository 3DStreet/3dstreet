/**
 * Lifecycle email templates. Each export implements the template interface
 * sendLifecycleEmail expects: { getSubject, getHtmlBody, getTextBody }, all
 * receiving (userName, data).
 *
 * Broadcast-stream templates must NOT include their own unsubscribe link —
 * the send service appends the Postmark `{{{ pm:unsubscribe_url }}}` footer
 * to everything sent on a broadcast stream.
 *
 * Copy lives here in-repo (no Postmark-hosted templates) so it's reviewable
 * and versioned; edit freely, the plumbing doesn't care about wording.
 */

const APP_BASE = 'https://3dstreet.app';

const utm = (campaign, content) =>
  `utm_source=email&utm_medium=lifecycle&utm_campaign=${campaign}&utm_content=${content}`;

// Shared chrome matching the existing scheduledEmails.js templates (logo
// header, indigo CTA, muted signature).
const htmlLayout = (userName, bodyHtml, { ctaUrl, ctaLabel, footnote }) => `<!DOCTYPE html>
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

${bodyHtml}
${
  ctaUrl
    ? `
  <div style="text-align: center; margin: 30px 0;">
    <a href="${ctaUrl}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">${ctaLabel}</a>
  </div>`
    : ''
}
  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>
${
  footnote
    ? `
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    ${footnote}
  </p>`
    : ''
}
</body>
</html>`;

const textLayout = (userName, bodyText, { ctaUrl, ctaLabel, footnote }) => `Hi ${userName},

${bodyText}
${ctaUrl ? `\n${ctaLabel}: ${ctaUrl}\n` : ''}
The 3DStreet Team
https://3dstreet.com${footnote ? `\n\n---\n${footnote.replace(/<[^>]+>/g, '')}` : ''}`;

// ---------------------------------------------------------------------------
// Transactional (outbound stream)
// ---------------------------------------------------------------------------

const welcome = {
  getSubject: () => 'Welcome to 3DStreet!',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>Welcome to <strong>3DStreet</strong>, the browser-based tool for designing and sharing 3D street scenes.</p>

  <p>A few ways to get going:</p>

  <ul style="padding-left: 20px;">
    <li><strong>Place your street in the real world:</strong> your new account includes 3 free geo tokens for adding Google 3D Map Tiles to your scene</li>
    <li><strong>Render high quality visuals:</strong> use the Snapshot &amp; Render or AI Generator tools to create photorealistic or stylized renderings &ndash; your new account includes free AI Rendering tokens to try this, no credit card required</li>
    <li><strong>Start from scratch and add built-in 3D models and streets:</strong> create a blank scene and click (+) to add streets, vehicles, people, greening, and more from our included asset library</li>
    <li><strong>Import your own creations:</strong> drag-and-drop to upload your own images, 3D models, or Gaussian splat 3D scans to mix with your scene</li>
  </ul>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('welcome', 'cta_button')}`,
        ctaLabel: 'Start designing',
        footnote:
          'You received this email because you created an account on 3DStreet. This message is only sent once. Questions? Just reply to this email.'
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `Welcome to 3DStreet, the browser-based tool for designing and sharing 3D street scenes.

A few ways to get going:

- Place your street in the real world: your new account includes 3 free geo tokens for adding Google 3D Map Tiles to your scene
- Render high quality visuals: use the Snapshot & Render or AI Generator tools to create photorealistic or stylized renderings - your new account includes free AI Rendering tokens to try this, no credit card required
- Start from scratch and add built-in 3D models and streets: create a blank scene and click (+) to add streets, vehicles, people, greening, and more from our included asset library
- Import your own creations: drag-and-drop to upload your own images, 3D models, or Gaussian splat 3D scans to mix with your scene`,
      {
        ctaUrl: `${APP_BASE}/?${utm('welcome', 'cta_link')}`,
        ctaLabel: 'Start designing',
        footnote:
          'You received this email because you created an account on 3DStreet. This message is only sent once. Questions? Just reply to this email.'
      }
    )
};

// data: { planTier: 'PRO' | 'MAX' }
const postUpgradeWelcome = {
  getSubject: (userName, data = {}) =>
    `You're on 3DStreet ${data.planTier === 'MAX' ? 'Max' : 'Pro'}! Here's what's unlocked`,
  getHtmlBody: (userName, data = {}) =>
    htmlLayout(
      userName,
      `  <p>Thanks for upgrading to <strong>3DStreet ${data.planTier === 'MAX' ? 'Max' : 'Pro'}</strong>! Your account now includes:</p>

  <ul style="padding-left: 20px;">
    <li>Watermark-free snapshots and HD renders</li>
    <li>Unlimited geospatial maps &amp; location changes</li>
    <li>An allowance of AI generation tokens topped up each month</li>
    <li>3D Model glTF Export</li>
    <li>Larger asset storage allowance for uploading custom 3D models, scans (splat or mesh), and images</li>
  </ul>

  <p>Everything is already active on your account. Just open the editor.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('post_upgrade', 'cta_button')}`,
        ctaLabel: 'Open 3DStreet',
        footnote:
          'You received this email because you purchased a 3DStreet subscription. Manage your subscription anytime from your profile in the app. Questions? Just reply to this email.'
      }
    ),
  getTextBody: (userName, data = {}) =>
    textLayout(
      userName,
      `Thanks for upgrading to 3DStreet ${data.planTier === 'MAX' ? 'Max' : 'Pro'}! Your account now includes:

- Watermark-free snapshots and HD renders
- Unlimited geospatial maps & location changes
- An allowance of AI generation tokens topped up each month
- 3D Model glTF Export
- Larger asset storage allowance for uploading custom 3D models, scans (splat or mesh), and images

Everything is already active on your account. Just open the editor.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('post_upgrade', 'cta_link')}`,
        ctaLabel: 'Open 3DStreet',
        footnote:
          'You received this email because you purchased a 3DStreet subscription. Manage your subscription anytime from your profile in the app. Questions? Just reply to this email.'
      }
    )
};

const failedPayment = {
  getSubject: () => 'Action needed: payment issue with your 3DStreet subscription',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>We couldn't process the latest payment for your 3DStreet subscription. This usually means a card expired or was declined.</p>

  <p>To keep your Pro features active, please update your payment method. Open 3DStreet, click your profile picture, and choose <strong>Manage subscription</strong> to reach the secure billing portal.</p>

  <p>Stripe will retry the charge automatically over the next few days, so if you've already fixed it, you're all set.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('failed_payment', 'cta_button')}`,
        ctaLabel: 'Update payment method',
        footnote:
          "You received this email because a subscription payment didn't go through. If you believe this is a mistake, reply to this email and we'll sort it out."
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `We couldn't process the latest payment for your 3DStreet subscription. This usually means a card expired or was declined.

To keep your Pro features active, please update your payment method. Open 3DStreet, click your profile picture, and choose "Manage subscription" to reach the secure billing portal.

Stripe will retry the charge automatically over the next few days, so if you've already fixed it, you're all set.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('failed_payment', 'cta_link')}`,
        ctaLabel: 'Update payment method',
        footnote:
          "You received this email because a subscription payment didn't go through. If you believe this is a mistake, reply to this email and we'll sort it out."
      }
    )
};

// ---------------------------------------------------------------------------
// Conversion (broadcast stream — unsubscribe footer appended by the service)
// ---------------------------------------------------------------------------

const checkoutAbandoned1h = {
  getSubject: () => 'Your 3DStreet Pro checkout is waiting',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>Looks like you started upgrading to <strong>3DStreet Pro</strong> but didn't finish checking out. Your cart is still there whenever you're ready.</p>

  <p>Pro unlocks watermark-free downloads, unlimited geospatial maps, HD renders, custom model imports, and a monthly allowance of AI tokens.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('checkout_abandoned_1h', 'cta_button')}#payment`,
        ctaLabel: 'Finish upgrading',
        footnote: null
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `Looks like you started upgrading to 3DStreet Pro but didn't finish checking out. Your cart is still there whenever you're ready.

Pro unlocks watermark-free downloads, unlimited geospatial maps, HD renders, custom model imports, and a monthly allowance of AI tokens.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('checkout_abandoned_1h', 'cta_link')}#payment`,
        ctaLabel: 'Finish upgrading',
        footnote: null
      }
    )
};

const checkoutAbandoned72h = {
  getSubject: () => 'Still thinking about 3DStreet Pro?',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>A few days ago you started a <strong>3DStreet Pro</strong> checkout. No pressure. But if something held you back, we'd genuinely like to know, and a reply to this email goes straight to us.</p>

  <p>If you're ready, picking up where you left off takes about a minute.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('checkout_abandoned_72h', 'cta_button')}#payment`,
        ctaLabel: 'Resume checkout',
        footnote: null
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `A few days ago you started a 3DStreet Pro checkout. No pressure. But if something held you back, we'd genuinely like to know, and a reply to this email goes straight to us.

If you're ready, picking up where you left off takes about a minute.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('checkout_abandoned_72h', 'cta_link')}#payment`,
        ctaLabel: 'Resume checkout',
        footnote: null
      }
    )
};

const pricingPageNudge = {
  getSubject: () => 'Questions about 3DStreet Pro?',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>You recently checked out the <strong>3DStreet Pro</strong> plans. If anything was unclear about pricing, features, or whether it fits your project, just reply to this email and a human will answer.</p>

  <p>The short version: Pro removes watermarks, makes geospatial maps unlimited, and adds HD renders, custom imports, and monthly AI tokens.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('pricing_nudge', 'cta_button')}#payment`,
        ctaLabel: 'See plans',
        footnote: null
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `You recently checked out the 3DStreet Pro plans. If anything was unclear about pricing, features, or whether it fits your project, just reply to this email and a human will answer.

The short version: Pro removes watermarks, makes geospatial maps unlimited, and adds HD renders, custom imports, and monthly AI tokens.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('pricing_nudge', 'cta_link')}#payment`,
        ctaLabel: 'See plans',
        footnote: null
      }
    )
};

// ---------------------------------------------------------------------------
// Lifecycle (broadcast stream)
// ---------------------------------------------------------------------------

const geoNotUsed = {
  getSubject: () => 'Put your street on a real map',
  getHtmlBody: (userName) =>
    htmlLayout(
      userName,
      `  <p>Did you know your 3DStreet scenes can sit on a photorealistic 3D map of the real world?</p>

  <p>Your account includes <strong>free geo tokens</strong> for Google 3D Map Tiles. Search for any address, drop your street design into the actual neighborhood, and see it in context. It's the fastest way to make a proposal feel real.</p>`,
      {
        ctaUrl: `${APP_BASE}/?${utm('geo_not_used', 'cta_button')}`,
        ctaLabel: 'Try 3D maps',
        footnote: null
      }
    ),
  getTextBody: (userName) =>
    textLayout(
      userName,
      `Did you know your 3DStreet scenes can sit on a photorealistic 3D map of the real world?

Your account includes free geo tokens for Google 3D Map Tiles. Search for any address, drop your street design into the actual neighborhood, and see it in context. It's the fastest way to make a proposal feel real.`,
      {
        ctaUrl: `${APP_BASE}/?${utm('geo_not_used', 'cta_link')}`,
        ctaLabel: 'Try 3D maps',
        footnote: null
      }
    )
};

module.exports = {
  welcome,
  postUpgradeWelcome,
  failedPayment,
  checkoutAbandoned1h,
  checkoutAbandoned72h,
  pricingPageNudge,
  geoNotUsed
};
