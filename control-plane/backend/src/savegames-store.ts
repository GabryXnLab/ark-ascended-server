// Persistenza dei "salvataggi": una riga per configurazione/profilo di cui esiste un
// backup su Object Storage (chiave deterministica `saves/<id>.tar.zst`, copia singola
// che si sovrascrive). Stesso pattern di persistenza atomica e mutex in-process di
// configs-store.ts.
//
// INDIPENDENTE dalle configurazioni: cancellare una GameConfiguration NON deve mai
// toccare questo store (per costruzione, nessuna funzione qui è chiamata da
// deleteConfig). Un salvataggio sopravvive alla cancellazione della sua config:
// `configId` diventa null ma `configName`/`map`/`mods` restano leggibili dallo snapshot.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface Savegame {
  id: string;              // = configId quando la config esiste ancora
  configId: string | null; // null se la config originaria è stata cancellata
  configName: string;      // snapshot, resta leggibile anche a config cancellata
  map: string;
  mods: number[];
  objectKey: string;       // "saves/<id>.tar.zst"
  sizeBytes: number | null;
  lastBackupAt: string | null;
  status: "ok" | "backup-failed";
}

export type SavegameUpsert = Omit<Savegame, "status"> & { status?: Savegame["status"] };

let cache: Savegame[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function load(): Promise<Savegame[]> {
  if (cache) return cache;
  try {
    const text = await fs.readFile(config.savegamesDataFile, "utf8");
    cache = JSON.parse(text) as Savegame[];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(data: Savegame[]): Promise<void> {
  await fs.mkdir(path.dirname(config.savegamesDataFile), { recursive: true });
  const tmp = `${config.savegamesDataFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, config.savegamesDataFile);
  cache = data;
}

/** Più recenti prima (per data ultimo backup). */
export async function listSavegames(): Promise<Savegame[]> {
  return [...(await load())].sort((a, b) => (b.lastBackupAt ?? "").localeCompare(a.lastBackupAt ?? ""));
}

export async function getSavegame(id: string): Promise<Savegame | undefined> {
  return (await load()).find((s) => s.id === id);
}

/** Crea o aggiorna il record di un salvataggio (chiave: id). */
export async function upsertSavegame(input: SavegameUpsert): Promise<Savegame> {
  return withLock(async () => {
    const data = await load();
    const existing = data.find((s) => s.id === input.id);
    const record: Savegame = { status: "ok", ...input };
    if (existing) {
      Object.assign(existing, record);
      await save(data);
      return existing;
    }
    data.push(record);
    await save(data);
    return record;
  });
}

export async function deleteSavegame(id: string): Promise<boolean> {
  return withLock(async () => {
    const data = await load();
    const before = data.length;
    const next = data.filter((s) => s.id !== id);
    if (next.length === before) return false;
    await save(next);
    return true;
  });
}
