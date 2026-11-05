import { useEffect, useState } from "react";
import { ListChecks, Puzzle, Trash2, Info, AlertCircle, HardDriveDownload } from "lucide-react";
import { api } from "../api";
import type { ModSearchResult } from "../types";

const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" });

export function InstalledMods({ ids, onRemove, onInspect, sharedModIds }: {
  ids: number[];
  onRemove: (id: number) => void;
  onInspect: (id: number) => void;
  /** ModID già presenti nella libreria condivisa (scaricati almeno una volta): mostra un badge "già scaricata". */
  sharedModIds?: Set<number>;
}) {
  const [byId, setById] = useState<Map<number, ModSearchResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) { setById(new Map()); return; }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api.modsBulk(ids)
      .then((items) => { if (!cancelled) setById(new Map(items.map((m) => [m.id, m]))); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  if (ids.length === 0) return null;

  return (
    <section className="card">
      <h2>
        <ListChecks size={16} />
        Mod della configurazione
      </h2>
      <p className="muted small" style={{ marginBottom: "16px" }}>
        <Info size={12} style={{ verticalAlign: "-1px" }} /> Elenco delle mod scelte per questa
        configurazione: si aggiornano automaticamente alla versione più recente ad ogni riavvio del
        server, non serve un'azione separata. "Già scaricata" indica che quel ModID è presente sul
        disco del game server (visibile solo a server acceso). Per rimuoverne una basta togliere il
        suo ModID dall'elenco.
      </p>

      {err && (
        <div className="banner banner-error mt-8">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{err}</span>
        </div>
      )}

      <div className="mod-catalog-list">
        {loading && byId.size === 0 && <p className="muted small">Caricamento…</p>}
        {ids.map((id) => {
          const m = byId.get(id);
          return (
            <div className="mod-catalog-item" key={id}>
              {m?.thumbnailUrl ? (
                <img src={m.thumbnailUrl} alt="" className="mod-catalog-thumb" />
              ) : (
                <div className="mod-catalog-thumb mod-catalog-thumb-empty">
                  <Puzzle size={20} />
                </div>
              )}
              <div className="mod-catalog-info">
                <div className="mod-catalog-title">
                  <button type="button" className="link-btn" onClick={() => onInspect(id)}>
                    {m?.name ?? `ModID ${id}`}
                  </button>
                </div>
                <div className="mod-catalog-meta muted small">
                  <span className="mono">{id}</span>
                  {m?.dateModified && <span>Agg. {dateFmt.format(new Date(m.dateModified))}</span>}
                  {sharedModIds?.has(id) && (
                    <span className="mod-shared-badge" title="Già scaricata sul game server, condivisa tra le configurazioni">
                      <HardDriveDownload size={11} /> già scaricata
                    </span>
                  )}
                </div>
              </div>
              <button type="button" className="btn-copy" title="Rimuovi dall'elenco" onClick={() => onRemove(id)}>
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
