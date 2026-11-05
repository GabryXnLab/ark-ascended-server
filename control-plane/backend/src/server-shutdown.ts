// Spegnimento ordinato del game server avviato dal control plane: stessa sequenza
// dell'auto-stop dell'agent (saveworld + stop ASA, backup su Object Storage, poi
// SOFTSTOP della VM con ritorno del boot volume al tier idle, vedi oci/live.ts).
// Usata da POST /power/off e dal watchdog offline; gira in background perché il
// backup può richiedere minuti e non deve tenere aperta la richiesta HTTP.
//
// Il backup sovrascrive l'unica copia del profilo su Object Storage: si fa solo
// se ASA è stato RCON-online dall'ultimo avvio (un salvataggio rifiutato al boot
// non deve sostituire quello buono) e mai dal watchdog, che scatta proprio
// quando ASA non è andato online.
//
// L'intenzione di spegnimento è persistita su disco: un restart del backend a
// metà sequenza (es. deploy automatico) non deve far ripartire ASA da boot-sync.
// Al riavvio la sequenza riprende se la VM è ancora RUNNING e il file viene
// rimosso solo quando la VM risulta STOPPED.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import type { AgentBackupResult } from "./agent.js";

export type ShutdownReason = "manual" | "watchdog";

export interface ShutdownStatus {
  inProgress: boolean;
  reason: ShutdownReason | null;
  startedAt: string | null;
  lastError: string | null;
}

/** "running": sequenza in corso; "stop-requested": SOFTSTOP accettato da OCI, si attende STOPPED. */
export interface PersistedShutdown {
  reason: ShutdownReason;
  startedAt: string;
  phase: "running" | "stop-requested";
}

export interface ShutdownStore {
  load(): Promise<PersistedShutdown | null>;
  save(intent: PersistedShutdown): Promise<void>;
  clear(): Promise<void>;
}

export function fileShutdownStore(stateFile: string): ShutdownStore {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(stateFile, "utf8")) as Partial<PersistedShutdown>;
        if ((parsed.reason !== "manual" && parsed.reason !== "watchdog") || typeof parsed.startedAt !== "string") return null;
        return { reason: parsed.reason, startedAt: parsed.startedAt, phase: parsed.phase === "stop-requested" ? "stop-requested" : "running" };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") log.warn("Stato spegnimento persistente illeggibile, ignorato", error);
        return null;
      }
    },
    async save(intent) {
      await mkdir(path.dirname(stateFile), { recursive: true });
      const tempFile = `${stateFile}.${process.pid}.tmp`;
      await writeFile(tempFile, `${JSON.stringify(intent, null, 2)}\n`, { mode: 0o600 });
      await rename(tempFile, stateFile);
    },
    async clear() {
      await rm(stateFile, { force: true });
    },
  };
}

export interface ShutdownDependencies {
  /** true solo se l'agent certifica RCON-online dall'ultimo avvio di ASA. */
  onlineCertified(): Promise<boolean>;
  /** Stage del provisioning sull'agent; null se irraggiungibile. */
  provisionStage(): Promise<string | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  stopArk(): Promise<unknown>;
  backup(): Promise<AgentBackupResult | { ok: false } | null>;
  recordBackup(result: AgentBackupResult): Promise<unknown>;
  stopInstance(): Promise<void>;
}

const SETTLED_PROVISION_STAGES = new Set(["idle", "online", "error"]);
const PROVISION_SETTLE_TIMEOUT_MS = 5 * 60_000;
const PROVISION_SETTLE_POLL_MS = 5_000;

/**
 * Attende che il provisioning dell'agent sia fermo (idle/online/error). Lo stop
 * dello spegnimento lo annulla, ma SteamCMD o il download di un restore finiscono
 * il passaggio in corso: fare il backup mentre scrivono i file darebbe un archivio
 * incoerente, e un agent vecchio può persino riavviare ASA.
 */
export async function waitForProvisioningSettled(
  deps: Pick<ShutdownDependencies, "provisionStage" | "sleep" | "now">,
): Promise<boolean> {
  const deadline = deps.now() + PROVISION_SETTLE_TIMEOUT_MS;
  for (;;) {
    const stage = await deps.provisionStage().catch(() => null);
    if (stage !== null && SETTLED_PROVISION_STAGES.has(stage)) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(PROVISION_SETTLE_POLL_MS);
  }
}

