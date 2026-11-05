import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Save, AlertCircle, Info, Trash2, RotateCcw, HardDrive, DownloadCloud,
} from "lucide-react";
import { api } from "../api";
import type { Savegame } from "../types";
import { ProvisionProgress, useProvisionStatus } from "./ProvisionProgress";

const dateFmt = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Libreria delle partite salvate: una copia per configurazione su Object Storage,
 * indipendente dalle configurazioni (una partita sopravvive alla cancellazione della
 * sua config). Ripristino e backup passano dal game server (istanza accesa);
 * l'eliminazione è pura Object Storage e non richiede il server acceso.
 */
export function SavegamesLibrary({ onClose }: { onClose: () => void }) {
  const [saves, setSaves] = useState<Savegame[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [isOn, setIsOn] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const provision = useProvisionStatus(isOn, api.provisionStatus);
  const provisionBusy = !!provision
    && provision.stage !== "idle" && provision.stage !== "online" && provision.stage !== "error";

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [list, status] = await Promise.all([api.savegames.list(), api.status()]);
      setSaves(list);
      setIsOn(status.instance.state === "RUNNING" && !status.shutdown.inProgress);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Lo stato di accensione cambia anche mentre la schermata resta aperta.
  useEffect(() => {
    const id = setInterval(() => {
      api.status()
        .then((status) => setIsOn(status.instance.state === "RUNNING" && !status.shutdown.inProgress))
        .catch(() => { /* il prossimo tick ritenta */ });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (restoring && (provision?.stage === "online" || provision?.stage === "error")) setRestoring(false);
  }, [restoring, provision?.stage]);

  async function restore(id: string) {
    if (!window.confirm("Ripristinare questa partita salvata? La sua configurazione diventa quella attiva: ARK viene riavviato con questo salvataggio e i giocatori online vengono disconnessi.")) return;
    setBusyId(id); setErr(null); setRestoring(true);
    try {
      await api.savegames.restore(id);
      // Il provisioning gira in background sull'agent: l'avanzamento appare qui sotto.
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRestoring(false);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Eliminare definitivamente questa partita salvata? L'operazione non è reversibile.")) return;
    setBusyId(id); setErr(null);
    try {
      await api.savegames.remove(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function backupNow() {
    setBackingUp(true); setErr(null);
    try {
      await api.savegames.backup();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <div className="grid">
      <div className="row-center" style={{ gap: "10px" }}>
        <button className="btn-secondary" onClick={onClose}>
          <ArrowLeft size={16} /> Indietro
        </button>
        <button className="btn-secondary" onClick={backupNow} disabled={!isOn || backingUp}
          title={isOn ? "Esegui subito un backup della partita attiva" : "Accendi il server per fare un backup"}>
          <DownloadCloud size={16} /> {backingUp ? "Backup in corso…" : "Backup ora"}
        </button>
      </div>

      <section className="card">
        <h2>
          <Save size={16} /> Partite salvate
        </h2>
        <p className="muted small mt-8" style={{ marginBottom: "16px" }}>
          <Info size={12} style={{ verticalAlign: "-1px" }} /> Una copia sempre aggiornata per ogni
          configurazione: il backup avviene automaticamente a ogni spegnimento (dalla PWA o per
          inattività) e sovrascrive la copia precedente. Ripristinare una partita richiede il server acceso.
        </p>

        {err && (
          <div className="banner banner-error mt-8">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{err}</span>
          </div>
        )}

        {provision && (restoring || provisionBusy) && <ProvisionProgress state={provision} />}

        {loading && saves.length === 0 && (
          <div className="stack-8 mt-8">
            <div className="skeleton skeleton-line w-60" />
            <div className="skeleton skeleton-line w-40" />
          </div>
        )}

        {!loading && saves.length === 0 && !err && (
          <p className="muted small mt-8">Nessuna partita salvata: verrà creata al primo backup.</p>
        )}

        <div className="mt-8">
          {saves.map((s) => (
            <div className="mod-library-item" key={s.id}>
              <div className="mod-library-info">
                <div className="mod-catalog-title">
                  {s.configName}
                  {s.status === "backup-failed" && (
                    <span className="mod-library-usedby-pill" style={{ marginLeft: 8 }}>backup fallito</span>
                  )}
                  {!s.configId && (
                    <span className="mod-library-unused small" style={{ marginLeft: 8 }}>config eliminata</span>
                  )}
                </div>
                <div className="mod-catalog-meta muted small">
                  <span className="mono">{s.map}</span>
                  <span>{s.mods.length} mod</span>
                  <span><HardDrive size={11} style={{ verticalAlign: "-1px" }} /> {fmtBytes(s.sizeBytes)}</span>
                  {s.lastBackupAt && <span>Ultimo backup {dateFmt.format(new Date(s.lastBackupAt))}</span>}
                </div>
              </div>
              <button
                type="button"
                className="btn-copy"
                disabled={!isOn || busyId === s.id || restoring || provisionBusy}
                title={!isOn
                  ? "Accendi il server per ripristinare"
                  : provisionBusy ? "Attendi la fine dell'avvio in corso" : "Ripristina questa partita sul server"}
                onClick={() => restore(s.id)}
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                className="btn-copy"
                disabled={busyId === s.id}
                title="Elimina definitivamente questa partita salvata"
                onClick={() => remove(s.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
