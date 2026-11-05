// Entrypoint dell'agent: HTTP server Express + watcher auto-stop.

import express, { type Request, type Response, type NextFunction } from "express";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { isLoopbackAddress, requireToken } from "./auth.js";
import { router } from "./routes.js";
import { startWatcher } from "./watcher.js";
import { startPlaytimeTracker, closeAllLive } from "./playtime.js";
import { stopArk } from "./ark.js";
import { primeBaseGameUpdate } from "./content-updates.js";
import { restoreIdleBootVolumePerformance } from "./boot-volume-performance.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

// /health è pubblico (probe); tutto il resto richiede token.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.path === "/admin-whitelist.txt" && isLoopbackAddress(req.socket.remoteAddress)) return next();
  return requireToken(req, res, next);
});

app.use(router);

// 404 + error handler.
app.use((_req, res) => res.status(404).json({ error: "not found" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log.error("Errore non gestito", err);
  res.status(500).json({ error: err instanceof Error ? err.message : "errore interno" });
});

const server = app.listen(config.port, config.bind, () => {
  log.info(`server-agent in ascolto su ${config.bind}:${config.port} (mode=${config.mode})`);
  if (isMock()) log.warn("MODALITÀ MOCK: nessun comando reale verso systemd/RCON/OCI");
  startWatcher();
  startPlaytimeTracker();
  // Avvia subito lo stesso controllo che il primo provisioning dovrà
  // attendere: l'endpoint health resta disponibile e nessun controllo viene
  // rimosso, ma rete/SteamCMD lavorano in parallelo al boot-sync remoto.
  void primeBaseGameUpdate().catch((e) => {
    log.warn("Pre-controllo SteamCMD fallito; il provisioning riporterà l'errore e potrà ritentare", e);
  });
});

function shutdown(sig: string): void {
  log.info(`Ricevuto ${sig}, chiusura…`);
  Promise.all([
    closeAllLive(),
    restoreIdleBootVolumePerformance().catch((e) => {
      log.warn("Ripristino tier Balanced durante shutdown fallito", e);
    }),
  ])
    .catch((e) => log.error("Chiusura sessioni giocatore fallita", e))
    .then(() => stopArk())
    .catch((e) => log.error("Stop ARK durante la chiusura fallito", e))
    .finally(() => server.close(() => process.exit(0)));
  setTimeout(
    () => process.exit(0),
    Math.max(10_000, (config.saveSettleSec + config.stopTimeoutSec + 15) * 1000),
  ).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
