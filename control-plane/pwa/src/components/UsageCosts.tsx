import { useEffect, useState } from "react";
import { Coins, Clock, ChevronLeft, ChevronRight, Users, AlertTriangle, TrendingUp, Loader2, ListTree } from "lucide-react";
import { api } from "../api";
import type { Me, PlaytimeSummary, PlaytimeLogEntry } from "../types";
import { fmtUptime } from "./util";
import { TrendBars } from "./TrendBars";
import type { TrendBarDatum } from "./TrendBars";

const MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];
const MONTH_SHORT = [
  "Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
];
const TREND_MONTHS = 6;

function shiftMonth(base: Date, delta: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + delta, 1));
}

function toMonthParam(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function UsageCosts({ me, showCosts = true }: { me: Me | null; showCosts?: boolean }) {
  const isAdmin = me?.role === "admin";
  const [cursor, setCursor] = useState(() => new Date());
  const [summary, setSummary] = useState<PlaytimeSummary | null>(null);
  const [summaryMonth, setSummaryMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [trend, setTrend] = useState<PlaytimeSummary[] | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);

  const [log, setLog] = useState<PlaytimeLogEntry[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(isAdmin);

  // Il mese richiesto (non l'ultimo arrivato) è la fonte di verità per capire se il
  // "summary" attualmente in mano corrisponde davvero al cursore: durante il
  // caricamento teniamo in vista il dato precedente (a opacità ridotta, vedi
  // .cost-updating) invece di azzerarlo di colpo — ma se l'utente cambia mese più
  // volte in rapida successione, solo la risposta della richiesta ANCORA in corso
  // per il cursore corrente può aggiornare lo stato: `cancelled` scarta le altre.
  useEffect(() => {
    let cancelled = false;
    const month = toMonthParam(cursor);
    setLoading(true);
    setError(null);
    api.playtimeSummary(month)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSummaryMonth(month);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cursor]);

  // Log dettagliato entrata/uscita per sessione: solo admin (vedi requireAdmin lato backend
  // su GET /playtime/log), segue lo stesso cursore mese della card "Costo del mese".
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLogLoading(true);
    setLogError(null);
    api.playtimeLog(toMonthParam(cursor))
      .then((l) => { if (!cancelled) setLog(l.sessions); })
      .catch((e) => { if (!cancelled) setLogError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLogLoading(false); });
    return () => { cancelled = true; };
  }, [cursor, isAdmin]);

  // Trend ultimi ~6 mesi (mese corrente incluso): richieste in parallelo, aggregate
  // lato client — volume dati modesto, non serve un endpoint dedicato.
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(now, -(TREND_MONTHS - 1 - i)));
    Promise.all(months.map((m) => api.playtimeSummary(toMonthParam(m))))
      .then((results) => { if (!cancelled) setTrend(results); })
      .catch((e) => { if (!cancelled) setTrendError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const isCurrentMonth = toMonthParam(cursor) === toMonthParam(new Date());
  const monthLabel = `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`;
  const isStale = summary != null && summaryMonth !== toMonthParam(cursor);
  const showUpdatingOverlay = loading && summary != null;

  // getUTCMonth() è sempre 0-11: gli array dei nomi mese ne hanno 12, l'asserzione
  // non-null riflette questa invariante (noUncheckedIndexedAccess altrimenti
  // tipizzerebbe l'accesso come possibilmente undefined).
  const monthMeta = (month: string) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    return {
      label: MONTH_SHORT[d.getUTCMonth()]!,
      fullLabel: `${MONTH_NAMES[d.getUTCMonth()]!} ${d.getUTCFullYear()}`,
    };
  };
  const costData: TrendBarDatum[] | null = trend
    ? trend.map((s) => ({
        key: s.month,
        ...monthMeta(s.month),
        value: s.totalCost?.amount ?? 0,
        isCurrent: s.month === toMonthParam(new Date()),
      }))
    : null;
  const hoursData: TrendBarDatum[] | null = trend
    ? trend.map((s) => ({
        key: s.month,
        ...monthMeta(s.month),
        value: s.totalSeconds / 3600,
        isCurrent: s.month === toMonthParam(new Date()),
      }))
    : null;
  // I mesi senza voci di costo ricevono "USD" come valuta di ripiego dal backend:
  // la valuta reale è quella di un mese con importo.
  const currency = [...(trend ?? []), summary].reverse().find((s) => s?.totalCost && s.totalCost.amount > 0)?.totalCost?.currency
    ?? summary?.totalCost?.currency ?? "EUR";

  return (
    <div className="grid">
      <section className="card">
        <h2>
          {showCosts ? <Coins size={16} /> : <Clock size={16} />} {showCosts ? "Costo del mese" : "Tempo di gioco del mese"}
        </h2>
        <div className="month-nav">
          <button className="btn-copy" onClick={() => setCursor((c) => shiftMonth(c, -1))} title="Mese precedente">
            <ChevronLeft size={16} />
          </button>
          <b>{monthLabel}</b>
          <button
            className="btn-copy"
            onClick={() => setCursor((c) => shiftMonth(c, 1))}
            disabled={isCurrentMonth}
            title="Mese successivo"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {error && (
          <div className="banner banner-error mt-12">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        {loading && !summary && (
          <div className="stack-8">
            <div className="skeleton skeleton-line w-60" />
            <div className="skeleton skeleton-line w-40" />
          </div>
        )}

        {summary && (
          <div className={showUpdatingOverlay || isStale ? "cost-updating" : undefined}>
            {showUpdatingOverlay && (
              <span className="updating-badge mt-8">
                <Loader2 size={12} /> Aggiornamento…
              </span>
            )}
            {showCosts && summary.totalCost && (
              <div className="kv">
                <span>Costo totale (finora)</span>
                <b>
                  {summary.totalCost.amount.toFixed(2)} {summary.totalCost.currency}
                </b>
              </div>
            )}
            <div className="kv">
              <span>Tempo di gioco complessivo</span>
              <b>{fmtUptime(summary.totalSeconds)}</b>
            </div>
            {showCosts && summary.totalCost && (
              <p className="muted small mt-8">Il costo è ripartito proporzionalmente alle ore giocate da ciascuno.</p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          <TrendingUp size={16} /> {showCosts ? "Andamento" : "Ore giocate,"} ultimi {TREND_MONTHS} mesi
        </h2>
        {trendError && (
          <div className="banner banner-error mt-12">
            <AlertTriangle size={16} /> {trendError}
          </div>
        )}
        {!trend && !trendError && (
          <div className="stack-8">
            <div className="skeleton skeleton-line w-60" />
            <div className="skeleton" style={{ height: 100, borderRadius: "var(--r-sm)" }} />
          </div>
        )}
        {costData && hoursData && (
          <>
            {showCosts && (
              <>
                <p className="section-sub">Costo mensile ({currency}) — il mese in corso in evidenza</p>
                <TrendBars
                  data={costData}
                  color="var(--rune-light)"
                  formatValue={(v) => `${v.toFixed(2)}`}
                  ariaLabel="Costo mensile negli ultimi sei mesi"
                />
              </>
            )}
            <p className={showCosts ? "section-sub mt-12" : "section-sub"}>Ore giocate — il mese in corso in evidenza</p>
            <TrendBars
              data={hoursData}
              color="var(--rune-light)"
              formatValue={(v) => `${v.toFixed(1)}h`}
              ariaLabel="Ore giocate negli ultimi sei mesi"
            />
          </>
        )}
      </section>

      {summary && summary.players.length > 0 && (
        <section className="card">
          <h2>
            <Users size={16} /> {showCosts ? "Quote per giocatore" : "Tempo per giocatore"}
          </h2>
          {summary.players.map((p) => (
            <UsageMeter key={p.id || p.name} name={p.name} seconds={p.seconds} pct={p.pct} amount={showCosts ? p.shareAmount : null} currency={summary.totalCost?.currency ?? ""} />
          ))}
        </section>
      )}

      {summary && summary.players.length === 0 && !loading && (
        <div className="card empty-state">
          <span className="empty-icon">
            <Clock size={24} />
          </span>
          <p>Nessuna sessione di gioco in questo mese.</p>
        </div>
      )}

      {isAdmin && (
        <section className="card">
          <h2>
            <ListTree size={16} /> Log sessioni ({monthLabel})
          </h2>
          {logError && (
            <div className="banner banner-error mt-12">
              <AlertTriangle size={16} /> {logError}
            </div>
          )}
          {logLoading && !log && (
            <div className="stack-8">
              <div className="skeleton skeleton-line w-60" />
              <div className="skeleton skeleton-line w-40" />
            </div>
          )}
          {log && log.length === 0 && !logLoading && <p className="muted small">Nessuna sessione registrata in questo mese.</p>}
          {log && log.length > 0 && <PlaytimeSessionsLog sessions={log} />}
        </section>
      )}
    </div>
  );
}

function PlaytimeSessionsLog({ sessions }: { sessions: PlaytimeLogEntry[] }) {
  return (
    <>
      {sessions.map((s, i) => (
        <div key={`${s.playerId}|${s.startedAt}|${i}`} className="kv" style={{ flexDirection: "column", alignItems: "stretch", gap: "4px" }}>
          <div className="row-center" style={{ justifyContent: "space-between" }}>
            <b className="small session-name">{s.name}</b>
            {!s.endedAt && <span className="pill pill-RUNNING">in corso</span>}
          </div>
          <span className="muted small">
            entrata {new Date(s.startedAt).toLocaleString("it-IT")}
            {s.endedAt && ` · uscita ${new Date(s.endedAt).toLocaleString("it-IT")}`}
            {" · "}{fmtUptime(s.durationSec)}
          </span>
        </div>
      ))}
    </>
  );
}

function UsageMeter({ name, seconds, pct, amount, currency }: {
  name: string; seconds: number; pct: number; amount: number | null; currency: string;
}) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{name}</span>
        <b>
          {fmtUptime(seconds)}{amount != null && ` · ${amount.toFixed(2)} ${currency}`}
        </b>
      </div>
      <div className="bar">
        <div className="bar-fill gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
