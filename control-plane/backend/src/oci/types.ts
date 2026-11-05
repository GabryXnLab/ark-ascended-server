// Astrazione del controllo istanza OCI: due implementazioni (mock e live).

export type InstanceState =
  | "RUNNING"
  | "STOPPED"
  | "STARTING"
  | "STOPPING"
  | "PROVISIONING"
  | "TERMINATED"
  | "UNKNOWN";

export interface InstanceInfo {
  state: InstanceState;
  ocid: string;
  publicIp: string | null;
  /**
   * Identifies the current power cycle where the provider can observe it
   * (docker: container StartedAt). Lets pollers notice a stop/start that
   * happened entirely between two polls.
   */
  bootId?: string;
}

export interface InstanceController {
  getInfo(): Promise<InstanceInfo>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