export class ServerShutdown {
  private current: Promise<void> | null = null;
  private pending: PersistedShutdown | null = null;
  private loading: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly deps: () => Promise<ShutdownDependencies>,
    private readonly store: ShutdownStore,
  ) {}

  /** Carica l'intenzione persistita; idempotente. */
  init(): Promise<void> {
    this.loading ??= this.store.load().then((saved) => {
      if (saved && !this.pending) {
        this.pending = saved;
        log.info(`Spegnimento (${saved.reason}) del ${saved.startedAt} ripristinato dal disco`);
      }
    });
    return this.loading;
  }

  /** In corso finché la sequenza gira o, dopo il SOFTSTOP, finché la VM non è STOPPED. */
  status(): ShutdownStatus {
    return {
      inProgress: this.current !== null || this.pending !== null,
      reason: this.pending?.reason ?? null,
      startedAt: this.pending?.startedAt ?? null,
      lastError: this.lastError,
    };
  }

  /** Avvia la sequenza; se è già in corso restituisce quella esistente. */
  run(reason: ShutdownReason): Promise<void> {
    if (this.current) return this.current;
    const intent: PersistedShutdown = this.pending?.phase === "running"
      ? this.pending
      : { reason, startedAt: new Date().toISOString(), phase: "running" };
    this.pending = intent;
    this.lastError = null;
    this.current = this.persist(intent)
      .then(() => this.sequence(intent.reason))
      .finally(() => { this.current = null; });
    return this.current;
  }

  /**
   * Allinea l'intenzione allo stato OCI: la rimuove a VM STOPPED e riprende una
   * sequenza interrotta da un restart del backend se la VM è ancora RUNNING.
   */
  async reconcile(instanceState: string): Promise<void> {
    await this.init();
    if (!this.pending || this.current) return;
    if (instanceState === "STOPPED") {
      this.pending = null;
      await this.store.clear().catch((error) => log.warn("Rimozione stato spegnimento persistente fallita", error));
      return;
    }
    if (instanceState === "RUNNING" && this.pending.phase === "running") {
      log.warn(`Spegnimento (${this.pending.reason}) interrotto da un restart del backend: lo riprendo`);
      void this.run(this.pending.reason).catch(() => undefined); // errore già in lastError
    }
  }

  private async persist(intent: PersistedShutdown): Promise<void> {
    try {
      await this.store.save(intent);
    } catch (error) {
      // Senza persistenza lo spegnimento procede comunque: un restart del
      // backend potrebbe solo far ripartire ASA, come prima di questo file.
      log.warn("Persistenza dello spegnimento fallita, proseguo", error);
    }
  }

  private async sequence(reason: ShutdownReason): Promise<void> {
    const deps = await this.deps();
    const backupAllowed = reason === "manual" && await deps.onlineCertified().catch(() => false);
    try {
      await deps.stopArk();
    } catch (error) {
      // ASA già fermo o agent irraggiungibile: il disco resta comunque persistente.
      log.warn(`Spegnimento (${reason}): stop ARK non riuscito, proseguo`, error);
    }
    if (!backupAllowed) {
      log.info(`Spegnimento (${reason}): backup saltato, ASA non certificato RCON-online in questa accensione`);
    } else if (!await waitForProvisioningSettled(deps)) {
      log.warn(`Spegnimento (${reason}): backup saltato, il provisioning dell'agent non si è fermato in tempo`);
    } else {
      try {
        const result = await deps.backup();
        if (result && "objectKey" in result && result.profileId) await deps.recordBackup(result);
        // L'agent segnala così sia il backup disattivato sia tar/verifica falliti:
        // senza questa riga lo spegnimento proseguiva senza lasciare traccia.
        else log.warn(`Spegnimento (${reason}): l'agent non ha eseguito il backup (vedi log dell'agent), proseguo`);
      } catch (error) {
        log.warn(`Spegnimento (${reason}): backup su Object Storage non riuscito, proseguo`, error);
      }
    }
    try {
      await deps.stopInstance();
      log.info(`Spegnimento (${reason}): SOFTSTOP inviato`);
    } catch (error) {
      // L'intenzione decade: la VM resta accesa e l'utente vede l'errore; il
      // watchdog resta la rete di sicurezza sui costi.
      this.lastError = error instanceof Error ? error.message : String(error);
      this.pending = null;
      await this.store.clear().catch((clearError) => log.warn("Rimozione stato spegnimento persistente fallita", clearError));
      log.error(`Spegnimento (${reason}): stop istanza fallito`, error);
      throw error;
    }
    if (this.pending) {
      this.pending = { ...this.pending, phase: "stop-requested" };
      await this.persist(this.pending);
    }
  }
}

// Import dinamici: il modulo resta testabile senza caricare agent/OCI/store.
export const serverShutdown = new ServerShutdown(async () => {
  const [{ agent, trySoft }, { getController }, { recordAgentBackup }] = await Promise.all([
    import("./agent.js"),
    import("./oci/index.js"),
    import("./savegame-sync.js"),
  ]);
  const ctrl = await getController();
  return {
    onlineCertified: async () => typeof (await agent.arkStatus()).onlineCertifiedAt === "string",
    provisionStage: async () => (await trySoft(() => agent.provisionStatus()))?.stage ?? null,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    stopArk: () => agent.stopArk(),
    backup: () => agent.backup(),
    recordBackup: recordAgentBackup,
    stopInstance: () => ctrl.stop(),
  };
}, fileShutdownStore(config.shutdownStateFile));
