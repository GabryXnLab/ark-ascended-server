// Cancellazione dei backup dal lato pannello. Backup e restore girano invece
// sull'agent (leggono il disco del gioco); qui serve solo togliere l'archivio.

import { rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";

// Stessa forma delle chiavi prodotte dall'agent; il filesystem rende il traversal reale.
const KEY_RE = /^saves\/([A-Za-z0-9_-]+)\.tar\.zst$/;

/** Idempotente: un backup già assente non è un errore. */
export async function deleteBackup(
  objectKey: string,
  { provider = config.instanceProvider, backupDir = config.backupDir }: { provider?: string; backupDir?: string } = {},
): Promise<void> {
  if (provider !== "docker") {
    const { deleteObject } = await import("./oci/objectstorage.js");
    return deleteObject(objectKey);
  }
  const match = KEY_RE.exec(objectKey);
  if (!match) throw new Error(`chiave di backup non valida: ${objectKey}`);
  const root = path.resolve(backupDir);
  const file = path.resolve(root, objectKey);
  const versions = path.resolve(root, "saves", ".versions", match[1]!);
  if (!file.startsWith(root + path.sep) || !versions.startsWith(root + path.sep)) {
    throw new Error(`chiave di backup fuori dalla cartella dei backup: ${objectKey}`);
  }
  await rm(file, { force: true });
  await rm(versions, { recursive: true, force: true });
  log.info(`Backup locale rimosso: ${objectKey}`);
}
