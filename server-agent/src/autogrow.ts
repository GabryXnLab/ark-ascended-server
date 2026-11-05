// Autoscaling dello storage del game server: quando lo spazio libero scende
// sotto soglia (nuove mod/mappe installate), amplia il boot volume via OCI.
//
// Solo crescita: OCI non permette di rimpicciolire un volume. Il contenimento
// dei costi nel tempo passa dalla pulizia (mod inutilizzate, cache SteamCMD),
// non da uno shrink automatico che l'infrastruttura non offre.
//
// Nota: il resize OCI del volume è immediato, ma partizione e filesystem si
// espandono solo al prossimo boot (moduli cloud-init growpart/resizefs, già
// abilitati di default sulle immagini Ubuntu Canonical) — coerente col ciclo
// on-demand, che riavvia comunque l'istanza a ogni sessione di gioco.

import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import type { Metrics } from "./metrics.js";
import { broadcast } from "./ark.js";

let lastGrowAt = 0;

/** Controlla l'occupazione disco e, se serve, amplia il boot volume (cooldown incluso). */
export async function maybeGrowBootVolume(metrics: Metrics): Promise<void> {
  if (config.diskGrowStepGb <= 0) return;
  if (metrics.diskUsedGb == null || metrics.diskTotalGb == null || metrics.diskTotalGb <= 0) return;

  const usedPct = (metrics.diskUsedGb / metrics.diskTotalGb) * 100;
  if (usedPct < config.diskGrowThresholdPct) return;

  const cooldownMs = config.diskGrowCooldownMin * 60_000;
  if (Date.now() - lastGrowAt < cooldownMs) return;

  if (isMock()) {
    log.info(`[mock] disco al ${usedPct.toFixed(0)}%: crescita boot volume simulata (+${config.diskGrowStepGb}GB)`);
    lastGrowAt = Date.now();
    return;
  }

  const { buildAuthProvider, resolveInstanceOcid } = await import("./oci-client.js");
  const ocid = await resolveInstanceOcid();
  if (!ocid) {
    log.warn("autogrow: OCID istanza non determinabile, salto controllo");
    return;
  }

  try {
    const core = await import("oci-core");
    const provider = await buildAuthProvider();
    const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
    const blockstorage = new core.BlockstorageClient({ authenticationDetailsProvider: provider });

    const instance = (await compute.getInstance({ instanceId: ocid })).instance;
    const attachments = (
      await compute.listBootVolumeAttachments({
        compartmentId: instance.compartmentId,
        availabilityDomain: instance.availabilityDomain,
        instanceId: ocid,
      })
    ).items;
    const bootVolumeId = attachments[0]?.bootVolumeId;
    if (!bootVolumeId) {
      log.warn("autogrow: boot volume non trovato, salto controllo");
      return;
    }

    const bootVolume = (await blockstorage.getBootVolume({ bootVolumeId })).bootVolume;
    const currentGb = bootVolume.sizeInGBs ?? 0;
    if (currentGb >= config.diskGrowMaxGb) {
      log.warn(
        `autogrow: disco al ${usedPct.toFixed(0)}% ma il volume è già al tetto di sicurezza ` +
          `(${currentGb}GB ≥ DISK_GROW_MAX_GB=${config.diskGrowMaxGb}GB). Serve pulizia manuale ` +
          `(mod inutilizzate/cache) o alzare il tetto.`,
      );
      lastGrowAt = Date.now();
      return;
    }

    const newSizeGb = Math.min(currentGb + config.diskGrowStepGb, config.diskGrowMaxGb);
    await blockstorage.updateBootVolume({
      bootVolumeId,
      updateBootVolumeDetails: { sizeInGBs: newSizeGb },
    });
    lastGrowAt = Date.now();
    log.warn(`autogrow: boot volume ampliato ${currentGb}GB → ${newSizeGb}GB (disco al ${usedPct.toFixed(0)}%)`);
    await broadcast(
      `Spazio disco ampliato a ${newSizeGb}GB: sarà disponibile al prossimo riavvio del server.`,
    ).catch(() => {});
  } catch (e) {
    log.error("autogrow: crescita boot volume fallita", e);
  }
}
