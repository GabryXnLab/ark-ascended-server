// Middleware token condiviso: il backend control plane invia
// Authorization: Bearer <AGENT_TOKEN>. In assenza di token configurato (dev)
// l'auth è disattivata con un warning.

import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { log } from "./logger.js";

let warnedNoToken = false;

/**
 * L'endpoint testuale usato direttamente da ASA non può inviare il bearer
 * token dell'agent. Lo esentiamo dall'auth soltanto quando la connessione nasce
 * nello stesso network namespace del container.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1"
    || address === "::1"
    || address?.startsWith("::ffff:127.") === true;
}

export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.token) {
    if (!warnedNoToken) {
      log.warn("AGENT_TOKEN non impostato: autenticazione DISATTIVATA (solo per dev!)");
      warnedNoToken = true;
    }
    next();
    return;
  }
  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${config.token}`;
  // confronto a lunghezza costante per evitare timing attack banali
  if (header.length === expected.length && safeEqual(header, expected)) {
    next();
    return;
  }
  res.status(401).json({ error: "non autorizzato" });
}

function safeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
