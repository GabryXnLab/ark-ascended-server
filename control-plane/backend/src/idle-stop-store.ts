// Timer auto-stop desiderato per il server legacy. L'agent applica il conteggio
// ma lo tiene solo in memoria: la fonte autorevole è questo file sul control
// plane, modificabile anche a VM spenta e riapplicato da boot-sync a ogni avvio.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const MAX_IDLE_STOP_MINUTES = 24 * 60;

export interface IdleStopState {
  idleStopMinutes: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

let cache: IdleStopState | undefined;
let writeTail: Promise<unknown> = Promise.resolve();

export function normalizeIdleStopMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_IDLE_STOP_MINUTES) {
    throw new Error(`'idleStopMinutes' deve essere un intero fra 0 e ${MAX_IDLE_STOP_MINUTES}`);
  }
  return minutes;
}

export async function getIdleStopState(): Promise<IdleStopState> {
  if (cache) return { ...cache };
  try {
    const parsed = JSON.parse(await fs.readFile(config.idleStopDataFile, "utf8")) as Partial<IdleStopState>;
    cache = {
      idleStopMinutes: normalizeIdleStopMinutes(parsed.idleStopMinutes),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      updatedBy: parsed.updatedBy && typeof parsed.updatedBy.id === "string" && typeof parsed.updatedBy.name === "string"
        ? { id: parsed.updatedBy.id, name: parsed.updatedBy.name }
        : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    cache = { idleStopMinutes: config.defaultIdleStopMinutes, updatedAt: null, updatedBy: null };
  }
  return { ...cache };
}

export async function saveIdleStopMinutes(
  input: unknown,
  updatedBy: { id: string; name: string },
): Promise<IdleStopState> {
  const idleStopMinutes = normalizeIdleStopMinutes(input);
  const task = writeTail.then(async () => {
    const state: IdleStopState = {
      idleStopMinutes,
      updatedAt: new Date().toISOString(),
      updatedBy: { id: updatedBy.id, name: updatedBy.name },
    };
    await fs.mkdir(path.dirname(config.idleStopDataFile), { recursive: true });
    const tmp = `${config.idleStopDataFile}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, config.idleStopDataFile);
    cache = state;
    return { ...state };
  });
  writeTail = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * Riallinea l'agent al valore desiderato. Ritorna true se il valore sull'agent
 * coincide (già o dopo la scrittura), null se l'agent non è raggiungibile.
 * Scrive solo in caso di differenza: l'agent azzera il conteggio a ogni set.
 */
export async function reconcileAgentIdleStop(
  desiredMinutes: number,
  readAgent: () => Promise<{ idleStopMinutes: number } | null>,
  writeAgent: (minutes: number) => Promise<unknown>,
): Promise<boolean | null> {
  const live = await readAgent();
  if (!live) return null;
  if (live.idleStopMinutes === desiredMinutes) return true;
  await writeAgent(desiredMinutes);
  return true;
}
