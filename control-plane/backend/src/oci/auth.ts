// Provider di autenticazione OCI condiviso tra i client SDK (compute, usage…).
// Instance principal in produzione, config file (~/.oci/config) in dev.

import * as common from "oci-common";
import { config } from "../config.js";
import { log } from "../logger.js";

export async function buildAuthProvider(): Promise<common.AuthenticationDetailsProvider> {
  if (config.ociMode === "instance_principal") {
    log.info("OCI auth: instance principal");
    return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  }
  log.info(`OCI auth: config file (profilo ${config.ociProfile})`);
  return new common.ConfigFileAuthenticationDetailsProvider(undefined, config.ociProfile);
}
