// Ripristino di un salvataggio dall'archivio backup nella sola cartella del profilo
// target (Saved/<profileId>/, vedi save-archive.ts). Gira a ASA fermo, prima che il
// server venga avviato per quel profilo: POST /restore e stage "restoring-save" del
// provisioning. Config/, gli altri mondi e i log restano intatti.

import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { isArkRunning } from "./ark.js";
import { assertValidObjectKey, getBackupStore } from "./backup-store.js";
import { assertSafeProfileId, restoreSaveArchive } from "./save-archive.js";

/** Cartella `Saved` dell'installazione ARK. */
export function savedRootDir(): string {
  return path.join(config.arkInstallDir, "ShooterGame", "Saved");
}

/**
 * Scarica il tarball indicato e sostituisce con esso Saved/<profileId>/. Lancia se
 * ASA è in esecuzione, se download/validazione/estrazione falliscono: in quel caso
 * la cartella del profilo resta quella precedente.
 */
export async function restoreSave(profileId: string, objectKey: string): Promise<void> {
  assertSafeProfileId(profileId);
  assertValidObjectKey(objectKey);
  if (isMock()) {
    log.info(`[mock] restore ${objectKey} → profilo ${profileId}`);
    return;
  }
  // ASA tiene il mondo aperto e lo riscriverebbe allo stop, annullando il ripristino.
  if (await isArkRunning()) throw new Error("ASA è in esecuzione: fermarlo prima del ripristino");

  const tarball = path.join(tmpdir(), `arksa-restore-${Date.now()}.tar.zst`);
  try {
    await getBackupStore().fetch(objectKey, tarball);
    const files = await restoreSaveArchive(tarball, savedRootDir(), profileId);
    log.info(`restore: ${objectKey} → Saved/${profileId}/ (${files.length} file)`);
  } finally {
    await fs.rm(tarball, { force: true }).catch(() => {});
  }
}
