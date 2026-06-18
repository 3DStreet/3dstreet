const functions = require('firebase-functions/v1');

/**
 * Enforce Firebase App Check on a callable request.
 *
 * App Check attests that a request comes from *our* registered app on an
 * authorized domain. Forked / self-hosted clients (and direct `curl` calls)
 * can't produce a valid token, so enforcing it here stops them from spending
 * the production project's paid resources (AI generation, geocoding, storage,
 * Stripe) even when they reuse the public Firebase web config.
 *
 * Opt-in via the APP_CHECK_ENFORCE flag: enforcement must stay OFF until the
 * reCAPTCHA site key is provisioned in the console AND the official clients are
 * shipping App Check tokens (see config/.env.template + SELF_HOSTING.md).
 * Flipping it on before that would reject every real request. While the flag is
 * unset this is a no-op, so it is safe to wire into handlers ahead of rollout.
 *
 * `context.app` is populated by the callable runtime only when a *valid* App
 * Check token accompanies the request; an absent or invalid token leaves it
 * undefined (the request is not auto-rejected unless this guard runs).
 *
 * @param {Object} context - The callable function context.
 * @throws {functions.https.HttpsError} 'failed-precondition' when enforcement
 *   is enabled and no verified App Check token is present.
 */
function assertAppCheck(context) {
  if (process.env.APP_CHECK_ENFORCE !== 'true') {
    return;
  }
  if (!context.app) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'App Check verification failed. This request did not come from an authorized 3DStreet client.'
    );
  }
}

module.exports = { assertAppCheck };
