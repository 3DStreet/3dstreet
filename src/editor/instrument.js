import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'https://b47a042eed6f907bc1dd1220f935881f@o4510089552265216.ingest.us.sentry.io/4510092752060416',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration()
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ['localhost', /^https:\/\/3dstreet\.app/],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0
});
