// Controller per la modalità locale: accende/spegne il container del gioco che
// Compose ha già creato. Il pannello non lo crea mai: create = root sull'host.

import { config } from "../config.js";
import { log } from "../logger.js";
import { DockerApiError, DockerEngine, parseDockerHost } from "./docker-engine.js";
import type { InstanceController, InstanceInfo, InstanceState } from "./types.js";

const MISSING_MESSAGE = (name: string) =>
  `Il container del game server "${name}" non esiste: crealo con "docker compose --profile game create game-server" e riprova.`;

export function mapContainerStatus(status: string, stopInProgress: boolean): InstanceState {
  switch (status) {
    case "running": return stopInProgress ? "STOPPING" : "RUNNING";
    case "restarting": return "STARTING";
    case "created":
    case "exited": return "STOPPED";
    case "removing": return "STOPPING";
    default: return "UNKNOWN"; // paused, dead
  }
}

export class DockerInstanceController implements InstanceController {
  private stopInProgress = false;
  private warnedMissing = false;
  private readonly engine: DockerEngine;

  constructor(
    private readonly name = config.gameContainerName,
    engine?: DockerEngine,
    private readonly stopTimeoutMs = config.dockerStopTimeoutSec * 1000,
    private readonly publicHost = config.publicHost,
  ) {
    this.engine = engine ?? new DockerEngine({
      endpoint: parseDockerHost(config.dockerHost),
      apiVersion: config.dockerApiVersion,
    });
  }

  async getInfo(): Promise<InstanceInfo> {
    const ocid = `docker:${this.name}`;
    const container = await this.engine.inspect(this.name);
    if (!container) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        log.warn(MISSING_MESSAGE(this.name));
      }
      return { state: "UNKNOWN", ocid, publicIp: null };
    }
    this.warnedMissing = false;
    const state = mapContainerStatus(container.status, this.stopInProgress);
    return { state, ocid, publicIp: state === "RUNNING" ? this.publicHost || null : null };
  }

  async start(): Promise<void> {
    try {
      await this.engine.start(this.name);
    } catch (error) {
      if (error instanceof DockerApiError && error.statusCode === 404) {
        throw new DockerApiError(404, error.message, MISSING_MESSAGE(this.name));
      }
      throw error;
    }
  }

  // Bloccante fino all'uscita del container: docker stop attende il grace period
  // (SIGTERM → shutdown dell'agent); nel frattempo getInfo() riporta STOPPING.
  async stop(): Promise<void> {
    this.stopInProgress = true;
    try {
      await this.engine.stop(this.name, this.stopTimeoutMs);
    } catch (error) {
      if (error instanceof DockerApiError && error.statusCode === 404) {
        log.warn(MISSING_MESSAGE(this.name));
        return;
      }
      throw error;
    } finally {
      this.stopInProgress = false;
    }
  }
}
