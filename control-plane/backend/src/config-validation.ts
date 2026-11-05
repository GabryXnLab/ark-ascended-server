// Validazione al salvataggio di una configurazione: la stessa che l'agent applica
// al provisioning (regole condivise in shared/) più i controlli di catalogo
// (chiavi note, tipi, intervalli). Così un errore emerge subito come 400 e non
// come stage `error` dopo che la configurazione è già stata marcata applicata.

import { validateConfigSettings } from "./shared/config-rules.js";
import { CONFIG_RULES_CATALOG } from "./shared/config-rules-catalog.js";
import type { ConfigPayload } from "./requests-store.js";
import type { GameConfiguration } from "./configs-store.js";
import type { EffectiveConfigAccess } from "./config-access.js";

const MAX_REPORTED_ERRORS = 5;

/** Messaggio italiano per l'utente, oppure null se le impostazioni sono valide. */
export function validateConfigPayloadSettings(iniOverrides: ConfigPayload["iniOverrides"]): string | null {
  const errors = validateConfigSettings(
    {
      gus: iniOverrides.gus,
      game: iniOverrides.game,
      launchArgs: iniOverrides.launchArgs ?? "",
    },
    CONFIG_RULES_CATALOG,
  );
  if (errors.length === 0) return null;
  const hidden = errors.length - MAX_REPORTED_ERRORS;
  const shown = errors.slice(0, MAX_REPORTED_ERRORS).join("; ");
  return `Configurazione non valida: ${shown}${hidden > 0 ? `; altri ${hidden} errori` : ""}`;
}

/**
 * ServerPassword resta visibile a tutti i membri (serve per entrare); la
 * password spettatore dà invece un accesso privilegiato e la vedono solo gli
 * admin e chi può modificare o proporre modifiche alla configurazione.
 */
export function maskSensitiveConfigFields(
  configuration: GameConfiguration,
  access: EffectiveConfigAccess,
): GameConfiguration {
  if (access !== "none") return configuration;
  const gus = configuration.iniOverrides.gus;
  const isHidden = (key: string) => key.replace(/^[+-]/, "").toLowerCase() === "spectatorpassword";
  const keyOf = (line: string) => line.split("=", 1)[0]?.trim() ?? "";
  return {
    ...configuration,
    iniOverrides: {
      ...configuration.iniOverrides,
      gus: {
        ...gus,
        values: Object.fromEntries(Object.entries(gus.values).filter(([key]) => !isHidden(key))),
        raw: (gus.raw ?? "").split(/\r?\n/).filter((line) => !line.includes("=") || !isHidden(keyOf(line))).join("\n"),
      },
    },
  };
}
