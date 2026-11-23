/* global VERSION */
import * as Sentry from '@sentry/react';

// Firestore aborts its own streaming fetch whenever it tears a channel down
// (idle stream, network change, reconnect) and retries by itself; the
// rejection escapes as an unhandled AbortError with only Firebase frames.
// Nothing in our code can catch or act on it. Matched on the frames, not the
// message, so an AbortError from our own code is still reported.
export function isFirebaseInternalAbort(event) {
  const exception = event.exception?.values?.[0];
  if (exception?.type !== 'AbortError') return false;
  const frames = exception.stacktrace?.frames ?? [];
  const appFrames = frames.filter(
    (frame) => !frame.filename?.includes('@sentry/')
  );
  return (
    appFrames.length > 0 &&
    appFrames.every((frame) => frame.filename?.includes('@firebase/'))
  );
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: typeof VERSION !== 'undefined' ? VERSION : undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration()
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: [/^https:\/\/3dstreet\.app/],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (isFirebaseInternalAbort(event)) return null;
      return event;
    }
  });
  console.debug('[Sentry] Initialized – error reporting enabled.');

  // index.html shows a message instead of starting the scene when WebGL is
  // unavailable; report it once, grouped, so the count stays visible.
  window.addEventListener('webglunavailable', (event) => {
    Sentry.captureMessage('WebGL unavailable', {
      level: 'warning',
      fingerprint: ['webgl-unavailable'],
      extra: { reason: event.detail }
    });
  });
} else {
  console.debug('[Sentry] DSN not set – error reporting disabled.');
}
