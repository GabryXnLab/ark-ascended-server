// Operazioni su Object Storage dal control plane. La cancellazione di un backup è
// pura Object Storage: NON richiede il game server acceso (a differenza di backup e
// restore, che girano sull'agent perché devono leggere/scrivere il disco del gioco).
//
// In mock (OCI_MODE=mock) non tocca nulla: logga e ritorna, così lo sviluppo/test
// non dipende da credenziali reali.

import * as objectstorage from "oci-objectstorage";
import { config, isMockOci } from "../config.js";
import { log } from "../logger.js";
import { buildAuthProvider } from "./auth.js";

let client: objectstorage.ObjectStorageClient | null = null;
let cachedNamespace: string | null = null;

async function getClient(): Promise<objectstorage.ObjectStorageClient> {
  if (client) return client;
  const provider = await buildAuthProvider();
  client = new objectstorage.ObjectStorageClient({ authenticationDetailsProvider: provider });
  return client;
}

async function getNamespace(c: objectstorage.ObjectStorageClient): Promise<string> {
  if (cachedNamespace) return cachedNamespace;
  cachedNamespace = (await c.getNamespace({})).value;
  return cachedNamespace;
}

/** Cancella un oggetto dal bucket di backup. Idempotente: no-op se già assente (404). */
export async function deleteObject(objectKey: string): Promise<void> {
  if (isMockOci()) {
    log.info(`[mock] deleteObject ${config.backupBucket}/${objectKey}`);
    return;
  }
  const c = await getClient();
  const namespace = await getNamespace(c);
  try {
    await c.deleteObject({
      namespaceName: namespace,
      bucketName: config.backupBucket,
      objectName: objectKey,
    });
    log.info(`Object Storage: rimosso ${config.backupBucket}/${objectKey}`);
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404) {
      log.warn(`Object Storage: ${objectKey} già assente (404), niente da rimuovere`);
      return;
    }
    throw e;
  }
}
