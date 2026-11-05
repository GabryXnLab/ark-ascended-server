// Allineamento dei valori numerici dell'editor alla griglia `step`. Modulo puro
// (nessuna dipendenza da React) per poterlo verificare dai test del server-agent.

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

// Tolleranza per gli errori di rappresentazione dei float (0.01 / 0.05 ecc.).
const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decimalsOf(step: number): number {
  return (String(step).split(".")[1] ?? "").length;
}

function round(value: number, step: number): number {
  return Number(value.toFixed(decimalsOf(step)));
}

/**
 * Primo e ultimo punto della griglia (multipli di `step` ancorati a zero) che
 * cadono nell'intervallo. Ancorare a zero, e non a `min`, evita che un minimo
 * non multiplo del passo (es. min 1, passo 60) sposti tutta la griglia e
 * trasformi 3600 in 3601.
 */
export function gridBounds({ min, max, step }: NumericRange): { min: number; max: number } {
  const low = round(Math.ceil(min / step - EPSILON) * step, step);
  const high = round(Math.floor(max / step + EPSILON) * step, step);
  return low <= high ? { min: low, max: high } : { min, max };
}

/**
 * Riporta `value` sul punto di griglia più vicino dentro l'intervallo. Un
 * valore uguale a `keep` (il default ASA) viene solo limitato al range, mai
 * arrotondato: un default fuori griglia non deve cambiare per un semplice tocco.
 */
export function snapToStep(value: number, range: NumericRange, keep?: number | null): number {
  if (keep !== undefined && keep !== null && Math.abs(value - keep) < EPSILON) {
    return clamp(keep, range.min, range.max);
  }
  const bounds = gridBounds(range);
  const snapped = round(Math.round(clamp(value, bounds.min, bounds.max) / range.step) * range.step, range.step);
  return clamp(snapped, bounds.min, bounds.max);
}

/** Campo numerico del catalogo, ridotto a ciò che serve per lo slider. */
export interface NumericFieldLimits {
  type: string;
  min?: number;
  max?: number;
  sliderMax?: number;
  step?: number;
}

/**
 * Intervallo dello slider: per i campi senza limite superiore di validazione è
 * il profilo dell'interfaccia host (`sliderMax`), altrimenti coincide con i limiti.
 */
export function sliderRange(field: NumericFieldLimits): NumericRange {
  const max = field.sliderMax ?? field.max;
  if (field.min !== undefined && max !== undefined) {
    return { min: field.min, max, step: field.step ?? (field.type === "int" ? 1 : 0.1) };
  }
  // Range di riserva per i (rari) campi numerici privi di min/max espliciti nello schema.
  return field.type === "int" ? { min: 0, max: 1000, step: 1 } : { min: 0, max: 10, step: 0.1 };
}

/**
 * Allinea un valore digitato: come `snapToStep`, ma se il campo non ha limite
 * superiore (`openEnded`) un valore oltre lo slider resta tale, solo allineato al passo.
 */
export function snapTypedValue(value: number, range: NumericRange, keep: number | null, openEnded: boolean): number {
  if (!openEnded || value <= range.max) return snapToStep(value, range, keep);
  return snapToStep(value, { ...range, max: value + range.step }, keep);
}
