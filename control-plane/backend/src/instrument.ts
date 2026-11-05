// Sentry, prima di ogni altro import (vedi index.ts). Senza SENTRY_DSN l'SDK resta
// spento, come in sviluppo e nei test.

import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.APP_REVISION,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.05,
  // Qui passano token di Supabase ed email degli utenti. La 10 e non la 11: la 11 porta
  // oxc-parser, un modulo nativo, e il Dockerfile li vieta (node_modules copiato tra
  // architetture).
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
    }
    return event;
  },
});
