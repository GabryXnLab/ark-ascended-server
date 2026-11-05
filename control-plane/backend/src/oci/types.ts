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
}

export interface InstanceController {
  getInfo(): Promise<InstanceInfo>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
