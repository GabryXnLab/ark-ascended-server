import { platformCopy } from "../platform";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, PowerOff } from "lucide-react";
import type { ProvisionStage, ProvisionState, Status } from "../types";
import "../operation-progress.css";

export const STARTUP_TOTAL_STEPS = 10;

export interface StageProgress {
  step: number;
  percent: number;
  title: string;
  detail: string;
  variableDuration?: boolean;
}

export const PROVISION_PROGRESS: Record<Exclude<ProvisionStage, "idle" | "online" | "error">, StageProgress> = {
  checking: {
    step: 3,
    percent: 26,
    title: "Preparo la configurazione",
    detail: "Controllo il profilo selezionato e le operazioni rimaste in coda.",
  },
  stopping: {
    step: 4,
    percent: 34,
    title: "Chiudo la sessione precedente",
    detail: "Salvo il mondo e arresto Proton prima di modificare file e contenuti.",
  },
  "checking-updates": {
    step: 5,
    percent: 43,
    title: "Confronto le versioni",
    detail: "Verifico ASA, mappe ufficiali e manifesti delle mod richieste.",
  },
  "updating-game": {
    step: 6,
    percent: 56,
    title: "Verifico ASA e le mappe",
    detail: "SteamCMD certifica i file e scarica soltanto gli aggiornamenti necessari.",
    variableDuration: true,
  },
  "applying-settings": {
    step: 7,
    percent: 68,
    title: "Applico le impostazioni",
    detail: "Scrivo il profilo selezionato e gli argomenti di avvio in modo sostitutivo.",
  },
  "restoring-save": {
    step: 8,
    percent: 76,
    title: "Ripristino il salvataggio",
    detail: "Recupero la partita scelta prima di avviare il processo di gioco.",
    variableDuration: true,
  },
  "updating-mods": {
    step: 8,
    percent: 79,
    title: "Aggiorno mod e mod-map",
    detail: "ASA scarica, estrae e monta i contenuti CurseForge necessari.",
    variableDuration: true,
  },
  starting: {
    step: 9,
    percent: 87,
    title: "Avvio ARK",
    detail: "Proton ha ricevuto il profilo e sta avviando il processo del game server.",
  },
  "waiting-online": {
    step: 9,
    percent: 94,
    title: "Attendo la conferma RCON",
    detail: "Il processo è avviato: completo il controllo quando ARK risponde davvero online.",
    variableDuration: true,
  },
};

export interface OperationProgressState extends StageProgress {
  kind: "starting" | "stopping" | "online" | "error";
  totalSteps: number;
  elapsed: string | null;
  error?: string;
}

