import { useEffect, useMemo, useState } from "react";
import { Store, Search, AlertCircle, Puzzle, Plus, Check, Download, ExternalLink, HardDriveDownload } from "lucide-react";
import { api } from "../api";
import type { ModSearchResult, ModCategory, FeaturedMods } from "../types";

const modCountFmt = new Intl.NumberFormat("it-IT", { notation: "compact" });

function ModRow({ m, added, shared, onAdd, onInspect }: {
  m: ModSearchResult; added: boolean; shared: boolean; onAdd: (id: number) => void; onInspect: (id: number) => void;
}) {
  return (
    <div className="mod-catalog-item">
      <button type="button" className="mod-catalog-thumb-btn" onClick={() => onInspect(m.id)} title="Ispeziona">
        {m.thumbnailUrl ? (
          <img src={m.thumbnailUrl} alt="" className="mod-catalog-thumb" />
        ) : (
          <div className="mod-catalog-thumb mod-catalog-thumb-empty">
            <Puzzle size={20} />
          </div>
        )}
      </button>
      <div className="mod-catalog-info">
        <div className="mod-catalog-title">
          <button type="button" className="link-btn" onClick={() => onInspect(m.id)}>{m.name}</button>
          <a href={m.websiteUrl} target="_blank" rel="noreferrer" title="Apri su CurseForge">
            <ExternalLink size={13} />
          </a>
        </div>
        <p className="muted small mod-catalog-summary">{m.summary}</p>
        <div className="mod-catalog-meta muted small">
          <span><Download size={12} /> {modCountFmt.format(m.downloadCount)}</span>
          {m.authors[0] && <span>{m.authors[0]}</span>}
          <span className="mono">{m.id}</span>
          {shared && (
            <span className="mod-shared-badge" title="Già scaricata sul game server, condivisa tra le configurazioni">
              <HardDriveDownload size={11} /> già scaricata
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="btn-copy"
        disabled={added}
        title={added ? "Già nell'elenco" : "Aggiungi all'elenco mod"}
        onClick={() => onAdd(m.id)}
      >
        {added ? <Check size={16} /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function FeaturedRow({ title, items, onInspect }: { title: string; items: ModSearchResult[]; onInspect: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mod-featured-section">
      <h3 className="mod-featured-title">{title}</h3>
      <div className="mod-featured-row">
        {items.map((m) => (
          <button type="button" className="mod-featured-card" key={m.id} onClick={() => onInspect(m.id)}>
            {m.thumbnailUrl ? (
              <img src={m.thumbnailUrl} alt="" />
            ) : (
              <div className="mod-featured-card-img mod-catalog-thumb-empty">
                <Puzzle size={22} />
              </div>
            )}
            <span className="mod-featured-card-name">{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModsCatalog({
  activeModIds, onAdd, onInspect, categories, sharedModIds,
}: {
  activeModIds: Set<number>;
  onAdd: (id: number) => void;
  onInspect: (id: number) => void;
  categories: ModCategory[];
  /** ModID già presenti nella libreria condivisa (scaricati almeno una volta): mostra un badge "già scaricata". */
  sharedModIds?: Set<number>;
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [items, setItems] = useState<ModSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [featured, setFeatured] = useState<FeaturedMods | null>(null);
  const [featuredErr, setFeaturedErr] = useState<string | null>(null);
  const [featuredLoading, setFeaturedLoading] = useState(true);

  const browsing = query.trim().length > 0 || categoryId !== null;

  useEffect(() => {
    api.featuredMods()
      .then(setFeatured)
      .catch((e) => setFeaturedErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setFeaturedLoading(false));
  }, []);

  useEffect(() => {
    if (!browsing) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setErr(null);
      api.searchMods(query, 0, categoryId ?? undefined)
        .then((r) => { if (!cancelled) { setItems(r.items); setTotal(r.totalCount); } })
        .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [browsing, query, categoryId]);

  const topCategories = useMemo(() => categories.filter((c) => c.parentCategoryId === null || !categories.some((p) => p.id === c.parentCategoryId)), [categories]);

  return (
    <section className="card">
      <h2>
        <Store size={16} />
        Catalogo mod (CurseForge)
      </h2>
      <p className="muted small" style={{ marginBottom: "16px" }}>
        Sfoglia o cerca una mod ASA e aggiungila all'elenco. Viene scaricata al prossimo avvio del
        gioco con questa configurazione: salvala e, se è quella in esecuzione, riavvia il gioco dalla
        tab Stato.
      </p>

      <div className="search-field">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca una mod (es. Structures Plus, Astraeos…)"
        />
      </div>

      {topCategories.length > 0 && (
        <div className="mod-category-chips mt-8">
          <button
            type="button"
            className={`chip ${categoryId === null ? "chip-active" : ""}`}
            onClick={() => setCategoryId(null)}
          >
            Tutte
          </button>
          {topCategories.map((c) => (
            <button
              type="button"
              className={`chip ${categoryId === c.id ? "chip-active" : ""}`}
              key={c.id}
              onClick={() => setCategoryId((cur) => (cur === c.id ? null : c.id))}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="banner banner-error mt-8">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{err}</span>
        </div>
      )}

      {browsing ? (
        <div className="mod-catalog-list mt-8">
          {loading && <p className="muted small">Ricerca in corso…</p>}
          {!loading && !err && items.length === 0 && <p className="muted small">Nessuna mod trovata.</p>}
          {items.map((m) => (
            <ModRow
              key={m.id}
              m={m}
              added={activeModIds.has(m.id)}
              shared={sharedModIds?.has(m.id) ?? false}
              onAdd={onAdd}
              onInspect={onInspect}
            />
          ))}
          {total > items.length && (
            <p className="muted small mt-8">Mostrate {items.length} di {total} mod. Affina la ricerca per restringere.</p>
          )}
        </div>
      ) : (
        <div className="mt-8">
          {featuredLoading && <p className="muted small">Caricamento catalogo…</p>}
          {featuredErr && (
            <div className="banner banner-error">
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{featuredErr}</span>
            </div>
          )}
          {featured && (
            <>
              <FeaturedRow title="In evidenza" items={featured.featured} onInspect={onInspect} />
              <FeaturedRow title="Popolari" items={featured.popular} onInspect={onInspect} />
              <FeaturedRow title="Aggiornate di recente" items={featured.recentlyUpdated} onInspect={onInspect} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
