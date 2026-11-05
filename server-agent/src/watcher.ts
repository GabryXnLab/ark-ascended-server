// Watcher auto-stop: interroga ARK a intervalli; se 0 giocatori per N minuti
// consecutivi → saveworld, stop ARK, self-stop dell'istanza.

import { config } from "./config.js";
import { log } from "./logger.js";
import { arkStatus, stopArk, broadcast } from "./ark.js";
import { selfStop } from "./selfstop.js";
import { backupSaves } from "./backup.js";
import { getMetrics } from "./metrics.js";
import { maybeGrowBootVolume } from "./autogrow.js";

export interface WatcherState {
  idleStopMinutes: number;
  emptySinceSec: number; // da quanti secondi il server è vuoto (0 = non vuoto)
  running: boolean;
}

const state: WatcherState = {
  idleStopMinutes: config.idleStopMinutes,
  emptySinceSec: 0,
  running: false,
};

let emptySince: number | null = null;
let warned = false;
let timer: NodeJS.Timeout | null = null;

export function getWatcherState(): WatcherState {
  return {
    idleStopMinutes: state.idleStopMinutes,
    emptySinceSec: emptySince ? Math.round((Date.now() - emptySince) / 1000) : 0,
    running: state.running,
  };
}

export function setIdleStopMinutes(min: number): void {
  state.idleStopMinutes = Math.max(0, Math.floor(min));
  emptySince = null;
  warned = false;
  log.info(`Auto-stop impostato a ${state.idleStopMinutes} min${state.idleStopMinutes === 0 ? " (disabilitato)" : ""}`);
}

async function tick(): Promise<void> {
  // Controllo storage indipendente dall'auto-stop: gira a ogni tick, ma
  // maybeGrowBootVolume applica al suo interno un cooldown per non chiamare
  // OCI di continuo.
  try {
    await maybeGrowBootVolume(await getMetrics());
  } catch (e) {
    log.debug("watcher: controllo autoscaling disco fallito", e);
  }

  if (state.idleStopMinutes <= 0) {
    emptySince = null;
    return;
  }
  let status;
  try {
    status = await arkStatus();
  } catch (e) {
    log.debug("watcher: arkStatus fallito", e);
    return;
  }
  if (!status.online) {
    emptySince = null;
    warned = false;
    return;
  }

  if (status.playerCount > 0) {
    if (emptySince !== null) log.info(`Giocatori presenti (${status.playerCount}): timer auto-stop azzerato`);
    emptySince = null;
    warned = false;
    return;
  }

  // Server vuoto.
  if (emptySince === null) {
    emptySince = Date.now();
    log.info("Server vuoto: avvio conteggio auto-stop");
  }
  const idleSec = (Date.now() - emptySince) / 1000;
  const limitSec = state.idleStopMinutes * 60;

  // Avviso a 1 minuto dalla soglia (se c'è margine).
  if (!warned && limitSec - idleSec <= 60 && limitSec > 60) {
    warned = true;
    await broadcast("Server vuoto: spegnimento automatico tra 1 minuto.").catch(() => {});
  }

  if (idleSec >= limitSec) {
    log.warn(`Inattività ${Math.round(idleSec)}s ≥ soglia ${limitSec}s → auto-stop`);
    emptySince = null;
    warned = false;
    try {
      await stopArk();
    } catch (e) {
      log.error("stopArk in auto-stop fallito", e);
    }
    await backupSaves().catch((e) => log.error("backupSaves in auto-stop fallito", e));
    await selfStop();
  }
}

export function startWatcher(): void {
  if (state.running) return;
  state.running = true;
  const intervalMs = Math.max(10, config.watcherIntervalSec) * 1000;
  log.info(`Watcher auto-stop attivo (ogni ${config.watcherIntervalSec}s)`);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // non blocca l'uscita del processo
  timer.unref?.();
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state.running = false;
}
