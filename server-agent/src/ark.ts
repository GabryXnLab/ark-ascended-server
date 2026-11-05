// Controllo del server ARK: spawn/kill diretto del processo Proton (container
// Docker, un solo processo ARK alla volta, nessun concetto di "servizio"/unità
// systemd). Stato live via RCON. In mock tiene uno stato in memoria.

import { spawn } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { openSync } from "node:fs";
import { config, isMock } from "./config.js";
import { log } from "./logger.js";
import { listPlayers, rconCommand, type Player } from "./rcon.js";
import {
  getActiveMap,
  setActiveMap,
  getActiveProfileId,
  setActiveProfileId,
  getProfile,
  getProfileByMap,
  getActiveConfigurationRevision,
  writeActiveMods,
} from "./maps.js";
import { synchronizeInfrastructureGameUserSettings } from "./ini.js";
import { run } from "./shell.js";

export interface ArkStatus {
  online: boolean;
  map: string | null;
  players: Player[];
  playerCount: number;
  maxPlayers: number | null;
  version: string | null;
  profileId: string | null;
  configurationRevision: number | null;
  /** Primo RCON-online dall'ultimo avvio di ASA in questa accensione, null se mai. */
  onlineCertifiedAt: string | null;
}

// Il container dell'agent riparte a ogni accensione della VM e startArk azzera il
// valore: il control plane fa il backup allo spegnimento solo se ASA è andato
// online, così un salvataggio rifiutato al boot non sovrascrive l'unica copia
// buona su Object Storage.
let onlineCertifiedAt: string | null = null;

function certifyOnline(): string {
  onlineCertifiedAt ??= new Date().toISOString();
  return onlineCertifiedAt;
}

// --- Stato in memoria per la modalità mock ----------------------------------
const mockState = {
  online: false,
  players: [] as Player[],
  maxPlayers: 20,
};

