import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import { getController } from "./oci/index.js";

export interface PowerStartStatus {
  pending: boolean;
  requestId: string | null;
  attempt: number;
  requestedAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
}

type PersistedPowerStart = Omit<PowerStartStatus, "pending"> & { pending: true };

const idleStatus = (): PowerStartStatus => ({
  pending: false,
  requestId: null,
  attempt: 0,
  requestedAt: null,
  nextAttemptAt: null,
  lastError: null,
});

export function isOutOfCapacity(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; statusCode?: unknown };
  return candidate.statusCode === 500
    && typeof candidate.message === "string"
    && /out of (host )?capacity/i.test(candidate.message);
}

export class PowerStartCoordinator {
  private state: PowerStartStatus = idleStatus();
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private operation: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly stateFile: string,
    private readonly retryBaseSec: number,
    private readonly retryMaxSec: number,
    private readonly controller = getController,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.load().finally(() => {
      this.initialized = true;
      this.initializing = null;
    });
    await this.initializing;
  }

  async getStatus(): Promise<PowerStartStatus> {
    await this.init();
    return { ...this.state };
  }

  async reconcileInstanceState(instanceState: string): Promise<PowerStartStatus> {
    await this.init();
    if (this.state.pending && (instanceState === "RUNNING" || instanceState === "STARTING")) {
      await this.serial(() => this.clear());
    }
    return { ...this.state };
  }

  async requestStart(): Promise<PowerStartStatus & { accepted: boolean }> {
    await this.init();
    return this.serial(async () => {
      const ctrl = await this.controller();
      const { state } = await ctrl.getInfo();
      if (state === "RUNNING" || state === "STARTING") {
        await this.clear();
        return { ...this.state, accepted: false };
      }
      if (this.state.pending) return { ...this.state, accepted: false };

      const pendingState: PowerStartStatus = {
        pending: true,
        requestId: randomUUID(),
        attempt: 0,
        requestedAt: new Date().toISOString(),
        nextAttemptAt: null,
        lastError: null,
      };
      this.state = pendingState;
      try {
        await this.persist();
      } catch (error) {
        // Non lasciare in memoria una richiesta fantasma con tentativo 0: in
        // assenza di persistenza non esiste alcun retry affidabile.
        this.state = idleStatus();
        throw error;
      }
      const requestId = pendingState.requestId;
      return { ...(await this.attemptStart(true)), requestId, accepted: true };
    });
  }

  async cancel(): Promise<void> {
    await this.init();
    await this.serial(() => this.clear());
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as Partial<PersistedPowerStart>;
      if (parsed.pending === true && typeof parsed.requestedAt === "string") {
        this.state = {
          pending: true,
          requestId: typeof parsed.requestId === "string" ? parsed.requestId : randomUUID(),
          attempt: Number.isInteger(parsed.attempt) && Number(parsed.attempt) >= 0 ? Number(parsed.attempt) : 0,
          requestedAt: parsed.requestedAt,
          nextAttemptAt: typeof parsed.nextAttemptAt === "string" ? parsed.nextAttemptAt : null,
          lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
        };
        log.info("Richiesta di accensione pendente ripristinata dal disco");
        this.scheduleFromState();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") log.warn("Impossibile leggere lo stato accensione persistente", error);
    }
  }

  private async attemptStart(propagateUnexpected: boolean): Promise<PowerStartStatus> {
    if (!this.state.pending) return { ...this.state };
    this.cancelTimer();
    this.state.attempt += 1;
    this.state.nextAttemptAt = null;
    this.state.lastError = null;
    await this.persist();

    try {
      const ctrl = await this.controller();
      const { state } = await ctrl.getInfo();
      if (state !== "RUNNING" && state !== "STARTING") await ctrl.start();
      await this.clear();
      return { ...this.state };
    } catch (error) {
      if (!isOutOfCapacity(error)) {
        await this.clear();
        if (propagateUnexpected) throw error;
        log.error("Retry accensione fallito con errore non recuperabile", error);
        return { ...this.state };
      }

      const exponent = Math.min(Math.max(this.state.attempt - 1, 0), 8);
      const delaySec = Math.min(this.retryBaseSec * 2 ** exponent, this.retryMaxSec);
      this.state.lastError = "Capacità temporaneamente esaurita; l'accensione verrà ritentata automaticamente.";
      this.state.nextAttemptAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await this.persist();
      log.warn(`Capacità esaurita: nuovo tentativo di accensione tra ${delaySec}s`);
      this.schedule(delaySec * 1000);
      return { ...this.state };
    }
  }

  private scheduleFromState(): void {
    const due = this.state.nextAttemptAt ? Date.parse(this.state.nextAttemptAt) : Date.now();
    this.schedule(Math.max(0, due - Date.now()));
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    // Node limita setTimeout a un intero signed 32-bit. Un file di stato
    // corrotto o modificato a mano con una data molto futura non deve causare
    // TimeoutOverflowWarning né trasformarsi in un retry immediato.
    const safeDelayMs = Math.min(Math.max(0, delayMs), 2_147_483_647);
    this.timer = setTimeout(() => {
      void this.serial(() => this.attemptStart(false)).catch((error) => {
        log.error("Scheduler retry accensione fallito", error);
      });
    }, safeDelayMs);
    this.timer.unref?.();
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async clear(): Promise<void> {
    this.cancelTimer();
    this.state = idleStatus();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.${process.pid}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(tempFile, this.stateFile);
  }

  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.operation.then(fn, fn);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const powerStart = new PowerStartCoordinator(
  config.powerStartStateFile,
  config.ociStartRetryBaseSec,
  config.ociStartRetryMaxSec,
);
