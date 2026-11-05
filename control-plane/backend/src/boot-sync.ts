// Job periodico che, non appena il game server torna RUNNING e l'agent è
// raggiungibile, prima applica ogni operazione fatta a server spento (whitelist
// admin e selezione configurazione — vedi boot-queue-store.ts) e solo
// dopo, se non resta nulla in coda, lascia partire ARK. La whitelist admin ha
// priorità nella coda e viene quindi materializzata prima di una selectConfig.
// Se ARK non è ancora online
// e non c'è nulla da applicare, ripristina automaticamente l'ultima configurazione
// (getCurrentConfigId, vedi configs-store.ts). Prima di questo modulo un power-on
// "semplice" (nessuna modifica accodata) non faceva ripartire ARK da solo, serviva
// sempre un'azione manuale in PWA.
//
// Un'operazione per tick: mantiene l'avanzamento osservabile (GET /boot-queue,
// GET /provision/status) e non sovraccarica l'agent con chiamate in sequenza
// subito dopo il boot, quando ASA potrebbe ancora starsi installando/aggiornando
// (vedi entrypoint.sh: il self-update del codice/immagine avviene PRIMA che questo
// container/agent parta, quindi qui c'è già in esecuzione il codice pubblicato
// dall'ultimo deploy — questo job si occupa solo di riallineare la configurazione).

import { config } from "./config.js";
import { log } from "./logger.js";
import { getController } from "./oci/index.js";
import { agent, trySoft } from "./agent.js";
import { listBootQueue, dequeueBootOp } from "./boot-queue-store.js";
import { getCurrentConfigId, getConfig } from "./configs-store.js";
import { applyBootQueueOp, applyConfigLive } from "./routes.js";
import { getIdleStopState, reconcileAgentIdleStop } from "./idle-stop-store.js";
import { serverShutdown } from "./server-shutdown.js";

let timer: NodeJS.Timeout | null = null;
// Un solo tentativo di ripristino automatico per ciclo di accensione: il
// provisioning può richiedere minuti (download mod), non va rilanciato ad ogni
// tick mentre è già in corso. Si resetta quando l'istanza torna non-RUNNING.
let autoResumeAttempted = false;
// Se l'agent sparisce dopo che il server era online (restart/crash del
// container a VM ancora RUNNING), al suo ritorno serve un nuovo auto-resume.
let agentUnavailableAfterResume = false;
let lastBootId: string | undefined;

/**
 * A stop/start of the game container that completes between two ticks is
 * never observed as non-RUNNING, so the per-cycle flags would stay set and
 * ASA would not be resumed. The provider's bootId reveals that restart.
 */
export function isUnobservedRestart(previous: string | undefined, current: string | undefined): boolean {
  return previous !== undefined && current !== undefined && previous !== current;
}

async function tick(): Promise<void> {
  try {
    const ctrl = await getController();
    const { state, bootId } = await ctrl.getInfo();
    if (isUnobservedRestart(lastBootId, bootId)) {
      autoResumeAttempted = false;
      agentUnavailableAfterResume = false;
      log.info("Game server restarted since the last check: auto-resume re-enabled");
    }
    if (bootId !== undefined) lastBootId = bootId;
    await serverShutdown.reconcile(state);
    if (state !== "RUNNING") {
      autoResumeAttempted = false;
      agentUnavailableAfterResume = false;
      return;
    }
    // Durante uno spegnimento dal control plane ASA è offline di proposito: il
    // ripristino automatico lo riavvierebbe mentre si fa il backup. L'intenzione
    // è persistita, quindi vale anche dopo un restart del backend.
    if (serverShutdown.status().inProgress) return;

    // Anche dopo un restart del solo container agent (che riparte dal default
    // env), non solo al boot della VM.
    try {
      const { idleStopMinutes } = await getIdleStopState();
      await reconcileAgentIdleStop(
        idleStopMinutes,
        () => trySoft(() => agent.timer()),
        (minutes) => agent.setTimer(minutes),
      );
    } catch (e) {
      log.warn("Riallineamento timer auto-stop fallito, ritento al prossimo tick", e);
    }

    const queue = await listBootQueue();
    if (queue.length > 0) {
      // Una selectConfig avvia un provisioning asincrono. Non eseguire la voce
      // successiva mentre l'agent sta ancora fermando/applicando/avviando ASA:
      // eviterebbe sovrapposizioni fra modifiche dirette e cambio configurazione.
      const provision = await trySoft(() => agent.provisionStatus());
      if (provision && provision.stage !== "idle" && provision.stage !== "online" && provision.stage !== "error") {
        return;
      }
      const op = queue[0]!;
      if (serverShutdown.status().inProgress) return;
      try {
        await applyBootQueueOp(op);
        await dequeueBootOp(op.id);
        log.info(`Operazione in coda applicata al boot: ${op.kind} (${op.id})`);
      } catch (e) {
        // L'agent potrebbe non essere ancora raggiungibile appena dopo il boot, o ASA
        // potrebbe essere ancora in fase di validazione file: si ritenta al prossimo tick.
        log.warn(`Operazione in coda (${op.kind}) non riuscita, ritento al prossimo tick`, e);
      }
      return;
    }

    // Nessuna operazione in coda: se ARK non è già online, riparte da sola con l'ultima
    // configurazione applicata (se ce n'è una) invece di restare ferma in attesa di
    // un'azione manuale in PWA.
    const currentId = await getCurrentConfigId();
    if (!currentId) return; // nessuna configurazione mai applicata: nulla da ripristinare

    const provisionState = await trySoft(() => agent.provisionStatus());
    if (!provisionState) {
      if (autoResumeAttempted) agentUnavailableAfterResume = true;
      return; // agent non ancora raggiungibile
    }
    if (agentUnavailableAfterResume) {
      autoResumeAttempted = false;
      agentUnavailableAfterResume = false;
      log.info("Agent tornato raggiungibile: riabilito il ripristino automatico di ARK");
    }
    if (autoResumeAttempted) return;
    if (provisionState.stage !== "idle" && provisionState.stage !== "error") return; // già in corso

    const ark = await trySoft(() => agent.arkStatus());
    if (ark === null) return; // agent irraggiungibile in questo istante, ritento al prossimo tick
    if (ark.online) {
      autoResumeAttempted = true;
      return;
    }

    const cfg = await getConfig(currentId);
    if (!cfg) return;
    // Le attese sopra lasciano il tempo a uno spegnimento di partire
    // (applyConfigLive ricontrolla comunque subito prima di avviare ASA).
    if (serverShutdown.status().inProgress) return;
    autoResumeAttempted = true;
    try {
      await applyConfigLive(cfg);
      log.info(`Ripristino automatico al boot: configurazione "${cfg.name}" riavviata`);
    } catch (e) {
      log.warn("Ripristino automatico al boot non riuscito, ritento al prossimo ciclo di accensione", e);
      autoResumeAttempted = false;
    }
  } catch (e) {
    // Es. auth OCI transitoriamente non raggiungibile: si ritenta al prossimo tick
    // invece di lasciare che il rifiuto propaghi come UnhandledPromiseRejection
    // (che con `void tick()` in setInterval fa crashare l'intero processo).
    log.warn("Boot sync fallito, ritento al prossimo tick", e);
  }
}

export function startBootSync(): void {
  // Nome storico della env var (QUEUED_CONFIG_SYNC_INTERVAL_SEC): mantenuto per non
  // rompere un valore già impostato in produzione (vedi commento in config.ts).
  const intervalMs = Math.max(5, config.queuedConfigSyncIntervalSec) * 1000;
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
}

export function stopBootSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
