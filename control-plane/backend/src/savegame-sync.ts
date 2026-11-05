// Job periodico: mentre il game server è RUNNING, allinea lo store dei salvataggi
// con l'ultimo backup registrato dall'agent. L'agent scrive un marker locale ad
// ogni backup riuscito (auto-stop o manuale); qui lo leggiamo e, se è più recente
// di quanto già registrato per quel profilo, aggiorniamo savegames-store.

import { config } from "./config.js";
import { log } from "./logger.js";
import { getController } from "./oci/index.js";
import { agent, trySoft, type AgentBackupResult } from "./agent.js";
import { getConfig } from "./configs-store.js";
import { getSavegame, upsertSavegame } from "./savegames-store.js";

let timer: NodeJS.Timeout | null = null;

/** Registra subito un backup appena eseguito (POST /backup o spegnimento dal control
 * plane), senza aspettare il tick: dopo uno spegnimento non ci sarebbe un tick utile. */
export async function recordAgentBackup(result: AgentBackupResult) {
  const cfg = await getConfig(result.profileId ?? "");
  return upsertSavegame({
    id: result.profileId ?? result.objectKey,
    configId: cfg?.id ?? null,
    configName: cfg?.name ?? result.profileId ?? result.objectKey,
    map: result.map ?? cfg?.map ?? "",
    mods: result.mods,
    objectKey: result.objectKey,
    sizeBytes: result.sizeBytes,
    lastBackupAt: result.backedUpAt,
    status: "ok",
  });
}

async function tick(): Promise<void> {
  try {
    const ctrl = await getController();
    const { state } = await ctrl.getInfo();
    if (state !== "RUNNING") return;

    const last = await trySoft(() => agent.getLastBackup());
    if (!last || !last.profileId) return;

    const existing = await getSavegame(last.profileId);
    // Salta se già registrato con lo stesso (o più recente) timestamp di backup.
    if (existing?.lastBackupAt && existing.lastBackupAt >= last.backedUpAt) return;

    const cfg = await getConfig(last.profileId);
    await upsertSavegame({
      id: last.profileId,
      configId: cfg?.id ?? existing?.configId ?? null,
      configName: cfg?.name ?? existing?.configName ?? last.profileId,
      map: last.map ?? cfg?.map ?? existing?.map ?? "",
      mods: last.mods,
      objectKey: last.objectKey,
      sizeBytes: last.sizeBytes,
      lastBackupAt: last.backedUpAt,
      status: "ok",
    });
    log.info(`Savegame sync: registrato backup del profilo ${last.profileId}`);
  } catch (e) {
    // L'agent potrebbe non essere ancora raggiungibile appena dopo il boot: si
    // ritenta al prossimo tick.
    log.warn("Savegame sync non riuscito, ritento al prossimo tick", e);
  }
}

export function startSavegameSync(): void {
  const intervalMs = Math.max(10, config.savegameSyncIntervalSec) * 1000;
  log.info(`Sync salvataggi attivo (ogni ${config.savegameSyncIntervalSec}s)`);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
}

export function stopSavegameSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
