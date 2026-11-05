// Campi obbligatori perché una configurazione sia deployabile sul server Ark (lato
// client, a specchio di missingRequiredFields in control-plane/backend/src/configs-store.ts).
// Il salvataggio di una bozza incompleta resta sempre consentito: questi controlli
// riguardano solo apply/select.

import type { GameConfiguration } from "./types";

export type RequiredConfigField = "name" | "map";

export const REQUIRED_CONFIG_FIELD_LABELS: Record<RequiredConfigField, string> = {
  name: "Nome configurazione",
  map: "Mappa",
};

export function missingRequiredConfigFields(cfg: Pick<GameConfiguration, "name" | "map">): RequiredConfigField[] {
  const missing: RequiredConfigField[] = [];
  if (!cfg.name.trim()) missing.push("name");
  if (!cfg.map.trim()) missing.push("map");
  return missing;
}

export function missingConfigFieldLabels(cfg: Pick<GameConfiguration, "name" | "map">): string {
  return missingRequiredConfigFields(cfg).map((field) => REQUIRED_CONFIG_FIELD_LABELS[field]).join(", ");
}
