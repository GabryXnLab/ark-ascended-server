// Stato dei valori dell'editor rispetto al catalogo. Moduli puri, verificati dai
// test del server-agent (la PWA non ha un runner).

import type { GameSettingField } from "./gameSettingsSchema";

/**
 * Un campo è "modificato" solo se ha un valore diverso dal default ASA. Un campo
 * vuoto, uguale al default (confronto numerico per int/float) o infrastrutturale
 * non lo è: il badge e i conteggi non devono segnalare override inesistenti.
 */
export function isModifiedSetting(
  field: Pick<GameSettingField, "type" | "defaultValue" | "infrastructureManaged">,
  value: string | undefined,
): boolean {
  if (field.infrastructureManaged) return false;
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return false;
  if (field.defaultValue === null) return true;
  if (field.type === "int" || field.type === "float") {
    const typed = Number(trimmed);
    const fallback = Number(field.defaultValue);
    if (Number.isFinite(typed) && Number.isFinite(fallback)) return typed !== fallback;
  }
  return trimmed !== field.defaultValue;
}
