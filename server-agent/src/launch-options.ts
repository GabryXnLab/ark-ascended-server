// Argomenti avanzati ASA per-profilo. Sono salvati uno per riga e il launcher
// Bash li carica in un array: nessun eval/word splitting e quindi nessuna
// interpretazione da parte della shell.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { launchArgsErrors, splitLaunchArgs } from "./shared/config-rules.js";

export function parseLaunchArgs(raw: string | undefined): string[] {
  const [invalid] = launchArgsErrors(raw);
  if (invalid) throw new Error(invalid);
  return splitLaunchArgs(raw);
}

export async function replaceLaunchArgs(raw: string | undefined): Promise<void> {
  const args = parseLaunchArgs(raw);
  await fs.mkdir(path.dirname(config.launchArgsFile), { recursive: true });
  await fs.writeFile(config.launchArgsFile, args.length > 0 ? `${args.join("\n")}\n` : "", "utf8");
}
