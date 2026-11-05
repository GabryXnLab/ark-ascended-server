// Gestione dei profili-mappa su disco (config/maps/*.json copiati a deploy).
// Ogni profilo descrive una mappa lanciabile e le sue mod.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface MapProfile {
  id: string;
  name: string;
  map: string; // es. "Astraeos_WP"
  mods: number[];
  description?: string;
  companionMods?: Record<string, number>;
  source?: string;
  notes?: string;
  /** La mod-map è compatibile con i client console (PS5/Xbox)? */
  consoleCompatible?: boolean;
}

export interface MapProfileWithState extends MapProfile {
  active: boolean;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(config.mapsDir, { recursive: true });
}

/** Legge la mappa attiva (file di testo con il nome mappa, es. Astraeos_WP). */
export async function getActiveMap(): Promise<string | null> {
  try {
    const v = (await fs.readFile(config.activeMapFile, "utf8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

export async function setActiveMap(mapName: string): Promise<void> {
  await fs.mkdir(path.dirname(config.activeMapFile), { recursive: true });
  await fs.writeFile(config.activeMapFile, mapName + "\n", "utf8");
}

/** ID del profilo/configurazione attivo (usato anche come AltSaveDirectoryName). */
export async function getActiveProfileId(): Promise<string | null> {
  try {
    const v = (await fs.readFile(config.activeProfileFile, "utf8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

export async function setActiveProfileId(id: string | null): Promise<void> {
  if (id === null) {
    await fs.rm(config.activeProfileFile, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(config.activeProfileFile), { recursive: true });
  await fs.writeFile(config.activeProfileFile, id + "\n", "utf8");
}

export interface ActiveConfigurationRevision {
  id: string;
  revision: number;
  appliedAt: string;
}

/** Revisione che ha completato davvero il provisioning ed è andata online. */
export async function getActiveConfigurationRevision(): Promise<ActiveConfigurationRevision | null> {
  try {
    const value = JSON.parse(await fs.readFile(config.activeConfigFile, "utf8")) as ActiveConfigurationRevision;
    return typeof value.id === "string" && Number.isInteger(value.revision) && value.revision > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function setActiveConfigurationRevision(id: string, revision: number): Promise<void> {
  await fs.mkdir(path.dirname(config.activeConfigFile), { recursive: true });
  const tmp = `${config.activeConfigFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ id, revision, appliedAt: new Date().toISOString() }), "utf8");
  await fs.rename(tmp, config.activeConfigFile);
}

export async function listProfiles(): Promise<MapProfileWithState[]> {
  await ensureDir();
  const active = await getActiveMap();
  const activeProfileId = await getActiveProfileId();
  const files = (await fs.readdir(config.mapsDir)).filter((f) => f.endsWith(".json"));
  const out: MapProfileWithState[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(config.mapsDir, f), "utf8")) as MapProfile;
      out.push({ ...p, active: activeProfileId ? p.id === activeProfileId : p.map === active });
    } catch (e) {
      log.warn(`Profilo mappa illeggibile: ${f}`, e);
    }
  }
  return out;
}

export async function getProfile(id: string): Promise<MapProfileWithState | null> {
  const all = await listProfiles();
  return all.find((p) => p.id === id) ?? null;
}

export async function getProfileByMap(mapName: string): Promise<MapProfileWithState | null> {
  const all = await listProfiles();
  return all.find((p) => p.map === mapName) ?? null;
}

/** Scrive il file active-mods (CSV di ModID) letto dal launcher Proton. */
export async function writeActiveMods(mods: number[]): Promise<void> {
  await fs.mkdir(path.dirname(config.activeModsFile), { recursive: true });
  await fs.writeFile(config.activeModsFile, mods.join(",") + "\n", "utf8");
}

/** Crea/aggiorna un profilo-mappa su disco. */
export async function saveProfile(p: MapProfile): Promise<void> {
  await ensureDir();
  if (!p.id || !p.map) throw new Error("profilo mappa: 'id' e 'map' obbligatori");
  const file = path.join(config.mapsDir, `${p.id}.json`);
  await fs.writeFile(file, JSON.stringify(p, null, 2) + "\n", "utf8");
  log.info(`Profilo mappa salvato: ${p.id} (${p.map})`);
}

/**
 * Cancella il file JSON del profilo mappa. Ritorna false se non esisteva.
 * Non elimina salvataggi o mod condivise già scaricate: sono dati persistenti e
 * richiedono un'azione distinta ed esplicita.
 */
export async function deleteProfile(id: string): Promise<boolean> {
  const file = path.join(config.mapsDir, `${id}.json`);
  try {
    await fs.unlink(file);
    log.info(`Profilo mappa rimosso: ${id}`);
    return true;
  } catch {
    return false;
  }
}
