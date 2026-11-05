// Whitelist amministratori nativa di ARK: Survival Ascended.
//
// ASA legge un EOS/ARK account id per riga da
// ShooterGame/Saved/AllowedCheaterAccountIDs.txt. Lo stesso contenuto viene
// servito all'AdminListURL loopback di ASA per il reload dinamico. Gli account
// presenti possono usare i comandi admin senza digitare
// `enablecheats <password>`; la password RCON resta quindi lunga, segreta e
// indipendente dall'esperienza controller.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const MAX_ADMIN_ACCOUNT_IDS = 100;
export const ADMIN_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

let writeTail: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const task = writeTail.then(fn, fn);
  writeTail = task.then(() => undefined, () => undefined);
  return task;
}

/** Valida, trimma e deduplica mantenendo l'ordine scelto dall'admin. */
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

/** Formato text/plain richiesto da AdminListURL: un account per riga. */
export function formatAdminWhitelistText(input: unknown): string {
  const accountIds = normalizeAdminAccountIds(input);
  return accountIds.length > 0 ? `${accountIds.join("\n")}\n` : "";
}

export async function readAdminWhitelist(): Promise<string[]> {
  try {
    const content = await fs.readFile(config.allowedCheaterAccountsFile, "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return normalizeAdminAccountIds(lines);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Sostituisce l'intero file in modo atomico. Il file non contiene password, ma
 * concede privilegi completi nel gioco: resta quindi leggibile soltanto
 * dall'utente runtime del container (0600), come gli altri dati amministrativi.
 */
export async function replaceAdminWhitelist(input: unknown): Promise<string[]> {
  const accountIds = normalizeAdminAccountIds(input);
  return withWriteLock(async () => {
    const target = config.allowedCheaterAccountsFile;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    const content = formatAdminWhitelistText(accountIds);
    try {
      await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(tmp, target);
      await fs.chmod(target, 0o600);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    return accountIds;
  });
}
