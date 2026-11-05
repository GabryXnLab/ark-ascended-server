// Provisioning di una mappa/configurazione: applica le impostazioni di gioco,
// eventualmente ripristina un salvataggio, avvia ARK e attende che vada online.
// Task one-shot avviato in background da POST /config/apply e interrogabile via
// GET /provision/status — stesso stile di "job + stato in-memory letto via HTTP"
// già usato da watcher.ts/playtime.ts, qui per un'operazione singola invece che
// periodica.
//
// Niente percentuale/velocità di download mod: le scarica il processo ARK/Proton
// stesso all'avvio (passando `-mods=<csv>`, vedi ark.ts/launch.sh), non steamcmd, e
// non espone un segnale di progresso osservabile dall'esterno (verificato: nessuna
// riga di percentuale in ShooterGame.log). Lo stato è quindi a fasi + tempo
// trascorso. Nessuna nozione di "servizio" da creare/configurare per-mappa: porta e
// RCON sono fissi via env (game-server.env), un solo processo ARK è mai attivo alla
// volta.

import { log } from "./logger.js";
import type { MapProfile } from "./maps.js";
import { replaceManagedIni, type IniOverrideSet } from "./ini.js";
import { startArk, stopArk, arkStatus } from "./ark.js";
import { restoreSave } from "./restore.js";
import { replaceLaunchArgs } from "./launch-options.js";
import { setActiveConfigurationRevision } from "./maps.js";
import {
  markModsOnline, modsRequiringUpdate, updateBaseGameBeforeLaunch, type ExpectedModVersion,
} from "./content-updates.js";

export type ProvisionStage =
  | "idle"
  | "checking"
  | "stopping"
  | "checking-updates"
  | "updating-game"
  | "applying-settings"
  | "updating-mods"
  | "restoring-save"
  | "starting"
  | "waiting-online"
  | "online"
  | "error";

export interface ProvisionState {
  stage: ProvisionStage;
  mapId: string | null;
  startedAt: string | null;
  updatedAt: string;
  error?: string;
}

let state: ProvisionState = { stage: "idle", mapId: null, startedAt: null, updatedAt: new Date().toISOString() };
// I provisioning sono serializzati in FIFO: una selezione arrivata durante un cambio
// già in corso non viene ignorata e diventa il passaggio successivo, sempre dopo uno
// stop/save pulito della sessione precedente.
let tail: Promise<void> = Promise.resolve();
const scheduled = new Map<string, Promise<void>>();
// Incrementata da cancelProvisioning: i provisioning in corso o in coda con una
// generazione precedente si fermano al primo passaggio utile, prima di startArk.
let generation = 0;

class ProvisionCancelled extends Error {}

/**
 * Annulla il provisioning in corso e quelli in coda (spegnimento dal control
 * plane): senza, un provisioning ancora in aggiornamento riavvierebbe ASA dopo
 * lo stop, durante il backup o mentre OCI spegne la VM.
 */
export function cancelProvisioning(): void {
  generation += 1;
}

export function getProvisionState(): ProvisionState {
  return state;
}

function setState(patch: Partial<ProvisionState>): void {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() };
}

export interface ProvisionSettings {
  gus: IniOverrideSet;
  game: IniOverrideSet;
  launchArgs?: string;
  // Se presente, prima di avviare il server si ripristina il salvataggio indicato
  // da Object Storage (stage "restoring-save").
  restoreFrom?: { objectKey: string };
  configurationRevision?: number;
  modUpdateManifest?: ExpectedModVersion[];
}

/**
 * Accoda l'applicazione delle impostazioni e l'avvio di ARK. La rotta HTTP non
 * attende la Promise; test e chiamanti interni possono invece attenderla.
 */
export async function ensureProvisioned(profile: MapProfile, settings: ProvisionSettings): Promise<void> {
  const key = `${profile.id}:${JSON.stringify(settings)}`;
  const existing = scheduled.get(key);
  if (existing) {
    log.info(`Provisioning ${profile.id} già in esecuzione o in coda: riuso la richiesta esistente`);
    return existing;
  }
  const requested = generation;
  const task = tail.then(() => run(profile, settings, requested));
  tail = task.catch(() => undefined);
  scheduled.set(key, task);
  void task.finally(() => {
    if (scheduled.get(key) === task) scheduled.delete(key);
  });
  return task;
}

async function run(profile: MapProfile, settings: ProvisionSettings, requested: number): Promise<void> {
  const ensureCurrent = () => {
    if (requested !== generation) throw new ProvisionCancelled();
  };
  if (requested !== generation) {
    log.info(`Provisioning ${profile.id} annullato prima dell'avvio`);
    return;
  }
  setState({ stage: "checking", mapId: profile.id, startedAt: new Date().toISOString(), error: undefined });
  let started = false;
  try {
    // Una configurazione può essere applicata anche mentre un'altra mappa è
    // online. Fermarla prima evita sia che ARK riscriva gli INI in shutdown,
    // sia il falso positivo in cui startArk rileva il vecchio PID, salta
    // l'avvio e il provisioning dichiara online la mappa precedente.
    setState({ stage: "stopping" });
    await stopArk();
    ensureCurrent();

    setState({ stage: "checking-updates" });
    const modUpdateManifest = settings.modUpdateManifest ?? profile.mods.map((id) => ({ id, version: null }));
    const updatingModIds = await modsRequiringUpdate(modUpdateManifest);
    ensureCurrent();

    // SteamCMD è l'unico updater supportato per ASA e mappe ufficiali. Si esegue
    // a Proton fermo anche dopo il boot: un cambio profilo su VM già accesa non
    // deve poter avviare una build vecchia.
    setState({ stage: "updating-game" });
    await updateBaseGameBeforeLaunch();
    ensureCurrent();

    setState({ stage: "applying-settings" });
    await replaceManagedIni("GameUserSettings", settings.gus);
    await replaceManagedIni("Game", settings.game);
    await replaceLaunchArgs(settings.launchArgs);

    // Ripristino del salvataggio PRIMA di avviare ARK: il server deve trovare i
    // dati già in posizione al primo caricamento del profilo.
    if (settings.restoreFrom) {
      setState({ stage: "restoring-save" });
      await restoreSave(profile.id, settings.restoreFrom.objectKey);
    }
    ensureCurrent();

    setState({ stage: updatingModIds.length > 0 ? "updating-mods" : "starting" });
    started = true;
    await startArk(profile.map, profile.id);

    if (updatingModIds.length === 0) setState({ stage: "waiting-online" });
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      ensureCurrent();
      const status = await arkStatus();
      if (status.online) {
        if (settings.configurationRevision !== undefined) {
          await setActiveConfigurationRevision(profile.id, settings.configurationRevision);
        }
        await markModsOnline(modUpdateManifest);
        setState({ stage: "online" });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      setState({}); // aggiorna solo updatedAt, per il tempo trascorso in UI
    }
    setState({ stage: "error", error: "timeout: il server non è andato online entro 5 minuti" });
  } catch (e) {
    if (e instanceof ProvisionCancelled) {
      log.info(`Provisioning ${profile.id} annullato dallo spegnimento`);
      // Lo stop dello spegnimento può aver letto il PID prima che startArk lo scrivesse.
      if (started) await stopArk().catch((error) => log.warn("Stop dopo provisioning annullato fallito", error));
      setState({ stage: "idle", error: undefined });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    log.error(`Provisioning fallito per ${profile.id} (${profile.map})`, e);
    setState({ stage: "error", error: message });
  }
}
