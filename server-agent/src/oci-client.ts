// Auth OCI condivisa (instance principal / config file) e risoluzione OCID
// dell'istanza corrente. Usata da selfstop.ts, backup.ts e autogrow.ts per
// evitare di duplicare la stessa logica di autenticazione tre volte.

import * as common from "oci-common";
import * as objectstorage from "oci-objectstorage";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";

const METADATA_URL = "http://169.254.169.254/opc/v2/instance/id";

let cachedNamespace: string | null = null;

/** Client Object Storage con l'auth condivisa (instance principal in produzione). */
export async function buildObjectStorageClient(): Promise<objectstorage.ObjectStorageClient> {
  const provider = await buildAuthProvider();
  return new objectstorage.ObjectStorageClient({ authenticationDetailsProvider: provider });
}

export async function getNamespace(client: objectstorage.ObjectStorageClient): Promise<string> {
  if (cachedNamespace) return cachedNamespace;
  const res = await client.getNamespace({});
  cachedNamespace = res.value;
  return cachedNamespace;
}

/** Recupera l'OCID dell'istanza corrente (config o instance metadata). */
export async function resolveInstanceOcid(): Promise<string | null> {
  if (config.ociInstanceOcid) return config.ociInstanceOcid;
  if (isMock()) return "ocid1.instance.mock";
  try {
    const res = await fetch(METADATA_URL, {
      headers: { Authorization: "Bearer Oracle" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.text()).trim() || null;
  } catch (e) {
    log.warn("Impossibile leggere l'OCID dai metadata", e);
    return null;
  }
}

export async function buildAuthProvider(): Promise<common.AuthenticationDetailsProvider> {
  if (config.ociAuth === "instance_principal") {
    return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  }
  return new common.ConfigFileAuthenticationDetailsProvider();
}
