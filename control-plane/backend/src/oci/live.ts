// Implementazione live con OCI SDK (oci-core/oci-common).
// Auth via instance principal (produzione) o config file (~/.oci/config, dev).

import * as core from "oci-core";
import { config } from "../config.js";
import { log } from "../logger.js";
import { buildAuthProvider } from "./auth.js";
import type { InstanceController, InstanceInfo, InstanceState } from "./types.js";

function mapState(s: string | undefined): InstanceState {
  switch (s) {
    case "RUNNING": return "RUNNING";
    case "STOPPED": return "STOPPED";
    case "STARTING": return "STARTING";
    case "STOPPING": return "STOPPING";
    case "PROVISIONING": return "PROVISIONING";
    case "TERMINATED":
    case "TERMINATING": return "TERMINATED";
    default: return "UNKNOWN";
  }
}

export class OciInstanceController implements InstanceController {
  private compute!: core.ComputeClient;
  private vnet!: core.VirtualNetworkClient;
  private blockstorage!: core.BlockstorageClient;
  private ready: Promise<void>;
  private readonly instanceId: string;

  constructor() {
    this.instanceId = config.gameInstanceOcid;
    if (!this.instanceId) throw new Error("GAME_INSTANCE_OCID non impostato");
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const provider = await buildAuthProvider();
    this.compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
    this.vnet = new core.VirtualNetworkClient({ authenticationDetailsProvider: provider });
    this.blockstorage = new core.BlockstorageClient({ authenticationDetailsProvider: provider });
  }

  async getInfo(): Promise<InstanceInfo> {
    await this.ready;
    const { instance } = await this.compute.getInstance({ instanceId: this.instanceId });
    const state = mapState(instance.lifecycleState);
    let publicIp: string | null = null;
    if (state === "RUNNING") {
      publicIp = await this.resolvePublicIp(instance.compartmentId).catch(() => null);
    }
    return { state, ocid: this.instanceId, publicIp };
  }

  private async resolvePublicIp(compartmentId: string): Promise<string | null> {
    const att = await this.compute.listVnicAttachments({
      compartmentId,
      instanceId: this.instanceId,
    });
    const vnicId = att.items.find((a) => a.vnicId)?.vnicId;
    if (!vnicId) return null;
    const { vnic } = await this.vnet.getVnic({ vnicId });
    return vnic.publicIp ?? null;
  }

  async start(): Promise<void> {
    await this.ready;
    await this.setBootVolumeVpus(config.gameBootActiveVpus).catch((error) => {
      // Un problema al tuning non deve trasformarsi in indisponibilità: la VM
      // può avviarsi correttamente anche al tier Balanced.
      log.warn(`Impossibile impostare ${config.gameBootActiveVpus} VPU/GB prima dello START; procedo`, error);
    });
    log.info("OCI instanceAction START");
    try {
      await this.compute.instanceAction({ instanceId: this.instanceId, action: "START" });
    } catch (error) {
      // In particolare Out of host capacity può lasciare la VM spenta per
      // minuti: non pagare il tier attivo durante il backoff.
      await this.setBootVolumeVpus(config.gameBootIdleVpus).catch((restoreError) => {
        log.warn(`Rollback a ${config.gameBootIdleVpus} VPU/GB dopo START fallito non riuscito`, restoreError);
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.ready;
    // SOFTSTOP = shutdown ordinato del SO (l'agent fa già saveworld prima).
    log.info("OCI instanceAction SOFTSTOP");
    await this.compute.instanceAction({ instanceId: this.instanceId, action: "SOFTSTOP" });
    await this.setBootVolumeVpus(config.gameBootIdleVpus).catch((error) => {
      log.warn(`Impossibile ripristinare ${config.gameBootIdleVpus} VPU/GB dopo lo SOFTSTOP`, error);
    });
  }

  private async setBootVolumeVpus(vpusPerGb: number): Promise<void> {
    const { instance } = await this.compute.getInstance({ instanceId: this.instanceId });
    const attachments = await this.compute.listBootVolumeAttachments({
      compartmentId: instance.compartmentId,
      availabilityDomain: instance.availabilityDomain,
      instanceId: this.instanceId,
    });
    const bootVolumeId = attachments.items[0]?.bootVolumeId;
    if (!bootVolumeId) throw new Error("boot volume dell'istanza non trovato");
    const current = (await this.blockstorage.getBootVolume({ bootVolumeId })).bootVolume.vpusPerGB;
    if (current === vpusPerGb) return;
    await this.blockstorage.updateBootVolume({
      bootVolumeId,
      updateBootVolumeDetails: { vpusPerGB: vpusPerGb },
    });
    log.info(`Boot volume OCI: ${current ?? "?"} → ${vpusPerGb} VPU/GB`);
  }
}
