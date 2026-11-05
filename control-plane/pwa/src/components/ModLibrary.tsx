import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Archive, HardDrive, AlertCircle, AlertTriangle, Info, Trash2, Puzzle,
} from "lucide-react";
import { api } from "../api";
import type { InstalledMod, ModSearchResult, GameConfiguration } from "../types";

const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" });

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
 * Libreria delle mod realmente presenti sul disco del game server, condivise da tutte
 * le configurazioni che le referenziano (scaricate una sola volta, mai duplicate).
 * Indipendente da qualunque singola configurazione: mostra spazio occupato e permette
 * di disinstallare le mod non più usate da nessuna configurazione salvata.
 */
export function ModLibrary({ onClose }: { onClose: () => void }) {
  const [available, setAvailable] = useState(true);
  const [instanceRunning, setInstanceRunning] = useState(false);
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [byId, setById] = useState<Map<number, ModSearchResult>>(new Map());
  const [configNames, setConfigNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [lib, configs] = await Promise.all([api.modLibrary.list(), api.configs.list()]);
      setAvailable(lib.available);
      setInstanceRunning(lib.instanceState === "RUNNING");
      setMods(lib.mods);
      setConfigNames(new Map(configs.map((c: GameConfiguration) => [c.id, c.name])));
      // Arricchimento dal catalogo isolato: interroghiamo solo gli ID noti a CurseForge
      // (gli altri sono ID interni al gioco e darebbero 400) e un suo eventuale errore
      // non deve svuotare la lista base già mostrata.
      const known = lib.mods.filter((m) => m.isCatalogKnown);
      try {
        if (known.length > 0) {
          const details = await api.modsBulk(known.map((m) => m.id));
          setById(new Map(details.map((m) => [m.id, m])));
        } else {
          setById(new Map());
        }
      } catch (e) {
        setById(new Map());
        setErr(e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function uninstall(id: number) {
    if (!window.confirm(`Disinstallare la mod ${id} dal disco del game server?`)) return;
    setBusyId(id); setErr(null);
    try {
      await api.modLibrary.uninstall(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid">
      <div className="row-center" style={{ gap: "10px" }}>
        <button className="btn-secondary" onClick={onClose}>
          <ArrowLeft size={16} /> Indietro
        </button>
      </div>

      <section className="card">
        <h2>
          <Archive size={16} /> Libreria mod installate
        </h2>
        <p className="muted small mt-8" style={{ marginBottom: "16px" }}>
          <Info size={12} style={{ verticalAlign: "-1px" }} /> Ogni mod viene scaricata una sola
          volta sul game server e condivisa tra tutte le configurazioni che la usano: qui puoi
          vedere quanto spazio occupa ciascuna e disinstallare quelle non più usate da nessuna
          configurazione salvata.
        </p>

        {!available && (
          <div className="banner banner-info mt-8">
            <Info size={16} />
            <span>
              {instanceRunning
                ? "Il game server si sta ancora avviando: spazio occupato e data di installazione saranno visibili appena risponde."
                : "Accendi il server per vedere spazio occupato e data di installazione reali."}
              {" "}Qui sotto le mod referenziate dalle configurazioni salvate.
            </span>
          </div>
        )}

        {err && (
          <div className="banner banner-error mt-8">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{err}</span>
          </div>
        )}

        {loading && mods.length === 0 && (
          <div className="stack-8 mt-8">
            <div className="skeleton skeleton-line w-60" />
            <div className="skeleton skeleton-line w-40" />
          </div>
        )}

        {!loading && mods.length === 0 && !err && (
          <p className="muted small mt-8">Nessuna mod installata o referenziata da configurazioni.</p>
        )}

        <div className="mt-8">
          {mods.map((m) => {
            const detail = byId.get(m.id);
            const usedBy = m.usedByConfigIds.map((id) => configNames.get(id) ?? id).filter(Boolean);
            const canUninstall = available && usedBy.length === 0;
            return (
              <div className="mod-library-item" key={m.id}>
                {detail?.thumbnailUrl ? (
                  <img src={detail.thumbnailUrl} alt="" className="mod-catalog-thumb" />
                ) : (
                  <div className="mod-catalog-thumb mod-catalog-thumb-empty">
                    <Puzzle size={20} />
                  </div>
                )}
                <div className="mod-library-info">
                  <div className="mod-catalog-title">{detail?.name ?? `ModID ${m.id}`}</div>
                  <div className="mod-catalog-meta muted small">
                    <span className="mono">{m.id}</span>
                    <span><HardDrive size={11} style={{ verticalAlign: "-1px" }} /> {fmtBytes(m.sizeBytes)}</span>
                    {m.installedAt && <span>Installata {dateFmt.format(new Date(m.installedAt))}</span>}
                  </div>
                  <div className="mod-library-usedby">
                    {!m.isCatalogKnown ? (
                      <span className="mod-library-unused small">componente non riconosciuto</span>
                    ) : usedBy.length > 0 ? (
                      usedBy.map((n, i) => <span className="mod-library-usedby-pill" key={i}>{n}</span>)
                    ) : (
                      <span className="mod-library-unused small">non usata da nessuna configurazione</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-copy"
                  disabled={!canUninstall || busyId === m.id}
                  title={
                    !available
                      ? "Accendi il server per disinstallare mod"
                      : usedBy.length > 0
                        ? `Rimuovila prima dalle configurazioni che la usano: ${usedBy.join(", ")}`
                        : "Disinstalla dal game server"
                  }
                  onClick={() => uninstall(m.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>

        {!available && mods.some((m) => m.usedByConfigIds.length === 0) && (
          <div className="banner banner-info mt-12">
            <AlertTriangle size={16} />
            <span>La disinstallazione richiede il server acceso e raggiungibile (serve accedere al disco).</span>
          </div>
        )}
      </section>
    </div>
  );
}
