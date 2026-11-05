import { useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Mini-grafico a linea (sparkline) leggero, SVG scritto a mano — nessuna libreria di
 * charting. Una sola serie: nessuna legenda necessaria (il titolo/etichetta esterna
 * dice già cosa è tracciato). Linea 2px, area di riempimento ~10% di opacità nello
 * stesso hue, punto finale enfatizzato con anello colore-superficie. Crosshair al
 * passaggio del puntatore/tocco con tooltip valore+istante (nessun asse: i valori
 * sono decorativi/di tendenza, il valore corrente resta comunque leggibile nel testo
 * accanto al grafico, quindi il tooltip arricchisce senza mai essere l'unica via
 * d'accesso al dato).
 */
export function Sparkline({
  values,
  color,
  height = 34,
  formatValue = (v) => v.toFixed(1),
  ariaLabel,
}: {
  values: number[];
  color: string;
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const width = 100; // viewBox logico, scala via preserveAspectRatio + CSS width:100%
  const gradId = useId();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (values.length < 2) {
    return (
      <div className="spark-empty" style={{ height }} aria-hidden="true">
        <span>—</span>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3; // margine verticale così linea/punto non si tagliano ai bordi
  const innerH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return { x, y, v };
  });

  // `points` ha sempre `values.length` elementi (>=2, controllato sopra): gli accessi
  // per indice qui sotto sono sempre in range, le asserzioni non-null lo riflettono.
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const last = points[points.length - 1]!;
  const areaPath = `${linePath} L${last.x.toFixed(2)},${height} L0,${height} Z`;

  function handleMove(e: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i]!.x - relX);
      if (d < best) { best = d; nearest = i; }
    }
    const p = points[nearest]!;
    setHover({ i: nearest, x: p.x, y: p.y });
  }

  const hoveredPoint = hover ? (points[hover.i] ?? null) : null;

  return (
    <div className="spark-wrap" style={{ height }}>
      <svg
        ref={svgRef}
        className="spark-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${ariaLabel}: andamento recente, valore attuale ${formatValue(last.v)}`}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* punto finale: marcatore >=8px con anello colore-superficie per restare leggibile sopra la linea */}
        <circle cx={last.x} cy={last.y} r="4.5" fill="var(--slab)" />
        <circle cx={last.x} cy={last.y} r="3" fill={color} />
        {hoveredPoint && (
          <>
            <line
              x1={hoveredPoint.x} x2={hoveredPoint.x}
              y1={pad} y2={height - pad}
              stroke="var(--ash)" strokeOpacity="0.35" strokeWidth="1"
            />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="4.5" fill="var(--slab)" />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3" fill={color} />
          </>
        )}
      </svg>
      {hoveredPoint && (
        <div
          className="spark-tooltip"
          style={{ left: `${(hover!.x / width) * 100}%` }}
        >
          {formatValue(hoveredPoint.v)}
        </div>
      )}
    </div>
  );
}
