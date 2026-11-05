// Entrypoint backend: API sotto /api + (opzionale) PWA statica + SPA fallback.

import "./instrument.js";
import * as Sentry from "@sentry/node";
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { log } from "./logger.js";
import { communityRouter, legacyCompatibilityRouter } from "./community-routes.js";
import { startPlaytimeSync } from "./playtime-sync.js";
import { startBootSync } from "./boot-sync.js";
import { startSavegameSync } from "./savegame-sync.js";
import { powerStart } from "./power-start.js";
import { assertAuthConfigured } from "./supabase.js";
import { checkPersistence } from "./persistence-health.js";
import { startNotificationSync } from "./notification-sync.js";
import { startOfflineWatchdog } from "./offline-watchdog.js";
import { serverShutdown } from "./server-shutdown.js";

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", async (_req, res) => {
  const persistence = await checkPersistence(config.dataDir);
  res.status(persistence.ok ? 200 : 503).json({
    ok: persistence.ok,
    mode: config.ociMode,
    provider: config.instanceProvider,
    revision: config.imageRevision,
    features: {
      communityCreation: config.communityCreationEnabled,
      fleetProvisioning: config.fleetProvisioningEnabled,
    },
    persistence,
  });
});

app.get("/api/auth/config", (_req, res) => res.json({
  supabaseUrl: config.supabaseUrl,
  supabasePublishableKey: config.supabasePublishableKey,
}));
// API multi-community additiva. Un'identità Google valida può esplorare le
// community; l'accesso al server richiede invece una membership attiva.
app.use("/api/v2", communityRouter);
// Alias v1 per client rimasti in cache: l'autorizzazione viene risolta dalla
// stessa membership della community legacy v2, quindi revoche e kill-switch
// hanno effetto immediato anche sulle vecchie URL.
app.use("/api", legacyCompatibilityRouter);

// Serve la PWA buildata, se presente.
if (config.pwaDist) {
  const dist = path.resolve(config.pwaDist);
  if (existsSync(dist)) {
    log.info(`Servo la PWA da ${dist}`);
    app.use(express.static(dist));
    // SPA fallback: tutto ciò che non è /api torna index.html
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    log.warn(`PWA_DIST=${dist} non esiste: la PWA non sarà servita`);
  }
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log.error("Errore non gestito", err);
  const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
  const status = code === "COMMUNITY_VALIDATION" ? 400
    : code === "COMMUNITY_FORBIDDEN" ? 403
      : code === "COMMUNITY_NOT_FOUND" ? 404
        : ["DUPLICATE_EMAIL", "COMMUNITY_CONFLICT", "COMMUNITY_LIMIT"].includes(code) ? 409
          : 500;
  if (status >= 500) Sentry.captureException(err);
  const message = status >= 500 ? "errore interno" : err instanceof Error ? err.message : "richiesta non valida";
  res.status(status).json({ error: message });
});

assertAuthConfigured();
const server = app.listen(config.port, config.bind, () => {
  log.info(`backend in ascolto su ${config.bind}:${config.port} (provider: ${config.instanceProvider})`);
  // Prima di boot-sync: uno spegnimento interrotto da un restart blocca il ripristino automatico.
  void serverShutdown.init().catch((error) => log.error("Lettura stato spegnimento fallita", error));
  startPlaytimeSync();
  startBootSync();
  startSavegameSync();
  startNotificationSync();
  void startOfflineWatchdog().catch((error) => log.error("Avvio watchdog offline fallito", error));
  void powerStart.init().catch((error) => log.error("Avvio retry accensione fallito", error));
});

function shutdown(sig: string): void {
  log.info(`Ricevuto ${sig}, chiusura…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Rete di sicurezza: una promise rifiutata non gestita (es. bug futuro in un job
// periodico) non deve far crashare l'intero processo — vedi issue #1 (crash-loop
// di 49h innescato da un'auth OCI fallita non catturata in boot-sync.ts).
process.on("unhandledRejection", (reason) => {
  log.error("UnhandledPromiseRejection (ignorata, processo non terminato)", reason);
});