function elapsedSince(startedAt: string | null, updatedAt?: string): string | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = updatedAt ? Date.parse(updatedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes} min ${remainder} sec` : `${remainder} sec`;
}

/**
 * Converte esclusivamente segnali osservabili (OCI, agent e RCON) in una stima
 * per fasi. Non finge una percentuale byte-per-byte: SteamCMD e l'updater mod
 * interno ad ASA non espongono sempre un avanzamento misurabile.
 */
export function deriveOperationProgress(
  status: Status,
  provision: ProvisionState | null,
): OperationProgressState | null {
  const copy = platformCopy(status.platform?.provider);
  const elapsed = provision?.startedAt
    ? elapsedSince(
        provision.startedAt,
        provision.stage === "online" || provision.stage === "error" ? provision.updatedAt : undefined,
      )
    : status.powerStart.requestedAt
      ? elapsedSince(status.powerStart.requestedAt)
      : null;

  if (status.powerStart.pending) {
    return {
      kind: "starting",
      step: 1,
      totalSteps: STARTUP_TOTAL_STEPS,
      percent: 4,
      title: "Richiesta di accensione in coda",
      detail: `${copy.queued}${status.powerStart.attempt > 0 ? ` (tentativo ${status.powerStart.attempt})` : ""}.`,
      variableDuration: true,
      elapsed,
    };
  }

  if (status.instance.state === "STARTING" || status.instance.state === "PROVISIONING") {
    return {
      kind: "starting",
      step: 2,
      totalSteps: STARTUP_TOTAL_STEPS,
      percent: 14,
      title: "Avvio l'istanza di gioco",
      detail: copy.startingDetail,
      variableDuration: true,
      elapsed,
    };
  }

  if (status.shutdown.inProgress && status.instance.state === "RUNNING") {
    return {
      kind: "stopping",
      step: 1,
      totalSteps: 2,
      percent: 35,
      title: status.shutdown.reason === "watchdog" ? "Spegnimento di sicurezza" : "Salvataggio e backup",
      detail: status.shutdown.reason === "watchdog"
        ? copy.shutdownWatchdog
        : copy.shutdownBackup,
      variableDuration: true,
      elapsed: status.shutdown.startedAt ? elapsedSince(status.shutdown.startedAt) : elapsed,
    };
  }

  if (status.instance.state === "STOPPING") {
    return {
      kind: "stopping",
      step: 2,
      totalSteps: 2,
      percent: 72,
      title: "Arresto sicuro in corso",
      detail: copy.stopping,
      variableDuration: true,
      elapsed,
    };
  }

  if (provision?.stage === "error") {
    return {
      kind: "error",
      step: 0,
      totalSteps: STARTUP_TOTAL_STEPS,
      percent: 0,
      title: "Avvio non completato",
      detail: "Il flusso si è fermato prima della conferma online.",
      elapsed,
      error: provision.error,
    };
  }

  if (provision && provision.stage !== "idle" && provision.stage !== "online") {
    return {
      kind: "starting",
      totalSteps: STARTUP_TOTAL_STEPS,
      elapsed,
      ...PROVISION_PROGRESS[provision.stage],
    };
  }

  if (status.instance.state === "RUNNING" && status.ark?.online) {
    return {
      kind: "online",
      step: STARTUP_TOTAL_STEPS,
      totalSteps: STARTUP_TOTAL_STEPS,
      percent: 100,
      title: "Server online",
      detail: "RCON ha confermato che ARK è pronto ad accettare i giocatori.",
      elapsed,
    };
  }

  if (status.instance.state === "RUNNING") {
    return {
      kind: "starting",
      step: 3,
      totalSteps: STARTUP_TOTAL_STEPS,
      percent: 22,
      title: "Connetto il server-agent",
      detail: copy.connectedDetail,
      variableDuration: true,
      elapsed,
    };
  }

  return null;
}

export function OperationProgress({ status, provision }: { status: Status; provision: ProvisionState | null }) {
  const progress = deriveOperationProgress(status, provision);
  if (!progress) return null;

  const completed = progress.kind === "online"
    ? progress.totalSteps
    : Math.max(0, progress.step - 1);
  const remaining = Math.max(0, progress.totalSteps - progress.step);
  const Icon = progress.kind === "error"
    ? AlertTriangle
    : progress.kind === "online"
      ? CheckCircle2
      : progress.kind === "stopping"
        ? PowerOff
        : Loader2;

  return (
    <section
      className={`operation-progress operation-progress-${progress.kind}`}
      aria-live={progress.kind === "error" ? "assertive" : "polite"}
      aria-label={progress.title}
    >
      <div className="operation-progress-heading">
        <span className="operation-progress-icon" aria-hidden="true">
          <Icon size={18} className={progress.kind === "starting" ? "spin-soft" : undefined} />
        </span>
        <span className="operation-progress-title">
          <strong>{progress.title}</strong>
          <small>{progress.detail}</small>
        </span>
        <strong className="operation-progress-percent">{progress.percent}%</strong>
      </div>

      <div
        className="operation-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={`Passaggio ${progress.step} di ${progress.totalSteps}`}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>

      <div className="operation-progress-meta">
        {progress.kind === "error" ? (
          <span>Operazione interrotta prima della conferma online</span>
        ) : (
          <>
            <span>
              Passaggio <b>{progress.step}</b> di <b>{progress.totalSteps}</b>
            </span>
            <span>{completed} completati · {remaining} rimanenti</span>
          </>
        )}
        {progress.elapsed && (
          <span><Clock3 size={12} aria-hidden="true" /> {progress.elapsed}</span>
        )}
      </div>

      {progress.error && <p className="operation-progress-error">{progress.error}</p>}
      {progress.variableDuration && (
        <p className="operation-progress-note">
          {platformCopy(status.platform?.provider).variableNote}
        </p>
      )}
    </section>
  );
}
