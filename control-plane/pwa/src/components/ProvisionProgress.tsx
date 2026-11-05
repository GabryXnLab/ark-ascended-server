import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { ProvisionState } from "../types";
import { PROVISION_PROGRESS, STARTUP_TOTAL_STEPS } from "./OperationProgress";

const STAGE_LABELS: Record<ProvisionState["stage"], string> = {
  idle: "",
  checking: "Verifica configurazione…",
  stopping: "Arresto della configurazione precedente…",
  "checking-updates": "Controllo versioni di gioco, mappe e mod…",
  "updating-game": "Controllo e aggiornamento ASA/mappe ufficiali con SteamCMD…",
  "applying-settings": "Applicazione impostazioni di gioco…",
  "updating-mods": "Aggiornamento mod e mod-map tramite CurseForge…",
  "restoring-save": "Ripristino della partita salvata…",
  starting: "Avvio del server…",
  "waiting-online": "In attesa che il server vada online (può richiedere qualche minuto se scarica una mod-map)…",
  online: "Server online.",
  error: "Provisioning non riuscito.",
};

function elapsedLabel(startedAt: string | null, updatedAt: string, completed: boolean): string {
  if (!startedAt) return "";
  const end = completed ? new Date(updatedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Pannello compatto usato dai ripristini. La percentuale misura i passaggi
 * osservabili, non i byte: l'updater mod interno ad ASA non espone un progresso
 * di download affidabile.
 */
export function ProvisionProgress({ state }: { state: ProvisionState }) {
  if (state.stage === "idle") return null;

  const isError = state.stage === "error";
  const isOnline = state.stage === "online";
  const stageProgress = state.stage !== "error" && state.stage !== "online"
    ? PROVISION_PROGRESS[state.stage]
    : null;
  const percent = isError ? 0 : isOnline ? 100 : stageProgress?.percent ?? 0;
  const step = isOnline ? STARTUP_TOTAL_STEPS : stageProgress?.step ?? 0;
  const completed = isOnline ? STARTUP_TOTAL_STEPS : Math.max(0, step - 1);
  const remaining = Math.max(0, STARTUP_TOTAL_STEPS - step);

  return (
    <div className={`operation-progress operation-progress-${isError ? "error" : isOnline ? "online" : "starting"}`}>
      <div className="operation-progress-heading">
        <span className="operation-progress-icon" aria-hidden="true">
          {isError ? <AlertTriangle size={18} /> : isOnline ? <CheckCircle2 size={18} /> : <Loader2 size={18} className="spin-soft" />}
        </span>
        <span className="operation-progress-title">
          <strong>{STAGE_LABELS[state.stage]}</strong>
          <small>{isError ? state.error ?? "Controlla il dettaglio e riprova." : stageProgress?.detail ?? "RCON ha confermato il server online."}</small>
        </span>
        <strong className="operation-progress-percent">{percent}%</strong>
      </div>

      <div
        className="operation-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={isError ? "Operazione interrotta" : `Passaggio ${step} di ${STARTUP_TOTAL_STEPS}`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="operation-progress-meta">
        {!isError && <span>Passaggio <b>{step}</b> di <b>{STARTUP_TOTAL_STEPS}</b></span>}
        {!isError && <span>{completed} completati · {remaining} rimanenti</span>}
        {state.startedAt && (
          <span><Clock3 size={12} aria-hidden="true" /> {elapsedLabel(state.startedAt, state.updatedAt, isOnline || isError)}</span>
        )}
      </div>
      {stageProgress?.variableDuration && (
        <p className="operation-progress-note">Stima per fasi: aggiornamenti e mod possono rendere questo passaggio più lungo.</p>
      )}
    </div>
  );
}

/** Poll leggero dello stato di provisioning, attivo solo mentre il server è acceso. */
export function useProvisionStatus(
  isOn: boolean,
  fetchStatus: () => Promise<ProvisionState>,
): ProvisionState | null {
  const [state, setState] = useState<ProvisionState | null>(null);

  useEffect(() => {
    if (!isOn) {
      setState(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      fetchStatus()
        .then((s) => { if (!cancelled) setState(s); })
        .catch(() => { /* agent non ancora raggiungibile, es. subito dopo il boot */ });
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isOn, fetchStatus]);

  return state;
}
