// Esecuzione controllata di comandi di sistema (systemctl, oci).
// In modalità mock non esegue nulla: logga e ritorna output finto.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isMock } from "./config.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Esegue un comando senza shell (niente injection). In mock, simula successo.
 */
export async function run(
  cmd: string,
  args: string[],
  opts?: { mockStdout?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number },
): Promise<RunResult> {
  if (isMock()) {
    log.info(`[mock] ${cmd} ${args.join(" ")}`);
    return { stdout: opts?.mockStdout ?? "", stderr: "", code: 0 };
  }
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: opts?.timeoutMs ?? 30_000,
      env: opts?.env,
      maxBuffer: opts?.maxBuffer ?? 10 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(e),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}
