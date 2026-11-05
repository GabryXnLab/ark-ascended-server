// Persistenza delle "configurazioni di gioco": pacchetti salvabili di mappa + mod +
// parametri ini, caricabili a scelta sul server live. Stesso pattern di persistenza
// atomica e mutex in-process di requests-store.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { config } from "./config.js";

export interface IniOverrideSet {
  values: Record<string, string>;
  sections: Record<string, string>;
  raw?: string;
  managedKeys?: string[];
}

export type ConfigAccessMode = "review" | "full";

export interface ConfigAccessControl {
  /** Se attivo, soltanto l'ACL salvata dall'amministratore vale per i membri:
   * anche il proprietario perde il diritto implicito di modifica. */
  administratorLocked: boolean;
  /** UUID Supabase dell'account Google -> livello di modifica. L'assenza vale
   * "nessun accesso"; owner/admin della community sono risolti separatamente. */
  grants: Record<string, ConfigAccessMode>;
}

export const DEFAULT_CONFIG_ACCESS: ConfigAccessControl = {
  administratorLocked: false,
  grants: {},
};

export interface GameConfiguration {
  id: string;
  /** Revisione monotona: cambia a ogni salvataggio e identifica esattamente
   * il contenuto consegnato al game server. I record storici senza campo valgono 1. */
  revision: number;
  name: string;
  map: string;
  mods: number[];
  iniOverrides: {
    gus: IniOverrideSet;
    game: IniOverrideSet;
    launchArgs?: string;
  };
  ownerId: string;
  ownerName: string;
  accessControl: ConfigAccessControl;
  accessUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
}

export type GameConfigurationInput = Pick<GameConfiguration, "name" | "map" | "mods" | "iniOverrides">;

function hasSameContent(current: GameConfiguration, input: GameConfigurationInput): boolean {
  return current.name === input.name
    && current.map === input.map
    && isDeepStrictEqual(current.mods, input.mods)
    && isDeepStrictEqual(current.iniOverrides, input.iniOverrides);
}

// --- Completezza: una configurazione può essere salvata anche a metà (vedi upsertConfig
// sotto, nessun vincolo di non-vuotezza), ma per essere applicata/messa in coda sul game
// server servono almeno nome e mappa (vedi requireCompleteConfig in routes.ts).

export type RequiredConfigField = "name" | "map";

export const REQUIRED_CONFIG_FIELD_LABELS: Record<RequiredConfigField, string> = {
  name: "Nome configurazione",
  map: "Mappa",
};

export function missingRequiredFields(cfg: Pick<GameConfiguration, "name" | "map">): RequiredConfigField[] {
  const missing: RequiredConfigField[] = [];
  if (!cfg.name.trim()) missing.push("name");
  if (!cfg.map.trim()) missing.push("map");
  return missing;
}

