// Ripristina il tier economico del boot volume durante lo spegnimento. Il
// control plane porta lo stesso volume a Higher Performance prima dello START;
// qui copriamo sia l'auto-stop sia shutdown esterni/CI che inviano SIGTERM al
// container. Il cambio OCI è elastico e non modifica filesystem o dati.

import { config, isMock } from "./config.js";
import { log } from "./logger.js";

export async function restoreIdleBootVolumePerformance(): Promise<void> {
  // In docker non esiste boot volume, e il metadata 169.254.169.254 andrebbe in timeout.
  if (isMock() || config.platform === "docker") return;
  const { buildAuthProvider, resolveInstanceOcid } = await import("./oci-client.js");
  const core = await import("oci-core");
  const instanceId = await resolveInstanceOcid();
  if (!instanceId) throw new Error("OCID istanza non determinabile");

  const provider = await buildAuthProvider();
  const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
  const blockstorage = new core.BlockstorageClient({ authenticationDetailsProvider: provider });
  const instance = (await compute.getInstance({ instanceId })).instance;
  const attachments = await compute.listBootVolumeAttachments({
    compartmentId: instance.compartmentId,
    availabilityDomain: instance.availabilityDomain,
    instanceId,
  });
  const bootVolumeId = attachments.items[0]?.bootVolumeId;
  if (!bootVolumeId) throw new Error("boot volume dell'istanza non trovato");

  const current = (await blockstorage.getBootVolume({ bootVolumeId })).bootVolume.vpusPerGB;
  if (current === config.bootIdleVpus) return;
  await blockstorage.updateBootVolume({
    bootVolumeId,
    updateBootVolumeDetails: { vpusPerGB: config.bootIdleVpus },
  });
  log.info(`Boot volume OCI ripristinato: ${current ?? "?"} → ${config.bootIdleVpus} VPU/GB`);
}
