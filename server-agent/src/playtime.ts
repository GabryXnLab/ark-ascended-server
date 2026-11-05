// Tracker delle sessioni giocatore: interroga RCON a intervalli, rileva
// connessioni/disconnessioni e persiste le sessioni chiuse su file (jsonl),
// una riga per sessione. Il control plane le importa per il riparto costi.

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import { arkStatus } from "./ark.js";
import type { Player } from "./rcon.js";

export interface PlaytimeSession {
  playerId: string;
  name: string;
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationSec: number;
}

export interface LiveSession {
  playerId: string;
  name: string;
  startedAt: string; // ISO
  elapsedSec: number;
}

// Chiave stabile per giocatore: l'id EOS/Steam se presente, altrimenti il nome
// (ListPlayers a volte non riporta l'id per client appena connessi).
function keyOf(p: Player): string {
  return p.id || `name:${p.name}`;
}

const live = new Map<string, { playerId: string; name: string; startedAtMs: number }>();

let timer: NodeJS.Timeout | null = null;
let running = false;

async function appendSession(s: PlaytimeSession): Promise<void> {
  await fs.mkdir(path.dirname(config.playtimeLogFile), { recursive: true });
  await fs.appendFile(config.playtimeLogFile, JSON.stringify(s) + "\n", "utf8");
}

async function closeSession(k: string, endedAtMs: number): Promise<void> {
  const entry = live.get(k);
  if (!entry) return;
  live.delete(k);
  const durationSec = Math.max(0, Math.round((endedAtMs - entry.startedAtMs) / 1000));
  if (durationSec === 0) return; // connessione lampo, non vale la pena registrarla
  const session: PlaytimeSession = {
    playerId: entry.playerId,
    name: entry.name,
    startedAt: new Date(entry.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationSec,
  };
  try {
    await appendSession(session);
    log.info(`Sessione chiusa: ${entry.name} (${durationSec}s)`);
  } catch (e) {
    log.error("Impossibile persistere la sessione di gioco", e);
  }
}

async function tick(): Promise<void> {
  let status;
  try {
    status = await arkStatus();
  } catch (e) {
    log.debug("playtime: arkStatus fallito", e);
    return;
  }
  if (!status.online) {
    // Server offline: chiudi tutte le sessioni aperte (es. crash/stop non passato da stopArk).
    await closeAllLive();
    return;
  }

  const now = Date.now();
  const present = new Set(status.players.map(keyOf));

  for (const p of status.players) {
    const k = keyOf(p);
    if (!live.has(k)) {
      live.set(k, { playerId: p.id, name: p.name, startedAtMs: now });
      log.info(`Sessione avviata: ${p.name}`);
    }
  }

  for (const k of [...live.keys()]) {
    if (!present.has(k)) await closeSession(k, now);
  }
}

/** Chiude tutte le sessioni aperte (usata su stop/shutdown). */
export async function closeAllLive(): Promise<void> {
  const now = Date.now();
  for (const k of [...live.keys()]) await closeSession(k, now);
}

export function getLiveSessions(): LiveSession[] {
  const now = Date.now();
  return [...live.values()].map((e) => ({
    playerId: e.playerId,
    name: e.name,
    startedAt: new Date(e.startedAtMs).toISOString(),
    elapsedSec: Math.max(0, Math.round((now - e.startedAtMs) / 1000)),
  }));
}

/** Sessioni chiuse con endedAt > since (se fornito). */
export async function getClosedSessions(since?: string): Promise<PlaytimeSession[]> {
  let text: string;
  try {
    text = await fs.readFile(config.playtimeLogFile, "utf8");
  } catch {
    return [];
  }
  const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const out: PlaytimeSession[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as PlaytimeSession;
      if (Date.parse(s.endedAt) > sinceMs) out.push(s);
    } catch (e) {
      log.warn("Riga playtime illeggibile, ignorata", e);
    }
  }
  return out;
}

export function startPlaytimeTracker(): void {
  if (running) return;
  running = true;
  const intervalMs = Math.max(5, config.playtimeIntervalSec) * 1000;
  log.info(`Tracker giocatori attivo (ogni ${config.playtimeIntervalSec}s)`);
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
}

export function stopPlaytimeTracker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

// Esposto solo per i test: esegue un ciclo di rilevamento senza il timer.
export const __test = { tick };
