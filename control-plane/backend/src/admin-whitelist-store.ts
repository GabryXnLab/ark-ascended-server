// Stato desiderato della whitelist amministratori ASA.
//
// Vive sul control plane (sempre acceso) così una modifica fatta dalla PWA a
// game server spento può essere accodata e materializzata sul volume del game
// server al prossimo boot. Non è un segreto, ma concede privilegi completi e
// viene quindi esposta soltanto dalle rotte admin.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const MAX_ADMIN_ACCOUNT_IDS = 100;
export const ADMIN_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

export interface AdminWhitelistState {
  accountIds: string[];
  updatedAt: string;
  updatedBy: { id: string; name: string };
}

let cache: AdminWhitelistState | null | undefined;
let writeTail: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const task = writeTail.then(fn, fn);
  writeTail = task.then(() => undefined, () => undefined);
  return task;
}

export function normalizeAdminAccountIds(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("'accountIds' deve essere un array");
  if (input.length > MAX_ADMIN_ACCOUNT_IDS) {
    throw new Error(`sono consentiti al massimo ${MAX_ADMIN_ACCOUNT_IDS} account amministratori`);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of input.entries()) {
    if (typeof value !== "string") throw new Error(`accountIds[${index}] deve essere una stringa`);
    const id = value.trim();
    if (!ADMIN_ACCOUNT_ID_PATTERN.test(id)) {
      throw new Error(`accountIds[${index}] deve contenere esattamente 32 caratteri alfanumerici`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function load(): Promise<AdminWhitelistState | null> {
  if (cache !== undefined) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(config.adminWhitelistDataFile, "utf8")) as AdminWhitelistState;
    cache = {
      accountIds: normalizeAdminAccountIds(parsed.accountIds),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      updatedBy: {
        id: typeof parsed.updatedBy?.id === "string" ? parsed.updatedBy.id : "unknown",
        name: typeof parsed.updatedBy?.name === "string" ? parsed.updatedBy.name : "Sconosciuto",
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") cache = null;
    else throw error;
  }
  return cache;
}

export async function getAdminWhitelistState(): Promise<AdminWhitelistState | null> {
  const state = await load();
  return state ? structuredClone(state) : null;
}

export async function saveAdminWhitelistState(
  input: unknown,
  updatedBy: { id: string; name: string },
): Promise<AdminWhitelistState> {
  const accountIds = normalizeAdminAccountIds(input);
  return withWriteLock(async () => {
    const state: AdminWhitelistState = {
      accountIds,
      updatedAt: new Date().toISOString(),
      updatedBy: { id: updatedBy.id, name: updatedBy.name },
    };
    await fs.mkdir(path.dirname(config.adminWhitelistDataFile), { recursive: true });
    const tmp = `${config.adminWhitelistDataFile}.tmp-${process.pid}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, config.adminWhitelistDataFile);
      await fs.chmod(config.adminWhitelistDataFile, 0o600);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    cache = state;
    return structuredClone(state);
  });
}
