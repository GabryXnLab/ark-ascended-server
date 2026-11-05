// Le impostazioni amministrative condivise dal launcher e dall'agent non
// appartengono ai profili. Questa barriera è applicata sia agli input API sia
// alle configurazioni legacy lette dal disco, così password o URL storici non
// vengono esposti o riapplicati. Il launcher materializza sempre i valori
// infrastrutturali autorevoli nel solo INI runtime.

import type { GameConfiguration, IniOverrideSet } from "./configs-store.js";
import { INFRASTRUCTURE_MANAGED_GUS_KEY_NAMES } from "./shared/config-rules.js";

const INFRASTRUCTURE_OWNED_KEYS = new Map(INFRASTRUCTURE_MANAGED_GUS_KEY_NAMES.map((key) => [key.toLowerCase(), key]));

function infrastructureOwnedKey(key: string): string | null {
  return INFRASTRUCTURE_OWNED_KEYS.get(key.trim().replace(/^[+-]/, "").toLowerCase()) ?? null;
}

function infrastructureOwnedRawKey(raw: string | undefined): string | null {
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const owned = infrastructureOwnedKey(trimmed.slice(0, equals));
    if (owned) return owned;
  }
  return null;
}

function withoutInfrastructureOwnedKeys(settings: IniOverrideSet): IniOverrideSet {
  const values = Object.fromEntries(
    Object.entries(settings.values).filter(([key]) => !infrastructureOwnedKey(key)),
  );
  const sections = Object.fromEntries(
    Object.entries(settings.sections).filter(([key]) => !infrastructureOwnedKey(key)),
  );
  const raw = (settings.raw ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      const equals = trimmed.indexOf("=");
      return equals <= 0 || !infrastructureOwnedKey(trimmed.slice(0, equals));
    })
    .join("\n");
  return { ...settings, values, sections, raw };
}

/** Restituisce un errore utente se un payload tenta di impostare valori runtime. */
export function validateInfrastructureOwnedSettings(
  file: string,
  values: Record<string, string>,
  raw?: string,
): string | null {
  if (file !== "GameUserSettings") return null;
  const forbidden = Object.keys(values).map(infrastructureOwnedKey).find(Boolean)
    ?? infrastructureOwnedRawKey(raw);
  if (forbidden) return `${forbidden} è gestita dall'infrastruttura e non può essere salvata nei profili o negli INI`;
  return null;
}

/** Copia priva di valori infrastrutturali, adatta a risposta API e apply live. */
export function withoutInfrastructureOwnedSettings(config: GameConfiguration): GameConfiguration {
  return {
    ...structuredClone(config),
    iniOverrides: {
      ...structuredClone(config.iniOverrides),
      gus: withoutInfrastructureOwnedKeys(config.iniOverrides.gus),
    },
  };
}
