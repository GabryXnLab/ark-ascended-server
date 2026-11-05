import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { gridBounds, snapToStep, snapTypedValue } from "../numberSnap";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface TouchGesture {
  pointerId: number;
  startX: number;
  startY: number;
  horizontal: boolean;
}

/**
 * Campo numerico con input preciso e slider touch-friendly. Lo slider distingue
 * un gesto orizzontale intenzionale dallo scroll verticale: un dito che scorre
 * la pagina non modifica più accidentalmente il valore. Anche la rotellina su
 * un controllo focalizzato perde il focus prima che il browser applichi step.
 */
export function DragNumberField({
  id, label, ariaDescribedBy, value, placeholder, defaultValue, min, max, step, openEnded = false, onChange,
}: {
  id?: string;
  label?: string;
  ariaDescribedBy?: string;
  value: string;
  placeholder: string;
  defaultValue: string | null;
  min: number;
  max: number;
  step: number;
  /** Nessun limite superiore di validazione: `max` è solo l'estremo dello slider. */
  openEnded?: boolean;
  onChange: (value: string) => void;
}) {
  const range = { min, max, step };
  // Estremi effettivi della griglia: lo slider nativo parte da `min` e
  // produrrebbe valori fuori griglia se il minimo non è multiplo del passo.
  const grid = gridBounds(range);
  const valueOnFocus = useRef(value);
  const skipNextBlurCommit = useRef(false);
  const touchGesture = useRef<TouchGesture | null>(null);
  const [touchPreview, setTouchPreview] = useState<number | null>(null);
  const parsedDefault = defaultValue === null ? NaN : Number(defaultValue);
  const hasNumericDefault = Number.isFinite(parsedDefault);
  const fallback = hasNumericDefault ? clamp(parsedDefault, grid.min, grid.max) : grid.min;
  const numeric = value !== "" ? Number(value) : NaN;
  const sliderValue = touchPreview ?? (Number.isFinite(numeric) ? clamp(numeric, grid.min, grid.max) : fallback);
  const inputLabel = label ? `${label}: valore numerico` : "Valore numerico";

  function commitInput(raw: string) {
    // Un focus/blur senza modifiche non deve riscrivere il valore (né un default fuori griglia).
    if (raw === "" || raw === valueOnFocus.current) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(String(snapTypedValue(parsed, range, hasNumericDefault ? parsedDefault : null, openEnded)));
  }

  function sliderValueFromPointer(event: ReactPointerEvent<HTMLInputElement>): number | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return snapToStep(grid.min + ratio * (grid.max - grid.min), range);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLInputElement>) {
    if (event.pointerType !== "touch") return;
    // Impedisce al range nativo di saltare immediatamente al punto toccato.
    // Il valore cambia solo dopo che il gesto mostra una chiara intenzione orizzontale.
    event.preventDefault();
    touchGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLInputElement>) {
    const gesture = touchGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = Math.abs(event.clientX - gesture.startX);
    const deltaY = Math.abs(event.clientY - gesture.startY);
    if (!gesture.horizontal) {
      if (deltaY > deltaX || deltaX < 8) return;
      gesture.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    setTouchPreview(sliderValueFromPointer(event));
  }

  function finishPointer(event: ReactPointerEvent<HTMLInputElement>) {
    const gesture = touchGesture.current;
    if (gesture?.pointerId === event.pointerId && gesture.horizontal) {
      const committed = sliderValueFromPointer(event) ?? touchPreview;
      if (committed !== null) onChange(String(committed));
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    touchGesture.current = null;
    setTouchPreview(null);
    // Un click/drag non lascia il range focalizzato mentre l'utente continua a scorrere.
    event.currentTarget.blur();
  }

  return (
    <div className="drag-number-field">
      <input
        id={id}
        aria-label={inputLabel}
        aria-describedby={ariaDescribedBy}
        type="number"
        inputMode="decimal"
        className="drag-number-input"
        value={value}
        placeholder={placeholder}
        min={grid.min}
        max={openEnded ? undefined : grid.max}
        step={step}
        onFocus={() => { valueOnFocus.current = value; }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          if (skipNextBlurCommit.current) {
            skipNextBlurCommit.current = false;
            return;
          }
          commitInput(event.target.value);
        }}
        onWheel={(event) => event.currentTarget.blur()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitInput(event.currentTarget.value);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            skipNextBlurCommit.current = true;
            onChange(valueOnFocus.current);
            event.currentTarget.blur();
          }
        }}
      />
      <div className="slider-row drag-number-slider">
        <input
          aria-label={`${label ?? "Valore"}: cursore da ${grid.min} a ${grid.max}`}
          aria-describedby={ariaDescribedBy}
          type="range"
          min={grid.min}
          max={grid.max}
          step={step}
          value={sliderValue}
          disabled={!hasNumericDefault && value === ""}
          onChange={(event) => {
            if (!touchGesture.current || touchGesture.current.horizontal) onChange(event.target.value);
          }}
          onWheel={(event) => event.currentTarget.blur()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={(event) => {
            if (touchGesture.current?.pointerId === event.pointerId) {
              touchGesture.current = null;
              setTouchPreview(null);
            }
          }}
        />
        {value !== "" && (
          <button
            type="button"
            className="drag-number-reset"
            aria-label={`Ripristina ${label ?? "il valore"} al default: ${defaultValue ?? "non impostato"}`}
            title={`Ripristina il default: ${defaultValue ?? "non impostato"}`}
            onClick={() => onChange("")}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      <span className="drag-number-range-hint">
        {openEnded
          ? Number.isFinite(numeric) && numeric > grid.max
            ? `Oltre il cursore (${grid.min}–${grid.max} come nel menu host ARK): valore personalizzato · Passo ${step}`
            : `Cursore ${grid.min}–${grid.max} · valori più alti digitabili · Passo ${step}`
          : `Min ${grid.min} · Max ${grid.max} · Passo ${step}`}
      </span>
    </div>
  );
}
