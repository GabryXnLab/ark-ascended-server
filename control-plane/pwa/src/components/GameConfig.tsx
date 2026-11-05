import { useCallback, useEffect, useState } from "react";
import {
  Layers, Plus, Pencil, Trash2, Lock, AlertTriangle, CheckCircle, Puzzle, User, ShieldCheck, Eye, Gauge,
} from "lucide-react";
import { api } from "../api";
import type { Me, GameConfiguration, Status } from "../types";
import { ConfigEditor } from "./ConfigEditor";
import { missingConfigFieldLabels } from "../configValidation";

const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function GameConfig({ status, me, onChange, onEditingChange, onGoToStatus }: {
  status: Status | null;
  me: Me | null;
  onChange: () => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
  onGoToStatus: () => void;
}) {
  const [configs, setConfigs] = useState<GameConfiguration[]>([]);
  const [editing, setEditingState] = useState<GameConfiguration | "new" | null>(null);
  const setEditing = useCallback(
    (value: GameConfiguration | "new" | null) => {
      setEditingState(value);
      onEditingChange?.(value !== null);
    },
    [onEditingChange],
  );
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [savedRunningId, setSavedRunningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canCreate = me !== null;
  const canApplyConfig = me?.role !== "friend" || me.permissions.applyConfig;

  const load = useCallback(async () => {
    try {
      const list = await api.configs.list();
      setConfigs(list);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  // Se il componente viene smontato mentre si è in editing (es. tap su un'altra
  // tab della bottom bar), niente reset esplicito verrebbe altrimenti eseguito:
  // senza questo cleanup lo swipe resterebbe bloccato anche sulle altre tab.
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);

  useEffect(() => { void load(); }, [load]);

  const activeId = status?.ark?.online ? status.configuration.activeId : null;

  async function remove(configuration: GameConfiguration) {
    if (!window.confirm(`Eliminare definitivamente la configurazione “${configuration.name || "(senza nome)"}”? Le partite salvate restano nella libreria.`)) return;
    setBusy(true); setErr(null); setMsg(null); setSavedRunningId(null);
    try {
      await api.configs.remove(configuration.id);
      await load();
    }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function afterSave(configId: string | null) {
    setEditing(null);
    // Salvare non tocca il server: se è il profilo in esecuzione va riavviato da Stato.
    const running = !!configId && !!status?.ark?.online && configId === status.configuration.activeId;
    setSavedRunningId(running ? configId : null);
    setMsg(running
      ? "Configurazione salvata. È quella in esecuzione: il server usa ancora la versione precedente finché non riavvii il gioco dalla tab Stato."
      : "Configurazione salvata.");
    await load();
    await onChange();
  }

  if (editing !== null) {
    return (
      <ConfigEditor
        configs={configs}
        editing={editing === "new" ? null : editing}
        isAdmin={me?.role === "admin"}
        currentUserId={me?.id ?? ""}
        onSaved={afterSave}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="grid">
      {err && (
        <div className="banner banner-error">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <span>{err}</span>
        </div>
      )}
      {msg && (
        <div className="banner banner-ok" style={{ flexWrap: "wrap" }}>
          <CheckCircle size={18} style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 190px" }}>{msg}</span>
          {savedRunningId && canApplyConfig && (
            <button className="btn" onClick={onGoToStatus}>
              <Gauge size={15} /> Vai a Stato
            </button>
          )}
        </div>
      )}

      <section className="card">
        <h2><Layers size={16} /> Configurazioni</h2>
        <p className="muted small mt-8" style={{ marginBottom: "16px" }}>
          Ogni configurazione raggruppa mappa, mod e parametri giocatore in un pacchetto
          caricabile. Più configurazioni possono usare la stessa mappa con mod o
          impostazioni diverse. Salvare non riavvia il server: per scegliere quale configurazione
          parte al prossimo avvio, o per riavviare il gioco con le modifiche, vai nella tab "Stato".
        </p>
        <p className="muted small row-center mt-8">
          <ShieldCheck size={14} /> Ogni membro può creare un profilo proprio; i permessi si gestiscono dentro l'editor di ogni configurazione.
        </p>
        <div className="row-center mt-16" style={{ gap: "8px" }}>
          <button className="btn w-full" disabled={!canCreate} onClick={() => setEditing("new")}>
            <Plus size={16} /> Nuova configurazione
          </button>
        </div>
      </section>

      {configs.length === 0 && (
        <p className="muted small">Nessuna configurazione salvata.</p>
      )}

      {configs.map((c) => {
        const missingLabels = missingConfigFieldLabels(c);
        const protectedConfig = c.id === status?.configuration.activeId || c.id === status?.configuration.desiredId;
        return (
        <section className="card" key={c.id}>
          <h2>
            <Puzzle size={16} /> {c.name || "(senza nome)"}
            {activeId === c.id && <span className="pill pill-RUNNING">attiva</span>}
            {missingLabels && <span className="pill pill-STARTING">incompleta</span>}
          </h2>
          <div className="muted small mt-8">
            {c.map || "(mappa non impostata)"} · mod: {c.mods.join(", ") || "—"}
          </div>
          {missingLabels && (
            <p className="muted small row-center mt-8">
              <AlertTriangle size={13} /> Campi obbligatori mancanti: {missingLabels}. Non può essere applicata al server finché non sono compilati.
            </p>
          )}
          <div className="muted small mt-8 row-center">
            <User size={13} /> {c.ownerName}
            {c.lastAppliedAt && ` · ultima applicazione ${dateFmt.format(new Date(c.lastAppliedAt))}`}
          </div>
          <div className="config-access-summary mt-8">
            {c.capabilities.isOwner && <span className="pill">tua</span>}
            {c.accessControl.administratorLocked && <span className="pill pill-STOPPING"><Lock size={11} /> protetta</span>}
            {c.capabilities.access === "review" && <span className="pill pill-STARTING">con revisione</span>}
            {c.capabilities.access === "full" && !c.capabilities.isOwner && me?.role !== "admin" && (
              <span className="pill pill-RUNNING">modifica completa</span>
            )}
          </div>

          <div className="row-center mt-16" style={{ gap: "8px" }}>
            <button
              className="btn-secondary"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => setEditing(c)}
              title={c.capabilities.access === "none" ? "Il proprietario o un amministratore non ti ha concesso la modifica" : undefined}
            >
              {c.capabilities.access === "none" ? <Eye size={16} /> : <Pencil size={16} />}
              {c.capabilities.access === "none" ? "Consulta" : "Modifica"}
            </button>
            {c.capabilities.canDelete && (
              <button
                className="btn-secondary"
                disabled={busy || protectedConfig}
                onClick={() => remove(c)}
                title={protectedConfig ? "Passa prima a un'altra configurazione" : "Elimina"}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </section>
        );
      })}
    </div>
  );
}
