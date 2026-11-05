import { useState } from "react";

export interface TrendBarDatum {
  key: string;
  label: string; // etichetta breve sotto la barra (es. "Lug")
  fullLabel: string; // etichetta estesa per il tooltip (es. "Luglio 2026")
  value: number;
  isCurrent: boolean;
}

/**
 * Colonne per il confronto di poche categorie discrete nel tempo (mesi). Una sola
 * serie -> nessuna legenda: l'identità qui non è "quale serie" ma "storico vs mese
 * corrente", risolta con il pattern emphasis (il mese corrente nell'hue accento,
 * gli altri in un grigio recessivo), non con colori categoriali. Etichetta di valore
 * solo sulla barra corrente e sul massimo, per non affollare il grafico; le altre
 * restano leggibili in tooltip/al passaggio del fuoco.
 */
export function TrendBars({
  data,
  color,
  formatValue,
  ariaLabel,
}: {
  data: TrendBarDatum[];
  color: string;
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  const maxKey = data.find((d) => d.value === max)?.key;

  return (
    <div className="trendbars" role="img" aria-label={ariaLabel}>
      <div className="trendbars-plot">
        {data.map((d) => {
          const pct = Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0);
          const showValue = d.isCurrent || d.key === maxKey || hover === d.key;
          return (
            <div
              key={d.key}
              className={`trendbar-col${d.isCurrent ? " is-current" : ""}${hover === d.key ? " is-hover" : ""}`}
              onPointerEnter={() => setHover(d.key)}
              onPointerLeave={() => setHover((h) => (h === d.key ? null : h))}
              tabIndex={0}
              onFocus={() => setHover(d.key)}
              onBlur={() => setHover((h) => (h === d.key ? null : h))}
            >
              <span className={`trendbar-value${showValue ? " show" : ""}`}>{formatValue(d.value)}</span>
              <div className="trendbar-track">
                <div
                  className="trendbar-fill"
                  style={{ height: `${pct}%`, background: d.isCurrent ? color : "var(--ash-dim)" }}
                />
              </div>
              <span className="trendbar-label">{d.label}</span>
              {hover === d.key && (
                <div className="trendbar-tooltip">
                  <b>{d.fullLabel}</b>
                  <span>{formatValue(d.value)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