let cache: GameConfiguration[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function load(): Promise<GameConfiguration[]> {
  if (cache) return cache;
  try {
    const text = await fs.readFile(config.configsDataFile, "utf8");
    cache = (JSON.parse(text) as GameConfiguration[]).map((item) => ({
      ...item,
      revision: Number.isInteger(item.revision) && item.revision > 0 ? item.revision : 1,
      accessControl: normalizeConfigAccess(item.accessControl),
    }));
  } catch {
    cache = [];
  }
  return cache;
}

export function normalizeConfigAccess(value: unknown): ConfigAccessControl {
  const source = typeof value === "object" && value !== null
    ? value as Partial<ConfigAccessControl>
    : {};
  const grants: Record<string, ConfigAccessMode> = {};
  if (typeof source.grants === "object" && source.grants !== null && !Array.isArray(source.grants)) {
    for (const [userId, mode] of Object.entries(source.grants)) {
      if ((mode === "review" || mode === "full") && !["__proto__", "constructor", "prototype"].includes(userId)) {
        grants[userId] = mode;
      }
    }
  }
  return { administratorLocked: source.administratorLocked === true, grants };
}

async function save(data: GameConfiguration[]): Promise<void> {
  await fs.mkdir(path.dirname(config.configsDataFile), { recursive: true });
  const tmp = `${config.configsDataFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, config.configsDataFile);
  cache = data;
}

/** Più recenti prima. */
export async function listConfigs(): Promise<GameConfiguration[]> {
  return [...(await load())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConfig(id: string): Promise<GameConfiguration | undefined> {
  return (await load()).find((c) => c.id === id);
}

/** Crea (se `id` assente/non esistente) o aggiorna una configurazione. */
export async function upsertConfig(
  input: GameConfigurationInput,
  owner: { id: string; name: string },
  id?: string,
  initialAccess: ConfigAccessControl = DEFAULT_CONFIG_ACCESS,
): Promise<GameConfiguration> {
  return withLock(async () => {
    const data = await load();
    const now = new Date().toISOString();
    const existing = id ? data.find((c) => c.id === id) : undefined;
    if (existing) {
      // Un salvataggio identico (autosave/doppio click) non rende obsoleta la
      // configurazione live: la revisione descrive il contenuto, non l'evento UI.
      if (hasSameContent(existing, input)) return existing;
      Object.assign(existing, input, { revision: existing.revision + 1, updatedAt: now });
      await save(data);
      return existing;
    }
    const created: GameConfiguration = {
      id: id ?? randomUUID(),
      revision: 1,
      ...input,
      ownerId: owner.id,
      ownerName: owner.name,
      accessControl: normalizeConfigAccess(initialAccess),
      createdAt: now,
      updatedAt: now,
    };
    data.push(created);
    await save(data);
    return created;
  });
}

/** Aggiorna solo l'ACL: non incrementa la revisione del contenuto consegnato
 * all'agent e non rende obsoleta la configurazione live. */
export async function updateConfigAccess(
  id: string,
  accessControl: ConfigAccessControl,
): Promise<GameConfiguration | undefined> {
  return withLock(async () => {
    const data = await load();
    const current = data.find((item) => item.id === id);
    if (!current) return undefined;
    const normalized = normalizeConfigAccess(accessControl);
    if (isDeepStrictEqual(current.accessControl, normalized)) return current;
    current.accessControl = normalized;
    current.accessUpdatedAt = new Date().toISOString();
    await save(data);
    return current;
  });
}

export async function markConfigApplied(id: string): Promise<void> {
  await withLock(async () => {
    const data = await load();
    const c = data.find((x) => x.id === id);
    if (!c) return;
    c.lastAppliedAt = new Date().toISOString();
    await save(data);
  });
}

export async function deleteConfig(id: string): Promise<boolean> {
  return withLock(async () => {
    const data = await load();
    const before = data.length;
    const next = data.filter((c) => c.id !== id);
    if (next.length === before) return false;
    await save(next);
    return true;
  });
}

// --- Configurazione corrente: l'ultima applicata con successo sul game server (vedi
// applyConfigLive in routes.ts). Usata da boot-sync.ts per ripristinare la sessione da
// sola quando l'istanza si riaccende senza che l'utente abbia scelto nulla di nuovo — la
// selezione esplicita a server spento resta invece in boot-queue-store.ts (kind
// "selectConfig"), applicata in coda insieme alle altre operazioni dirette.

let currentCache: string | null | undefined;

async function loadCurrent(): Promise<string | null> {
  if (currentCache !== undefined) return currentCache;
  try {
    const text = await fs.readFile(config.currentConfigFile, "utf8");
    currentCache = (JSON.parse(text) as { id: string | null }).id ?? null;
  } catch {
    currentCache = null;
  }
  return currentCache;
}

export async function getCurrentConfigId(): Promise<string | null> {
  return loadCurrent();
}

export async function setCurrentConfigId(id: string | null): Promise<void> {
  await fs.mkdir(path.dirname(config.currentConfigFile), { recursive: true });
  const tmp = `${config.currentConfigFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ id }), "utf8");
  await fs.rename(tmp, config.currentConfigFile);
  currentCache = id;
}
