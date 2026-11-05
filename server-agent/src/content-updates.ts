import { promises as fs } from "node:fs";
import path from "node:path";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { run, type RunResult } from "./shell.js";

export interface ExpectedModVersion {
  id: number;
  version: string | null;
}

interface StoredModVersions {
  versions: Record<string, string>;
  verifiedAt: string;
}

async function readStoredVersions(): Promise<Record<string, string>> {
  try {
    return (JSON.parse(await fs.readFile(config.modVersionsFile, "utf8")) as StoredModVersions).versions ?? {};
  } catch {
    return {};
  }
}

/** Versioni nuove, mai certificate o non risolvibili dal catalogo vanno sempre
 * lasciate verificare all'updater CurseForge integrato in ASA. */
export async function modsRequiringUpdate(expected: readonly ExpectedModVersion[]): Promise<number[]> {
  const stored = await readStoredVersions();
  return expected
    .filter((mod) => mod.version === null || stored[String(mod.id)] !== mod.version)
    .map((mod) => mod.id);
}

/** Certifica il manifesto soltanto dopo RCON-online: prima non sappiamo se ASA
 * abbia completato davvero download, estrazione e mount delle mod. */
export async function markModsOnline(expected: readonly ExpectedModVersion[]): Promise<void> {
  const previous = await readStoredVersions();
  const versions = { ...previous };
  for (const mod of expected) {
    if (mod.version !== null) versions[String(mod.id)] = mod.version;
  }
  await fs.mkdir(path.dirname(config.modVersionsFile), { recursive: true });
  const tmp = `${config.modVersionsFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ versions, verifiedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(tmp, config.modVersionsFile);
}

/** Controlla/aggiorna ASA e le mappe ufficiali con SteamCMD mentre Proton è
 * fermo, poi riapplica gli hook indispensabili che SteamCMD può ripristinare. */
type SteamRunner = (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; maxBuffer: number; mockStdout: string },
) => Promise<RunResult>;

async function resetSteamUpdateMetadata(): Promise<void> {
  const steamapps = path.join(config.arkInstallDir, "steamapps");
  const manifest = path.join(steamapps, `appmanifest_${config.arkAppId}.acf`);
  const staleManifest = `${manifest}.arksa-stale`;

  // Quando Valve ritira un vecchio depot manifest, SteamCMD può restare
  // bloccato su "state is 0x6": tenta l'update differenziale usando il
  // manifest locale, riceve Access Denied e ogni retry ripete lo stesso
  // errore. Conserviamo il manifest per diagnosi ma lo togliamo dal percorso
  // riconosciuto da Steam; il tentativo con validate ricostruisce quindi i
  // metadati dai file già presenti, senza cancellare gioco, config o save.
  try {
    await fs.access(manifest);
    await fs.rm(staleManifest, { force: true });
    await fs.rename(manifest, staleManifest);
    log.warn(`SteamCMD: manifesto locale obsoleto isolato in ${staleManifest}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  await fs.rm(path.join(steamapps, "downloading", config.arkAppId), { recursive: true, force: true });
}

// SteamCMD certifica con due messaggi distinti: "fully installed" dopo un
// download e "already up to date" quando la build locale è già l'ultima.
// Riconoscere solo il primo faceva fallire ogni controllo senza aggiornamenti
// e ripiegava sul validate completo, minuti di I/O a ogni avvio o cambio profilo.
function steamCertified(result: RunResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return result.code === 0
    && (output.includes(`App '${config.arkAppId}' fully installed`)
      || output.includes(`App '${config.arkAppId}' already up to date`));
}

/** La DLL Microsoft non sta nell'immagine: lo script la scarica nel volume,
 * ne verifica l'hash e la installa come xaudio2_9.dll. */
export async function installXaudio(win64: string, runScript: SteamRunner = run): Promise<void> {
  const result = await runScript(config.xaudioInstallScript, [win64], {
    timeoutMs: 120_000,
    maxBuffer: 1024 * 1024,
    mockStdout: "",
  });
  if (result.code !== 0) {
    throw new Error(`installazione XAudio2 fallita (code=${result.code}): ${`${result.stdout}\n${result.stderr}`.trim().slice(-1000)}`);
  }
}

export async function updateBaseGame(runSteam: SteamRunner = run, retryDelayMs = 5_000): Promise<void> {
  let lastResult: RunResult = { stdout: "", stderr: "SteamCMD non eseguito", code: 1 };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Un manifesto Steam interrotto può restare nello stato transitorio 0x6.
    // Prima del terzo tentativo eliminiamo lo stato differenziale bloccato e
    // usiamo validate per ricostruire lo stato locale senza rinunciare alla
    // certificazione esplicita "fully installed".
    if (attempt === 3) await resetSteamUpdateMetadata();
    const args = [
      "+force_install_dir", config.arkInstallDir,
      "+login", "anonymous",
      "+app_update", config.arkAppId,
      ...(attempt === 3 ? ["validate"] : []),
      "+quit",
    ];
    lastResult = await runSteam(config.steamCmdScript, args, {
      timeoutMs: config.gameUpdateTimeoutSec * 1000,
      maxBuffer: 20 * 1024 * 1024,
      mockStdout: `Success! App '${config.arkAppId}' fully installed.`,
    });
    if (steamCertified(lastResult)) break;
    if (attempt < 3) {
      log.warn(`SteamCMD non ha certificato ASA (tentativo ${attempt}/3, code=${lastResult.code}); nuovo tentativo`);
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  if (!steamCertified(lastResult)) {
    const output = `${lastResult.stdout}\n${lastResult.stderr}`;
    throw new Error(`SteamCMD non ha certificato l'aggiornamento ASA dopo 3 tentativi (code=${lastResult.code}): ${output.trim().slice(-2000)}`);
  }
  if (isMock()) return;

  const win64 = path.join(config.arkInstallDir, "ShooterGame", "Binaries", "Win64");
  await fs.rm(path.join(win64, "steamclient64.dll"), { force: true });
  await installXaudio(win64, runSteam);
  await fs.writeFile(path.join(win64, "steam_appid.txt"), `${config.arkAppId}\n`, "utf8");
  await fs.writeFile(path.join(config.arkInstallDir, "steam_appid.txt"), `${config.arkAppId}\n`, "utf8");
  log.info(`SteamCMD: ASA ${config.arkAppId} e mappe ufficiali aggiornati/verificati`);
}

// Al boot l'agent può iniziare lo stesso controllo SteamCMD appena il proprio
// endpoint è disponibile, sovrapponendolo al boot-sync del control plane e al
// recupero del manifesto mod. La prima richiesta di provisioning CONSUMA
// questa Promise: non salta il controllo e non avvia un secondo updater. Le
// richieste successive nella stessa accensione eseguono nuovamente SteamCMD,
// mantenendo la garanzia "prima di ogni avvio" anche dopo ore di uptime.
let primedBaseGameUpdate: Promise<void> | null = null;

export function primeBaseGameUpdate(runSteam: SteamRunner = run, retryDelayMs = 5_000): Promise<void> {
  if (primedBaseGameUpdate === null) {
    primedBaseGameUpdate = updateBaseGame(runSteam, retryDelayMs);
  }
  return primedBaseGameUpdate;
}

export async function updateBaseGameBeforeLaunch(
  runSteam: SteamRunner = run,
  retryDelayMs = 5_000,
): Promise<void> {
  const primed = primedBaseGameUpdate;
  if (primed !== null) {
    primedBaseGameUpdate = null;
    return primed;
  }
  return updateBaseGame(runSteam, retryDelayMs);
}
