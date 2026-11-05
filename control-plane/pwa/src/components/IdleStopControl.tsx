import { platformCopy } from "../platform";
import { useEffect, useState } from "react";
import { Timer, Clock, Save, Lock, AlertTriangle, Info } from "lucide-react";
import { api } from "../api";
import type { Status } from "../types";

/** Timer auto-stop nella card Alimentazione: il valore è persistito sul control plane,
 * quindi si può leggere e cambiare anche a server spento. */
export function IdleStopControl({ status, canTimer, onChange }: {
  status: Status;
  canTimer: boolean;
  onChange: () => Promise<void>;
}) {
  const saved = status.timer.idleStopMinutes;
  const [minutes, setMinutes] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setMinutes(saved); }, [saved]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.setTimer(minutes);
      await onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const running = status.instance.state === "RUNNING";
  const emptyMin = Math.round(status.timer.emptySinceSec / 60);

  return (
    <div className="idle-stop mt-16">
      <h3 className="row-center" style={{ gap: "8px", fontSize: "14px" }}>
        <Timer size={15} /> Auto-stop su inattività
      </h3>
      <p className="muted small row-center mt-8">
        <Info size={14} />
        <span>
          Spegne il server se resta senza giocatori per il tempo scelto (off = mai). Vale anche per le
          prossime accensioni. Indipendentemente dal timer, se ARK non risulta online per {status.timer.offlineWatchdogMinutes} minuti
          {platformCopy(status.platform?.provider).idleSafety}
        </span>
      </p>

      {!canTimer && (
        <div className="banner banner-error mt-8">
          <Lock size={16} />
          <span>Timer modificabile solo con il permesso dell'amministratore.</span>
        </div>
      )}
      {err && (
        <div className="banner banner-error mt-8">
          <AlertTriangle size={16} />
          <span>{err}</span>
        </div>
      )}

      <div className="slider-row">
        <Clock size={20} className="muted" />
        <input
          type="range"
          min={0}
          max={120}
          step={5}
          value={minutes}
          disabled={!canTimer || busy}
          aria-label="Minuti di inattività prima dello spegnimento"
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
        <b>{minutes === 0 ? "off" : `${minutes} min`}</b>
      </div>

      {canTimer && minutes !== saved && (
        <button className="btn w-full" disabled={busy} onClick={() => void save()}>
          <Save size={16} />
          <span>{busy ? "Salvataggio…" : "Salva timer"}</span>
        </button>
      )}

      {running && status.timer.synced === false && (
        <p className="muted small mt-8">Valore salvato: il game server lo riceverà entro pochi secondi.</p>
      )}
      {running && saved > 0 && status.timer.emptySinceSec > 0 && (
        <div className="banner banner-info mt-8">
          <Clock size={16} />
          <span>
            Server vuoto da {emptyMin} min: spegnimento tra circa {Math.max(0, saved - emptyMin)} min.
          </span>
        </div>
      )}
    </div>
  );
}
