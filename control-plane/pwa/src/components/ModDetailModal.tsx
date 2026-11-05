import { useEffect, useState } from "react";
import { X, ExternalLink, Download, Plus, Check, AlertCircle, Puzzle } from "lucide-react";
import { api } from "../api";
import type { ModDetail, ModCategory } from "../types";
import { sanitizeModHtml } from "../sanitizeModHtml";

const modCountFmt = new Intl.NumberFormat("it-IT", { notation: "compact" });
const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" });

export function ModDetailModal({
  modId, added, categories, onClose, onAdd,
}: {
  modId: number;
  added: boolean;
  categories: ModCategory[];
  onClose: () => void;
  /** Assente in sola lettura: il pulsante di aggiunta non viene mostrato. */
  onAdd?: (id: number) => void;
}) {
  const [detail, setDetail] = useState<ModDetail | null>(null);
  const [descriptionHtml, setDescriptionHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setDetail(null);
    setDescriptionHtml(null);
    Promise.all([api.modDetail(modId), api.modDescription(modId)])
      .then(([d, desc]) => {
        if (cancelled) return;
        setDetail(d);
        setDescriptionHtml(desc.html);
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const categoryNames = detail
    ? detail.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n)
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Dettaglio mod" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Chiudi" aria-label="Chiudi dettaglio mod" autoFocus>
          <X size={18} />
        </button>

        {loading && <p className="muted small" style={{ padding: "24px" }}>Caricamento…</p>}

        {err && (
          <div className="banner banner-error" style={{ margin: "24px" }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{err}</span>
          </div>
        )}

        {detail && (
          <>
            <div className="mod-detail-head">
              {detail.thumbnailUrl ? (
                <img src={detail.thumbnailUrl} alt="" className="mod-detail-thumb" />
              ) : (
                <div className="mod-detail-thumb mod-catalog-thumb-empty">
                  <Puzzle size={28} />
                </div>
              )}
              <div>
                <h2 style={{ marginBottom: 4 }}>{detail.name}</h2>
                <div className="mod-catalog-meta muted small">
                  <span><Download size={12} /> {modCountFmt.format(detail.downloadCount)}</span>
                  {detail.authors[0] && <span>{detail.authors[0]}</span>}
                  <span className="mono">{detail.id}</span>
                  {detail.dateModified && <span>Agg. {dateFmt.format(new Date(detail.dateModified))}</span>}
                </div>
                {categoryNames.length > 0 && (
                  <div className="mod-detail-categories mt-8">
                    {categoryNames.map((n) => <span className="pill" key={n}>{n}</span>)}
                  </div>
                )}
              </div>
            </div>

            {detail.screenshots.length > 0 && (
              <div className="mod-detail-screenshots mt-16">
                {detail.screenshots.map((s) => (
                  <a href={s.url} target="_blank" rel="noreferrer" key={s.id} title={s.title}>
                    <img src={s.thumbnailUrl} alt={s.title} />
                  </a>
                ))}
              </div>
            )}

            {descriptionHtml && (
              <div
                className="mod-detail-description mt-16"
                dangerouslySetInnerHTML={{ __html: sanitizeModHtml(descriptionHtml) }}
              />
            )}

            <div className="mod-detail-actions mt-16">
              <a className="btn btn-secondary" href={detail.websiteUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Apri su CurseForge
              </a>
              {onAdd && (
                <button type="button" className="btn" disabled={added} onClick={() => onAdd(detail.id)}>
                  {added ? <Check size={16} /> : <Plus size={16} />}
                  {added ? "Già nell'elenco" : "Aggiungi all'elenco mod"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
