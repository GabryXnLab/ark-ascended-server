// Client HTTP verso il server-agent sul game server (rete privata VCN).

import { config } from "./config.js";
import { log } from "./logger.js";
import type { GameConfiguration } from "./configs-store.js";
import type { ModUpdateVersion } from "./curseforge.js";

export interface AgentArkStatus {
  online: boolean;
  map: string | null;
  players: { id: string; name: string }[];
  playerCount: number;
  maxPlayers: number | null;
  version: string | null;
  profileId: string | null;
  configurationRevision: number | null;
  /** Assente negli agent precedenti: va trattato come "mai online". */
  onlineCertifiedAt?: string | null;
}

export interface AgentMetrics {
  cpuPct: number;
  memUsedGb: number;
  memTotalGb: number;
  diskUsedGb: number | null;
  diskTotalGb: number | null;
  uptimeSec: number;
}

export interface PlaytimeSession {
  playerId: string;
  name: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
}

export interface LiveSession {
  playerId: string;
  name: string;
  startedAt: string;
  elapsedSec: number;
}

export interface AgentInstalledMod {
  id: number;
  sizeBytes: number;
  installedAt: string;
}

export type ProvisionStage =
  | "idle" | "checking" | "stopping"
  | "checking-updates" | "updating-game" | "applying-settings" | "updating-mods"
  | "restoring-save" | "starting" | "waiting-online"
  | "online" | "error";

export interface AgentBackupResult {
  profileId: string | null;
  map: string | null;
  mods: number[];
  objectKey: string;
  sizeBytes: number;
  backedUpAt: string;
}

export interface ProvisionState {
  stage: ProvisionStage;
  mapId: string | null;
  startedAt: string | null;
  updatedAt: string;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 6000): Promise<T> {
  const headers: Record<string, string> = {};
  if (config.agentToken) headers["authorization"] = `Bearer ${config.agentToken}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${config.agentUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`agent ${method} ${path} → ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export const agent = {
  arkStatus: () => call<AgentArkStatus>("GET", "/ark/status"),
  metrics: () => call<AgentMetrics>("GET", "/metrics"),
  timer: () => call<{ idleStopMinutes: number; emptySinceSec: number }>("GET", "/timer"),
  setTimer: (idleStopMinutes: number) => call("POST", "/timer", { idleStopMinutes }),
  getAdminWhitelist: () => call<{ accountIds: string[] }>("GET", "/admin-whitelist"),
  setAdminWhitelist: (accountIds: string[]) =>
    call<{ accountIds: string[] }>("PUT", "/admin-whitelist", { accountIds }),
  startArk: () => call("POST", "/ark/start"),
  // Lo stop comprende saveworld, attesa del flush su disco e chiusura di
  // Proton. Deve completarsi prima che il control plane spenga la VM.
  stopArk: () => call("POST", "/ark/stop", undefined, 90_000),
  installMap: (p: unknown) => call("POST", "/map/install", p),
  // Avvia il provisioning in background sull'agent (può richiedere minuti): il
  // chiamante segue l'avanzamento con provisionStatus(), non aspetta qui.
  applyConfig: (
    id: string,
    map: string,
    revision: number,
    iniOverrides: GameConfiguration["iniOverrides"],
    modUpdateManifest: ModUpdateVersion[],
    restoreFrom?: { objectKey: string },
  ) =>
    call<{ map: string; accepted: boolean }>("POST", "/config/apply", {
      id, map, revision, iniOverrides, modUpdateManifest, restoreFrom,
    }),
  provisionStatus: () => call<ProvisionState>("GET", "/provision/status"),
  playtimeSessions: (since?: string) =>
    call<PlaytimeSession[]>("GET", `/playtime/sessions${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  playtimeLive: () => call<LiveSession[]>("GET", "/playtime/live"),
  listInstalledMods: () => call<AgentInstalledMod[]>("GET", "/mods/installed"),
  uninstallMod: (id: number) => call("DELETE", `/mods/installed/${id}`),
  // Backup/restore salvataggi; deleteProfile ripulisce il profilo interno di una config eliminata.
  backup: () => call<AgentBackupResult | { ok: false }>("POST", "/backup", undefined, 15 * 60_000),
  getLastBackup: () => call<AgentBackupResult>("GET", "/backup/last"),
  restore: (profileId: string, objectKey: string) =>
    call("POST", "/restore", { profileId, objectKey }, 15 * 60_000),
  deleteProfile: (id: string) => call("DELETE", `/maps/${id}`),
};

// Variante "soft": ritorna null invece di lanciare (per /status quando RUNNING
// ma l'agent non è ancora pronto durante il boot).
export async function trySoft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log.debug("agent non raggiungibile (atteso durante il boot)", e);
    return null;
  }
}
