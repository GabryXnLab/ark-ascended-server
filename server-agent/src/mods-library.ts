// Libreria mod condivisa: visibilità (elenco, dimensione su disco, rimozione)
// delle mod ARK Ascended effettivamente presenti sul filesystem del game server.
//
// Nota di design: tutte le "configurazioni" (control-plane/backend/src/configs-store.ts)
// e i profili-mappa (maps.ts) condividono UNA SOLA installazione del gioco
// (config.arkInstallDir). Una mod con lo stesso ModID referenziata da più
// configurazioni viene quindi già scaricata UNA SOLA VOLTA a livello di filesystem
// (il download lo fa ASA stesso all'avvio, passando `-mods=<csv>`, non questo modulo)
// — qui non c'è nessuna deduplica da fare, solo da mostrare cosa c'è davvero su disco
// e permettere di liberare spazio rimuovendo mod non più referenziate da nessuna
// configurazione.
//
// Layout verificato dal vivo il 2026-09-30: l'updater nativo di ASA scarica ogni
// mod in `<arkInstallDir>/ShooterGame/Binaries/Win64/ShooterGame/Mods/83374/
// <ModID>_<FileID>/`, dove 83374 è l'ID CurseForge del gioco e FileID la versione
// del pacchetto. La cartella del gioco NON è una mod: trattarla come tale la
// esponeva come "mod orfana" e la sua rimozione cancellava tutte le mod insieme.

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";

export interface InstalledModEntry {
  id: number;
  sizeBytes: number;
  installedAt: string; // ISO, mtime della cartella della mod
}

const MODS_DIR = "ShooterGame/Binaries/Win64/ShooterGame/Mods";

/** Somma ricorsiva delle dimensioni dei file in una cartella. Best-effort: mai lancia. */
async function dirSize(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    log.debug(`mods-library: impossibile leggere ${dir} per il calcolo dimensione`, e);
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        const st = await fs.stat(full);
        total += st.size;
      } catch {
        // file sparito tra readdir e stat (es. rimosso concorrentemente): ignora.
      }
    }
  }
  return total;
}

const MOD_DIR_PATTERN = /^(\d+)_\d+$/;

/** Cartelle `<ModID>_<FileID>` sotto `.../Mods/` e sotto le sue cartelle-gioco (es. `83374`). */
async function modDirs(baseDir: string): Promise<{ id: number; dir: string }[]> {
  const found: { id: number; dir: string }[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      log.debug(`mods-library: cartella mod non trovata (ok se non esiste ancora): ${dir}`, e);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = MOD_DIR_PATTERN.exec(entry.name);
      if (match) found.push({ id: Number(match[1]), dir: path.join(dir, entry.name) });
      else if (depth === 0 && /^\d+$/.test(entry.name)) await visit(path.join(dir, entry.name), 1);
    }
  };
  await visit(baseDir, 0);
  return found;
}

/** Mod presenti su disco; più versioni della stessa mod vengono sommate. */
async function scanModsDir(baseDir: string): Promise<Map<number, InstalledModEntry>> {
  const result = new Map<number, InstalledModEntry>();
  for (const { id, dir } of await modDirs(baseDir)) {
    try {
      const [sizeBytes, st] = await Promise.all([dirSize(dir), fs.stat(dir)]);
      const previous = result.get(id);
      const installedAt = st.mtime.toISOString();
      result.set(id, {
        id,
        sizeBytes: (previous?.sizeBytes ?? 0) + sizeBytes,
        installedAt: previous && previous.installedAt > installedAt ? previous.installedAt : installedAt,
      });
    } catch (e) {
      log.warn(`mods-library: impossibile leggere la mod ${id} in ${dir}, la salto`, e);
    }
  }
  return result;
}

const MOCK_MODS: InstalledModEntry[] = [
  { id: 988598, sizeBytes: 612 * 1024 * 1024, installedAt: "2026-06-28T20:15:00.000Z" },
  { id: 123456, sizeBytes: 89 * 1024 * 1024, installedAt: "2026-07-02T09:30:00.000Z" },
];

/** Elenca le mod realmente presenti su disco (dimensione + data installazione). */
export async function listInstalledMods(): Promise<InstalledModEntry[]> {
  if (isMock()) {
    log.debug("[mock] listInstalledMods");
    return MOCK_MODS;
  }
  const found = await scanModsDir(path.join(config.arkInstallDir, MODS_DIR));
  return [...found.values()].sort((a, b) => a.id - b.id);
}

/** Rimuove tutte le versioni di una mod dal disco. Idempotente: no-op se non presente. */
export async function uninstallMod(id: number): Promise<void> {
  if (isMock()) {
    log.info(`[mock] rimozione mod ${id}`);
    return;
  }
  const dirs = (await modDirs(path.join(config.arkInstallDir, MODS_DIR))).filter((mod) => mod.id === id);
  for (const { dir } of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      log.info(`mods-library: mod ${id} rimossa da ${dir}`);
    } catch (e) {
      // force:true evita già l'errore ENOENT; qui restano solo casi anomali (permessi, I/O).
      log.warn(`mods-library: rimozione mod ${id} fallita per ${dir}`, e);
    }
  }
  if (dirs.length === 0) log.info(`mods-library: mod ${id} già assente`);
}
