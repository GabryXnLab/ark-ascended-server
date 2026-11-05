// Rete di sicurezza sui costi: se la VM (a pagamento) resta RUNNING ma ASA non
// risulta RCON-online per config.offlineWatchdogMinutes consecutivi, il control
// plane la spegne da sé. Non si affida all'agent, che potrebbe essere proprio il
// componente bloccato o morto (deadlock GameThread, crash del container...).
//
// Il conteggio parte dalla prima osservazione "RUNNING e non online" e si azzera
// appena ASA è online o la VM non è più RUNNING. Vive in memoria: un restart del
// backend lo fa ripartire da zero, quindi può solo ritardare lo spegnimento.
//
// Scaduta la soglia, non scatta finché il provisioning dell'agent avanza (fase o
// updatedAt cambiati negli ultimi PROVISION_PROGRESS_WINDOW_MS): un primo avvio
// con aggiornamento di gioco e mod lunghi non va interrotto. Agent irraggiungibile,
// provisioning fermo o in errore non rinviano lo spegnimento.

import { config } from "./config.js";
import { log } from "./logger.js";
import { LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID } from "./community-model.js";

export interface ProvisionProgress {
  stage: string;
  updatedAt: string;
}

export interface OfflineWatchdogDependencies {
  instanceState(): Promise<string>;
  /** null = agent non raggiungibile, conta come offline. */
  arkOnline(): Promise<boolean | null>;
  /** null = agent non raggiungibile. */
  provisionProgress(): Promise<ProvisionProgress | null>;
  shutdownInProgress(): boolean;
  shutdown(): Promise<void>;
  notify(offlineSince: Date, minutes: number): Promise<void>;
  now(): number;
}

export type WatchdogOutcome = "idle" | "online" | "counting" | "provisioning" | "triggered";

const PROVISION_PROGRESS_WINDOW_MS = 15 * 60_000;
const SETTLED_PROVISION_STAGES = new Set(["idle", "online", "error"]);

export class OfflineWatchdog {
  private offlineSince: number | null = null;
  // Confronto per osservazione, non con l'orologio dell'agent: niente dipendenza dalla deriva fra host.
  private lastProgress: string | null = null;
  private lastProgressChangeAt = 0;

  constructor(
    private readonly deps: OfflineWatchdogDependencies,
    private readonly limitMinutes: number,
  ) {}

  async pollOnce(): Promise<WatchdogOutcome> {
    if (await this.deps.instanceState() !== "RUNNING") {
      this.offlineSince = null;
      return "idle";
    }
    // Uno spegnimento già avviato (manuale, auto-stop, watchdog) ferma ASA di proposito.
    if (this.deps.shutdownInProgress()) return "idle";
    if (await this.deps.arkOnline() === true) {
      this.offlineSince = null;
      return "online";
    }
    const now = this.deps.now();
    if (this.offlineSince === null) this.offlineSince = now;
    const advancing = await this.provisioningAdvancing(now);
    if (now - this.offlineSince < this.limitMinutes * 60_000) return "counting";
    if (advancing) return "provisioning";

    const offlineSince = new Date(this.offlineSince);
    this.offlineSince = null;
    log.warn(`Watchdog: VM RUNNING ma ASA offline da ${this.limitMinutes} min → spegnimento`);
    try {
      await this.deps.notify(offlineSince, this.limitMinutes);
    } catch (error) {
      // La notifica è informativa: non deve mai impedire lo spegnimento.
      log.warn("Watchdog: notifica di spegnimento non registrata", error);
    }
    await this.deps.shutdown();
    return "triggered";
  }

  private async provisioningAdvancing(now: number): Promise<boolean> {
    const progress = await this.deps.provisionProgress().catch(() => null);
    if (!progress || SETTLED_PROVISION_STAGES.has(progress.stage)) {
      this.lastProgress = null;
      return false;
    }
    const signature = `${progress.stage}|${progress.updatedAt}`;
    if (signature !== this.lastProgress) {
      this.lastProgress = signature;
      this.lastProgressChangeAt = now;
    }
    return now - this.lastProgressChangeAt < PROVISION_PROGRESS_WINDOW_MS;
  }
}

let timer: NodeJS.Timeout | null = null;
let polling = false;

export async function startOfflineWatchdog(): Promise<void> {
  const [{ getController }, { agent, trySoft }, { serverShutdown }, { notifications }] = await Promise.all([
    import("./oci/index.js"),
    import("./agent.js"),
    import("./server-shutdown.js"),
    import("./notifications-store.js"),
  ]);
  const watchdog = new OfflineWatchdog({
    instanceState: async () => (await (await getController()).getInfo()).state,
    arkOnline: async () => (await trySoft(() => agent.arkStatus()))?.online ?? null,
    provisionProgress: () => trySoft(() => agent.provisionStatus()),
    shutdownInProgress: () => serverShutdown.status().inProgress,
    shutdown: () => serverShutdown.run("watchdog"),
    notify: (offlineSince, minutes) => notifications.recordWatchdogShutdown(
      LEGACY_COMMUNITY_ID, LEGACY_SERVER_ID, offlineSince, minutes,
    ),
    now: () => Date.now(),
  }, config.offlineWatchdogMinutes);
  log.info(`Watchdog offline attivo: spegne la VM dopo ${config.offlineWatchdogMinutes} min senza ASA online`);
  timer = setInterval(() => {
    // Lo spegnimento può durare minuti (backup): niente poll sovrapposti.
    if (polling) return;
    polling = true;
    void watchdog.pollOnce()
      .catch((error) => log.warn("Watchdog offline fallito, ritento al prossimo intervallo", error))
      .finally(() => { polling = false; });
  }, 60_000);
  timer.unref?.();
}