async function rconOpts() {
  // Porta e password sono infrastrutturali, condivise dal launcher tramite
  // RCON_PORT/RCON_PASSWORD e mai lette dagli INI/PWA: una divergenza renderebbe
  // impossibili stato, saveworld e auto-stop. RCONEnabled resta forzato dal launcher.
  return {
    host: config.rconHost,
    port: config.rconPort,
    password: config.rconPassword,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = (await readFile(config.pidFile, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function clearPid(): Promise<void> {
  await rm(config.pidFile, { force: true });
}

/** Termina il wineserver del solo prefix ARK (unico processo Wine nel container). */
async function stopWineServer(): Promise<void> {
  const env = { ...process.env, WINEPREFIX: config.winePrefix };
  const killed = await run(config.wineServerBinary, ["-k"], { timeoutMs: 5_000, env });
  if (killed.code !== 0) {
    // wineserver usa code=1 senza stderr quando il prefix non ha processi:
    // è il caso normale al primo provisioning, non un warning operativo.
    if (killed.code === 1 && killed.stderr.trim() === "") return;
    log.warn(`wineserver -k fallito (code=${killed.code}): ${killed.stderr.trim()}`);
    return;
  }
  const waited = await run(config.wineServerBinary, ["-w"], { timeoutMs: 10_000, env });
  if (waited.code !== 0) {
    log.warn(`wineserver -w fallito (code=${waited.code}): ${waited.stderr.trim()}`);
  }
}

/** Avvia ARK come processo figlio diretto (launch.sh <map>), senza systemd. */
async function startProcess(target: string, profileId?: string): Promise<void> {
  const existing = await readPid();
  if (existing && isProcessAlive(existing)) {
    log.info(`ARK già in esecuzione (pid ${existing}), avvio saltato`);
    return;
  }
  // stdout/stderr catturati su file (mai "ignore"): unico modo per vedere gli
  // avvisi/errori reali di Wine/Proton in caso di avvio bloccato o silenzioso
  // (verificato dal vivo: con stdio "ignore" un blocco pre-RCON è totalmente
  // invisibile, nessun segnale se non il ShooterGame.log applicativo).
  const logFd = openSync(config.launchLogFile, "a");
  const child = spawn(config.launchScript, profileId ? [target, profileId] : [target], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  if (!child.pid) throw new Error("impossibile avviare il processo ARK (spawn senza pid)");
  await writeFile(config.pidFile, String(child.pid), "utf8");
  log.info(`ARK avviato (pid ${child.pid}) via ${config.launchScript} ${target}`);
}

/** Ferma il processo ARK: SIGTERM, attesa fino a stopTimeoutSec, poi SIGKILL. */
async function stopProcess(): Promise<void> {
  const pid = await readPid();
  if (pid === null) {
    log.info("nessun pid ARK registrato, nulla da fermare");
    await stopWineServer();
    return;
  }
  if (!isProcessAlive(pid)) {
    await clearPid();
    await stopWineServer();
    return;
  }
  // Il launcher gira "detached", quindi è leader del proprio process group
  // (pgid == pid): un kill sul solo pid termina Proton ma lascia orfani
  // wineserver/steam.exe/GameThread, che restano vivi e possono collidere con
  // un riavvio successivo (osservato dal vivo: due sessioni ARK sovrapposte
  // dopo uno stop+restart ravvicinato). Il segnale va quindi mandato all'intero
  // gruppo con pid negativo.
  process.kill(-pid, "SIGTERM");
  const deadline = Date.now() + config.stopTimeoutSec * 1000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      await clearPid();
      await stopWineServer();
      log.info(`ARK (pid ${pid}) terminato`);
      return;
    }
    await sleep(1000);
  }
  log.warn(`ARK (pid ${pid}) non terminato entro ${config.stopTimeoutSec}s, invio SIGKILL`);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // già uscito nel frattempo
  }
  await clearPid();
  await stopWineServer();
}

/** Avvia ARK sulla mappa attiva (o quella indicata), scrivendo mappa+mod attive. */
export async function startArk(map?: string, profileId?: string): Promise<{ map: string }> {
  const persistedProfileId = profileId ?? (map === undefined ? await getActiveProfileId() : null);
  const profile = persistedProfileId
    ? await getProfile(persistedProfileId)
    : map
      ? await getProfileByMap(map)
      : null;
  const target = profile?.map ?? map ?? (await getActiveMap());
  if (!target) throw new Error("nessuna mappa attiva: imposta prima una mappa");
  onlineCertifiedAt = null;
  await setActiveMap(target);
  await setActiveProfileId(profile?.id ?? null);
  // Allinea il file active-mods (letto dal launcher) al profilo esatto. Usare
  // solo il nome mappa sarebbe ambiguo per due configurazioni sulla stessa mappa.
  await writeActiveMods(profile?.mods ?? []);
  if (isMock()) {
    mockState.online = true;
    log.info(`[mock] ARK avviato su ${target}`);
    return { map: target };
  }
  await startProcess(target, profile?.id);
  return { map: target };
}

/**
 * saveworld via RCON + attesa del flush, solo se il processo ASA esiste (evita il
 * timeout RCON al primo provisioning). Condivisa da stop e backup manuale.
 * Ritorna true se il salvataggio è stato eseguito.
 */
export async function saveWorldAndSettle(): Promise<boolean> {
  if (isMock()) return mockState.online;
  const pid = await readPid();
  if (pid === null || !isProcessAlive(pid)) return false;
  try {
    await rconCommand(await rconOpts(), "saveworld");
    log.info("saveworld eseguito");
    // ASA risponde a RCON prima che il nuovo save RBF sia necessariamente
    // chiuso e sincronizzato. Terminare subito Proton può lasciare un .ark
    // formalmente presente ma rifiutato al boot come database corrotto.
    // La finestra è configurabile e rientra nella stop_grace_period Compose.
    if (config.saveSettleSec > 0) {
      log.info(`attendo ${config.saveSettleSec}s per il flush del salvataggio`);
      await sleep(config.saveSettleSec * 1000);
    }
    return true;
  } catch (e) {
    log.warn("saveworld fallito (RCON non raggiungibile?), procedo", e);
    return false;
  }
}

/** saveworld via RCON, poi kill del processo. */
export async function stopArk(): Promise<void> {
  if (isMock()) {
    mockState.online = false;
    mockState.players = [];
    log.info("[mock] ARK fermato");
    return;
  }

  await saveWorldAndSettle();
  await stopProcess();
  try {
    await synchronizeInfrastructureGameUserSettings();
  } catch (e) {
    log.warn("Riallineamento impostazioni amministrative dopo lo stop fallito", e);
  }
  log.info("ARK fermato");
}

/** true se il processo ASA avviato dall'agent è ancora vivo (indipendente da RCON). */
export async function isArkRunning(): Promise<boolean> {
  if (isMock()) return mockState.online;
  const pid = await readPid();
  return pid !== null && isProcessAlive(pid);
}

/** Stato live via RCON; in mock usa lo stato in memoria. */
export async function arkStatus(): Promise<ArkStatus> {
  const map = await getActiveMap();
  const profileId = await getActiveProfileId();
  const applied = await getActiveConfigurationRevision();
  const configurationRevision = applied?.id === profileId ? applied.revision : null;
  if (isMock()) {
    return {
      online: mockState.online,
      map,
      players: mockState.players,
      playerCount: mockState.players.length,
      maxPlayers: mockState.maxPlayers,
      version: "mock",
      profileId,
      configurationRevision,
      onlineCertifiedAt: mockState.online ? certifyOnline() : onlineCertifiedAt,
    };
  }
  try {
    const players = await listPlayers(await rconOpts());
    try {
      await synchronizeInfrastructureGameUserSettings();
    } catch (e) {
      // RCON è già certificato: un errore di persistenza locale non deve
      // trasformare il server online in un falso offline.
      log.warn("Riallineamento impostazioni amministrative dopo RCON-online fallito", e);
    }
    return {
      online: true,
      map,
      players,
      playerCount: players.length,
      maxPlayers: null,
      version: null,
      profileId,
      configurationRevision,
      onlineCertifiedAt: certifyOnline(),
    };
  } catch (e) {
    log.debug("RCON non raggiungibile in arkStatus", e);
    return {
      online: false, map, players: [], playerCount: 0, maxPlayers: null, version: null,
      profileId, configurationRevision, onlineCertifiedAt,
    };
  }
}

/** Broadcast in-game (utile per avvisare prima dell'auto-stop). */
export async function broadcast(message: string): Promise<void> {
  if (isMock()) {
    log.info(`[mock] broadcast: ${message}`);
    return;
  }
  await rconCommand(await rconOpts(), `ServerChat ${message}`);
}

// Esposto per i test in mock: simula giocatori connessi.
export const __mock = {
  setOnline(v: boolean) {
    mockState.online = v;
  },
  setPlayers(p: Player[]) {
    mockState.players = p;
  },
};
