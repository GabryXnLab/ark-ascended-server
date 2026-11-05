// Client minimale dell'Engine API di Docker: solo gli endpoint che servono per
// accendere/spegnere il container del gioco. Zero dipendenze (dockerode porta
// ~15 pacchetti transitivi per tre chiamate).

import http from "node:http";

export class DockerApiError extends Error {
  /** 0 = errore di connessione/timeout, altrimenti lo status HTTP dell'Engine. */
  constructor(
    readonly statusCode: number,
    message: string,
    /** Se presente è un messaggio per l'utente della PWA, non un dettaglio tecnico. */
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = "DockerApiError";
  }
}

export type DockerEndpoint =
  | { socketPath: string }
  | { host: string; port: number };

export function parseDockerHost(value: string): DockerEndpoint {
  const raw = value.trim();
  if (raw.startsWith("/")) return { socketPath: raw };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DOCKER_HOST="${value}" non valido: usa unix:///percorso o tcp://host:porta`);
  }
  if (url.protocol === "unix:") {
    if (!url.pathname || url.pathname === "/") throw new Error(`DOCKER_HOST="${value}" senza percorso del socket`);
    return { socketPath: url.pathname };
  }
  if (url.protocol === "tcp:" || url.protocol === "http:") {
    if (!url.hostname) throw new Error(`DOCKER_HOST="${value}" senza host`);
    return { host: url.hostname, port: url.port ? Number(url.port) : 2375 };
  }
  throw new Error(`DOCKER_HOST="${value}": schema ${url.protocol} non supportato (usa unix o tcp)`);
}

export interface ContainerState {
  id: string;
  /** created | running | paused | restarting | removing | exited | dead */
  status: string;
  /** State.StartedAt: changes on every start, identifies one power cycle. */
  startedAt: string;
}

interface EngineOptions {
  endpoint: DockerEndpoint;
  apiVersion: string;
  /** Timeout delle chiamate rapide (inspect/start). */
  timeoutMs?: number;
}

export class DockerEngine {
  constructor(private readonly opts: EngineOptions) {}

  /** null se il container non esiste. Dall'inspect si legge solo State/Id: l'env contiene segreti. */
  async inspect(name: string): Promise<ContainerState | null> {
    const res = await this.request("GET", `/containers/${encodeURIComponent(name)}/json`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw this.unexpected("inspect", res);
    const body = JSON.parse(res.body) as { Id?: unknown; State?: { Status?: unknown; StartedAt?: unknown } };
    return {
      id: String(body.Id ?? ""),
      status: String(body.State?.Status ?? ""),
      startedAt: String(body.State?.StartedAt ?? ""),
    };
  }

  /** 204 e 304 (già avviato) sono entrambi successo. 404 solleva DockerApiError(404). */
  async start(name: string): Promise<void> {
    const res = await this.request("POST", `/containers/${encodeURIComponent(name)}/start`);
    if (res.status === 204 || res.status === 304) return;
    if (res.status === 404) throw new DockerApiError(404, `container ${name} non trovato`);
    throw this.unexpected("start", res);
  }

  /** Senza `t`: l'Engine usa lo stop_grace_period del container. */
  async stop(name: string, timeoutMs: number): Promise<void> {
    const res = await this.request("POST", `/containers/${encodeURIComponent(name)}/stop`, timeoutMs);
    if (res.status === 204 || res.status === 304) return;
    if (res.status === 404) throw new DockerApiError(404, `container ${name} non trovato`);
    throw this.unexpected("stop", res);
  }

  private unexpected(op: string, res: { status: number; body: string }): DockerApiError {
    let detail = res.body.slice(0, 200);
    try {
      const parsed = JSON.parse(res.body) as { message?: unknown };
      if (typeof parsed.message === "string") detail = parsed.message;
    } catch { /* corpo non JSON */ }
    return new DockerApiError(res.status, `Docker ${op}: HTTP ${res.status} ${detail}`.trim());
  }

  private request(method: string, path: string, timeoutMs = this.opts.timeoutMs ?? 10_000): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { ...this.opts.endpoint, method, path: `/${this.opts.apiVersion}${path}`, headers: { Host: "docker" } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", (e) => reject(new DockerApiError(0, `Docker non raggiungibile: ${e.message}`)));
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout dopo ${timeoutMs} ms`)));
      req.on("error", (e) => reject(new DockerApiError(0, `Docker non raggiungibile: ${e.message}`)));
      req.end();
    });
  }
}
