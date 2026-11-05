// Factory: sceglie l'implementazione in base a INSTANCE_PROVIDER.
// Le implementazioni oci (oci-sdk) e docker sono importate in modo lazy.

import { config } from "../config.js";
import { MockInstanceController } from "./mock.js";
import type { InstanceController } from "./types.js";

let instance: InstanceController | null = null;

export async function getController(): Promise<InstanceController> {
  if (instance) return instance;
  switch (config.instanceProvider) {
    case "mock":
      instance = new MockInstanceController();
      break;
    case "docker": {
      const { DockerInstanceController } = await import("./docker.js");
      instance = new DockerInstanceController();
      break;
    }
    case "oci": {
      const { OciInstanceController } = await import("./live.js");
      instance = new OciInstanceController();
      break;
    }
  }
  return instance;
}

export type { InstanceController, InstanceInfo, InstanceState } from "./types.js";
