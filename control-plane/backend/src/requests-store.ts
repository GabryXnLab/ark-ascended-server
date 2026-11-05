// Coda delle revisioni configurazione: modifiche proposte da chi ha accesso
// "con revisione" a un profilo, in attesa di approvazione admin. Persistenza
// atomica e mutex in-process come configs-store.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { log } from "./logger.js";

export type PendingRequestKind = "config";
export type PendingRequestStatus = "pending" | "approved" | "rejected";

export interface ConfigPayload {
  id?: string;
  /** Revisione osservata dall'editor: impedisce che l'approvazione di una
   * proposta vecchia sovrascriva modifiche più recenti. */
  baseRevision?: number;
  name: string;
  map: string;
  mods: number[];
  iniOverrides: {
    gus: { values: Record<string, string>; sections: Record<string, string>; raw?: string; managedKeys?: string[] };
    game: { values: Record<string, string>; sections: Record<string, string>; raw?: string; managedKeys?: string[] };
    launchArgs?: string;
  };
}

export interface PendingRequest {
  id: string;
  kind: PendingRequestKind;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  status: PendingRequestStatus;
  payload: ConfigPayload;
  reviewedAt?: string;
  reviewNote?: string;
}

let cache: PendingRequest[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function load(): Promise<PendingRequest[]> {
  if (cache) return cache;
  try {
    const text = await fs.readFile(config.requestsDataFile, "utf8");
    cache = withoutRetiredRequests(JSON.parse(text) as PendingRequest[]);
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * Le proposte dirette su mod, ini, installazione mappa e cancellazione sono state
 * ritirate. Record residui di backend precedenti vengono scartati: non
 * sarebbero più approvabili e la PWA non saprebbe descriverli.
 */
function withoutRetiredRequests(requests: PendingRequest[]): PendingRequest[] {
  if (!Array.isArray(requests)) return [];
  return requests.filter((request) => {
    if (request?.kind === "config") return true;
    log.warn(`Richiesta ritirata scartata: ${String(request?.kind)} (${String(request?.id)}, ${String(request?.status)})`);
    return false;
  });
}

async function save(data: PendingRequest[]): Promise<void> {
  await fs.mkdir(path.dirname(config.requestsDataFile), { recursive: true });
  const tmp = `${config.requestsDataFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, config.requestsDataFile);
  cache = data;
}

/** Più recenti prima. */
export async function listRequests(): Promise<PendingRequest[]> {
  return [...(await load())].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function createRequest(
  kind: PendingRequestKind,
  submittedBy: { id: string; name: string },
  payload: PendingRequest["payload"],
): Promise<PendingRequest> {
  return withLock(async () => {
    const data = await load();
    const request: PendingRequest = {
      id: randomUUID(),
      kind,
      submittedBy,
      submittedAt: new Date().toISOString(),
      status: "pending",
      payload,
    };
    data.push(request);
    await save(data);
    return request;
  });
}

export async function getRequest(id: string): Promise<PendingRequest | undefined> {
  return (await load()).find((r) => r.id === id);
}

/** Non tocca lo status se non passa per questa funzione: un apply fallito lascia il record "pending". */
export async function markRequest(
  id: string,
  status: "approved" | "rejected",
  reviewNote?: string,
): Promise<PendingRequest | undefined> {
  return withLock(async () => {
    const data = await load();
    const request = data.find((r) => r.id === id);
    if (!request) return undefined;
    request.status = status;
    request.reviewedAt = new Date().toISOString();
    if (reviewNote !== undefined) request.reviewNote = reviewNote;
    await save(data);
    return request;
  });
}
