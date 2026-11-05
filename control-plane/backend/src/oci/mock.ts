// Implementazione mock: simula transizioni STOPPED→STARTING→RUNNING e ritorno.
// Permette di sviluppare backend/PWA senza credenziali OCI.

import { log } from "../logger.js";
import type { InstanceController, InstanceInfo, InstanceState } from "./types.js";

export class MockInstanceController implements InstanceController {
  private state: InstanceState = "STOPPED";
  private publicIp: string | null = null;

  async getInfo(): Promise<InstanceInfo> {
    return { state: this.state, ocid: "ocid1.instance.mock", publicIp: this.publicIp };
  }

  async start(): Promise<void> {
    if (this.state === "RUNNING" || this.state === "STARTING") return;
    log.info("[mock OCI] START → STARTING");
    this.state = "STARTING";
    setTimeout(() => {
      this.state = "RUNNING";
      this.publicIp = "203.0.113.10"; // IP di esempio (TEST-NET-3)
      log.info("[mock OCI] RUNNING");
    }, 4000);
  }

  async stop(): Promise<void> {
    if (this.state === "STOPPED" || this.state === "STOPPING") return;
    log.info("[mock OCI] STOP → STOPPING");
    this.state = "STOPPING";
    setTimeout(() => {
      this.state = "STOPPED";
      this.publicIp = null;
      log.info("[mock OCI] STOPPED");
    }, 3000);
  }
}
