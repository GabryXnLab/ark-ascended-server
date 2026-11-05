// Storico persistente delle sessioni di gioco sul control plane (sempre acceso),
// alimentato da playtime-sync.ts. File JSON Lines, una sessione per riga.
// Consultabile anche a game server spento (a differenza dei dati sul suo disco).

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import type { PlaytimeSession } from "./agent.js";

let seenKeys: Set<string> | null = null;
let cursor: string | null = null; // endedAt massimo già importato (ISO)

function keyOf(s: PlaytimeSession): string {
  return `${s.playerId}|${s.startedAt}`;
}

async function loadIndex(): Promise<Set<string>> {
  if (seenKeys) return seenKeys;
  seenKeys = new Set();
  let text: string;
  try {
    text = await fs.readFile(config.playtimeDataFile, "utf8");
  } catch {
    return seenKeys;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as PlaytimeSession;
      seenKeys.add(keyOf(s));
      if (!cursor || s.endedAt > cursor) cursor = s.endedAt;
    } catch (e) {
      log.warn("Riga playtime store illeggibile, ignorata", e);
    }
  }
  return seenKeys;
}

/** ISO dell'ultima sessione importata, da passare come `since` all'agent. */
export async function getCursor(): Promise<string | undefined> {
  await loadIndex();
  return cursor ?? undefined;
}

/** Aggiunge le sessioni nuove (dedup su playerId+startedAt), aggiorna il cursore. */
export async function appendSessions(sessions: PlaytimeSession[]): Promise<number> {
  const seen = await loadIndex();
  const fresh = sessions.filter((s) => !seen.has(keyOf(s)));
  if (fresh.length === 0) return 0;
  await fs.mkdir(path.dirname(config.playtimeDataFile), { recursive: true });
  const lines = fresh.map((s) => JSON.stringify(s)).join("\n") + "\n";
  await fs.appendFile(config.playtimeDataFile, lines, "utf8");
  for (const s of fresh) {
    seen.add(keyOf(s));
    if (!cursor || s.endedAt > cursor) cursor = s.endedAt;
  }
  return fresh.length;
}

export interface PlayerTotal {
  id: string;
  name: string;
  seconds: number;
}

/** Secondi totali per giocatore per le sessioni chiuse che ricadono in [from, to). */
export async function getClosedTotals(from: Date, to: Date): Promise<PlayerTotal[]> {
  let text: string;
  try {
    text = await fs.readFile(config.playtimeDataFile, "utf8");
  } catch {
    return [];
  }
  const totals = new Map<string, PlayerTotal>();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let s: PlaytimeSession;
    try {
      s = JSON.parse(line) as PlaytimeSession;
    } catch {
      continue;
    }
    const startMs = Date.parse(s.startedAt);
    const endMs = Date.parse(s.endedAt);
    const overlapSec = Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs)) / 1000;
    if (overlapSec <= 0) continue;
    const cur = totals.get(s.playerId) ?? { id: s.playerId, name: s.name, seconds: 0 };
    cur.name = s.name; // tiene il nome più recente
    cur.seconds += overlapSec;
    totals.set(s.playerId, cur);
  }
  return [...totals.values()];
}

/** Sessioni chiuse (una per riga, entrata/uscita) che ricadono in [from, to), più recenti prima. */
export async function getSessionsInRange(from: Date, to: Date): Promise<PlaytimeSession[]> {
  let text: string;
  try {
    text = await fs.readFile(config.playtimeDataFile, "utf8");
  } catch {
    return [];
  }
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const sessions: PlaytimeSession[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let s: PlaytimeSession;
    try {
      s = JSON.parse(line) as PlaytimeSession;
    } catch {
      continue;
    }
    const startMs = Date.parse(s.startedAt);
    const endMs = Date.parse(s.endedAt);
    if (endMs <= fromMs || startMs >= toMs) continue;
    sessions.push(s);
  }
  sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return sessions;
}
