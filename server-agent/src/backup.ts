// Backup dei salvataggi ARK su Object Storage. Chiamato dal watcher subito dopo
// `stopArk()` (saveworld già eseguito via RCON), prima del self-stop: checkpoint
// naturale, senza aggiungere uptime. Anche invocabile a mano via POST /backup.
//
// Si archiviano solo i file di salvataggio del profilo attivo, sotto
// Saved/<profileId>/ (vedi save-archive.ts): niente Config/ con i segreti, niente
// mondi degli altri profili, niente log o crash dump.
//
// Modello a copia singola: una sola chiave deterministica per profilo/configurazione
// (`saves/<profileId>.tar.zst`) che si SOVRASCRIVE ad ogni backup; solo il versioning
// del bucket (Terraform, 30 giorni) conserva la copia precedente.
// Per proteggere la copia buona, si verifica l'integrità del tarball appena
// creato PRIMA di sovrascrivere l'oggetto remoto: se è corrotto non si carica nulla.
// Un tarball integro può però contenere un salvataggio che ASA ha rifiutato: per
// questo il control plane lo richiede solo dopo un RCON-online (vedi ark.ts).

import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { getActiveMap, getActiveProfileId, getProfile, getProfileByMap } from "./maps.js";
import { getBackupStore } from "./backup-store.js";
import { savedRootDir } from "./restore.js";
import { createSaveArchive, profileSaveDir } from "./save-archive.js";

export interface BackupResult {
  profileId: string | null;
  map: string | null;
  mods: number[];
  objectKey: string;
  sizeBytes: number;
  backedUpAt: string;
}

async function writeMarker(result: BackupResult): Promise<void> {
  await fs.mkdir(path.dirname(config.lastBackupFile), { recursive: true });
  const tmp = `${config.lastBackupFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(result, null, 2), "utf8");
  await fs.rename(tmp, config.lastBackupFile);
}

/** Legge il marker dell'ultimo backup riuscito (null se non esiste ancora). */
export async function readLastBackup(): Promise<BackupResult | null> {
  try {
    return JSON.parse(await fs.readFile(config.lastBackupFile, "utf8")) as BackupResult;
  } catch {
    return null;
  }
}

/**
 * Comprime i salvataggi del profilo attivo e li carica sul bucket di backup,
 * sovrascrivendo la copia precedente di quel profilo. Best-effort: non lancia mai
 * (un backup fallito non deve bloccare lo stop). Ritorna i dati del backup
 * eseguito, o null se non è stato eseguito (backup disabilitato, nessun profilo
 * attivo, nessun mondo su disco o tarball corrotto).
 */
export async function backupSaves(): Promise<BackupResult | null> {
  if (!config.backupEnabled) return null;

  const map = await getActiveMap();
  const activeProfileId = await getActiveProfileId();
  const profile = activeProfileId
    ? await getProfile(activeProfileId)
    : map
      ? await getProfileByMap(map)
      : null;
  // Senza profilo launch.sh non passa AltSaveDirectoryName: non esiste una cartella
  // del solo profilo da archiviare, e il control plane scarterebbe comunque il backup.
  if (!profile) {
    log.warn(`backup: nessun profilo attivo (mappa ${map ?? "nessuna"}), salto`);
    return null;
  }
  const profileId = profile.id;
  const mods = profile.mods;
  const objectKey = `saves/${profileId}.tar.zst`;

  if (isMock()) {
    log.info(`[mock] backup salvataggi → ${config.backupDir || config.backupBucket}/${objectKey}`);
    const result: BackupResult = {
      profileId,
      map,
      mods,
      objectKey,
      sizeBytes: 0,
      backedUpAt: new Date().toISOString(),
    };
    await writeMarker(result).catch((e) => log.warn("backup: marker non scritto (mock)", e));
    return result;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tarball = path.join(tmpdir(), `arksa-backup-${stamp}.tar.zst`);
  try {
    // createSaveArchive rilegge per intero il tarball: se è corrotto o non contiene
    // un mondo lancia e NON si carica nulla, così l'oggetto remoto resta intatto.
    let files;
    try {
      files = await createSaveArchive(profileSaveDir(savedRootDir(), profileId), tarball);
    } catch (e) {
      log.warn(`backup: archivio di ${profileId} non creato, NON sovrascrivo la copia remota`, e);
      return null;
    }
    if (files.excluded.length > 0) {
      log.info(`backup: esclusi ${files.excluded.length} file non di salvataggio: ${files.excluded.slice(0, 20).join(", ")}`);
    }

    const store = getBackupStore();
    const sizeBytes = await store.put(objectKey, tarball);
    log.info(`backup: caricato ${objectKey} su ${store.label} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

    const out: BackupResult = {
      profileId,
      map,
      mods,
      objectKey,
      sizeBytes,
      backedUpAt: new Date().toISOString(),
    };
    await writeMarker(out).catch((e) => log.warn("backup: marker non scritto", e));
    return out;
  } catch (e) {
    log.error("backup: fallito (non blocca lo stop)", e);
    return null;
  } finally {
    await fs.rm(tarball, { force: true }).catch(() => {});
  }
}
