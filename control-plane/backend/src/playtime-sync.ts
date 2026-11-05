// Job periodico: mentre il game server è RUNNING, importa le sessioni chiuse
// dall'agent nello storico persistente del control plane (playtime-store).

import { config } from "./config.js";
import { log } from "./logger.js";
import { getController } from "./oci/index.js";
import { agent, trySoft } from "./agent.js";
import { getCursor, appendSessions } from "./playtime-store.js";

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const ctrl = await getController();
    const { state } = await ctrl.getInfo();
    if (state !== "RUNNING") return;

    const since = await getCursor();
    const sessions = await trySoft(() => agent.playtimeSessions(since));
    if (!sessions || sessions.length === 0) return;
    const added = await appendSessions(sessions);
    if (added > 0) log.info(`Playtime sync: importate ${added} sessioni`);
  } catch (e) {
    log.error("Playtime sync fallito", e);
  }
}

export function startPlaytimeSync(): void {
  const intervalMs = Math.max(10, config.playtimeSyncIntervalSec) * 1000;
  log.info(`Sync playtime attivo (ogni ${config.playtimeSyncIntervalSec}s)`);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
}

export function stopPlaytimeSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
