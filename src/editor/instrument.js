/* global VERSION */
import * as Sentry from '@sentry/react';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: typeof VERSION !== 'undefined' ? VERSION : undefined,
    integrations: [
      Sentry.browserTracingIntegration({
        // GLTFLoader reads embedded textures through blob: URLs, so every
        // model load fans out into parallel blob fetches that Sentry flags as
        // an "N+1 API Call". They never touch the network; don't span them.
        shouldCreateSpanForRequest: (url) =>
          !url.startsWith('blob:') && !url.startsWith('data:')
      }),
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
