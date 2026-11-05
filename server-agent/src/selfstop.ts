// Self-stop dell'istanza OCI via SDK (oci-common/oci-core), instance principal.
// Niente CLI esterno: sul game server non è garantito che `oci` sia installato
// (dipende da uno script cloud-init best-effort), quindi si usa la stessa
// libreria Node già impiegata dal control-plane backend.

import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { restoreIdleBootVolumePerformance } from "./boot-volume-performance.js";

/**
 * Arresta l'istanza game server (se stessa). In mock logga soltanto.
 * Va chiamata DOPO aver fermato ARK con saveworld.
 */
export async function selfStop(
  deps: { kill?: (pid: number, signal: NodeJS.Signals) => void } = {},
): Promise<boolean> {
  if (config.platform === "docker") {
    // Il container finisce quando termina il processo principale: SIGTERM riusa
    // lo shutdown di index.ts (exit 0). Funziona anche a pannello spento.
    log.warn("Self-stop del container: SIGTERM al processo dell'agent");
    (deps.kill ?? process.kill)(process.pid, "SIGTERM");
    return true;
  }
  const { buildAuthProvider, resolveInstanceOcid } = await import("./oci-client.js");
  const core = await import("oci-core");
  const ocid = await resolveInstanceOcid();
  if (!ocid) {
    log.error("Self-stop annullato: OCID istanza non determinabile");
    return false;
  }
  if (isMock()) {
    log.warn(`[mock] Self-stop dell'istanza ${ocid}`);
    return true;
  }
  log.warn(`Self-stop dell'istanza ${ocid}…`);
  try {
    const provider = await buildAuthProvider();
    const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
    // SOFTSTOP = shutdown ordinato del SO (saveworld già eseguito da stopArk).
    await compute.instanceAction({ instanceId: ocid, action: "SOFTSTOP" });
    log.warn("Comando SOFTSTOP inviato a OCI.");
    // Avvia prima lo shutdown: il cambio tier non allunga il tempo percepito e,
    // se SOFTSTOP viene rifiutato, la VM resta correttamente al tier attivo.
    await restoreIdleBootVolumePerformance().catch((e) => {
      log.warn("Ripristino tier Balanced dopo il self-stop fallito", e);
    });
    return true;
  } catch (e) {
    log.error("Self-stop fallito", e);
    return false;
  }
}
