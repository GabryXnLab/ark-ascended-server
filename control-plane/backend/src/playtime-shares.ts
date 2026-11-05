import type { PlayerTotal } from "./playtime-store.js";

export interface PlayerShare {
  id: string;
  name: string;
  seconds: number;
  pct: number;
  shareAmount: number | null;
}

// Senza costo (provider locale) resta solo il tempo di gioco: shareAmount è null.
export function buildPlayerShares(
  players: PlayerTotal[],
  totalSeconds: number,
  cost: { amount: number } | null,
): PlayerShare[] {
  let allocated = 0;
  return players.map((p, i) => {
    const pct = totalSeconds > 0 ? p.seconds / totalSeconds : 0;
    let shareAmount: number | null = null;
    if (cost) {
      // L'ultimo giocatore assorbe l'arrotondamento, così la somma torna esatta.
      shareAmount = i === players.length - 1
        ? Math.round((cost.amount - allocated) * 100) / 100
        : Math.round(cost.amount * pct * 100) / 100;
      allocated += shareAmount;
    }
    return {
      id: p.id,
      name: p.name,
      seconds: Math.round(p.seconds),
      pct: Math.round(pct * 1000) / 10,
      shareAmount,
    };
  });
}
