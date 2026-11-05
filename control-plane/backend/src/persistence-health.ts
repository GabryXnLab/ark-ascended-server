import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PersistenceHealth {
  ok: boolean;
  error?: string;
}

/**
 * Verifica le stesse operazioni usate dagli store JSON (scrittura temporanea e
 * rename atomico). Un semplice check HTTP non deve dichiarare sano un container
 * che serve la PWA ma non può persistere accensioni o configurazioni.
 */
export async function checkPersistence(dataDir: string): Promise<PersistenceHealth> {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const source = path.join(dataDir, `.health-${suffix}.tmp`);
  const destination = path.join(dataDir, `.health-${suffix}.ok`);

  try {
    await mkdir(dataDir, { recursive: true });
    await access(dataDir, constants.R_OK | constants.W_OK);
    await writeFile(source, "ok", { mode: 0o600 });
    if (await readFile(source, "utf8") !== "ok") throw new Error("verifica lettura persistenza fallita");
    await rename(source, destination);
    await rm(destination);
    return { ok: true };
  } catch (error) {
    await rm(source, { force: true }).catch(() => undefined);
    await rm(destination, { force: true }).catch(() => undefined);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "persistenza non disponibile",
    };
  }
}
