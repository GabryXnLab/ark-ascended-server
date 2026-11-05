// Coda di operazioni fatte mentre il game server è spento (whitelist admin e
// selezione configurazione). Le rotte corrispondenti a server acceso parlano
// direttamente con l'agent; a server spento accodano qui e boot-sync.ts applica
// in ordine non appena l'istanza torna RUNNING e l'agent è raggiungibile.
// Persistenza atomica e mutex in-process come configs-store.ts/requests-store.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { log } from "./logger.js";

export type BootQueueKind = "selectConfig" | "adminWhitelist";

const BOOT_QUEUE_KINDS: readonly string[] = ["selectConfig", "adminWhitelist"] satisfies BootQueueKind[];

export interface SelectConfigPayload {
  id: string;
}

export interface AdminWhitelistPayload {
  accountIds: string[];
}

export type BootQueuePayload = SelectConfigPayload | AdminWhitelistPayload;

export interface BootQueueOp {
  id: string;
  kind: BootQueueKind;
  payload: BootQueuePayload;
  queuedAt: string;
}

let cache: BootQueueOp[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function load(): Promise<BootQueueOp[]> {
  if (cache) return cache;
  try {
    const text = await fs.readFile(config.bootQueueDataFile, "utf8");
    cache = withoutRetiredOps(JSON.parse(text) as BootQueueOp[]);
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * Le operazioni dirette su mod, ini e installazione mappa sono state ritirate
 *: le modifiche passano solo dalle configurazioni versionate. Una voce
 * residua di un file scritto da un backend precedente viene scartata invece di
 * bloccare la coda o riapplicare contenuti fuori revisione.
 */
function withoutRetiredOps(ops: BootQueueOp[]): BootQueueOp[] {
  if (!Array.isArray(ops)) return [];
  return ops.filter((op) => {
    if (BOOT_QUEUE_KINDS.includes(op?.kind)) return true;
    log.warn(`Operazione di boot-queue ritirata scartata: ${String(op?.kind)} (${String(op?.id)})`);
    return false;
  });
}

async function save(data: BootQueueOp[]): Promise<void> {
  await fs.mkdir(path.dirname(config.bootQueueDataFile), { recursive: true });
  const tmp = `${config.bootQueueDataFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, config.bootQueueDataFile);
  cache = data;
}

/** In ordine di accodamento (FIFO): il primo è il prossimo che boot-sync applicherà. */
export async function listBootQueue(): Promise<BootQueueOp[]> {
  return [...(await load())];
}

/** Bersaglio di un'operazione: due operazioni con lo stesso bersaglio si sostituiscono
 * a vicenda invece di accumularsi (vedi enqueueBootOp). */
function targetKey(kind: BootQueueKind, payload: BootQueuePayload): string {
  switch (kind) {
    case "selectConfig":
      return "selectConfig"; // una sola mappa/configurazione è mai attiva alla volta
    case "adminWhitelist":
      return "adminWhitelist"; // lista globale, indipendente dal profilo attivo
  }
}

/**
 * Accoda un'operazione, sostituendo un'eventuale operazione già in coda per lo stesso
 * bersaglio: mentre il server è spento conta solo l'ultima intenzione dell'utente.
 */
export async function enqueueBootOp(kind: BootQueueKind, payload: BootQueuePayload): Promise<BootQueueOp> {
  return withLock(async () => {
    const data = await load();
    const key = targetKey(kind, payload);
    const next = data.filter((op) => targetKey(op.kind, op.payload) !== key);
    const op: BootQueueOp = { id: randomUUID(), kind, payload, queuedAt: new Date().toISOString() };
    // La whitelist deve esistere prima che un'eventuale selectConfig avvii ASA:
    // ha quindi priorità sulle operazioni di gameplay già accodate.
    if (kind === "adminWhitelist") next.unshift(op);
    else next.push(op);
    await save(next);
    return op;
  });
}

export async function dequeueBootOp(id: string): Promise<void> {
  await withLock(async () => {
    const data = await load();
    const next = data.filter((op) => op.id !== id);
    await save(next);
  });
}

/** id della configurazione in coda per la selezione (kind "selectConfig"), se presente. */
export async function getQueuedConfigSelectId(): Promise<string | null> {
  const op = (await load()).find((o) => o.kind === "selectConfig");
  return op ? (op.payload as SelectConfigPayload).id : null;
}

export async function clearQueuedConfigSelect(): Promise<void> {
  await withLock(async () => {
    const data = await load();
    const next = data.filter((op) => op.kind !== "selectConfig");
    await save(next);
  });
}

export async function clearQueuedAdminWhitelist(): Promise<void> {
  await withLock(async () => {
    const data = await load();
    const next = data.filter((op) => op.kind !== "adminWhitelist");
    await save(next);
  });
}
