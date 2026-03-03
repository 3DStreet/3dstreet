import * as Sentry from '@sentry/react';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration()
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: [/^https:\/\/3dstreet\.app/],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0
  });
  console.debug('[Sentry] Initialized – error reporting enabled.');
} else {
  console.debug('[Sentry] DSN not set – error reporting disabled.');
}
