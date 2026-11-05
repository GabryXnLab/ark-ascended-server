// Coda delle revisioni configurazione (solo admin): le proposte create da chi ha
// accesso "con revisione" a un profilo. Identità, membri e kill-switch vivono nel
// communityAdminRouter di community-routes.ts.

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "./auth.js";
import { listRequests, getRequest, markRequest } from "./requests-store.js";
import { applyPendingRequest, ConfigRevisionConflictError, ConfigValidationError } from "./routes.js";

function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

export const adminRouter = Router();

// NB: requireAdmin è applicato per-rotta (non con adminRouter.use(...)), perché questo router
// è montato senza prefisso dedicato accanto a `router`: un middleware globale bloccherebbe
// anche le richieste dirette a `router` (es. POST /power/on) che non trovano un match qui.

adminRouter.get("/requests", requireAdmin, h(async (_req, res) => {
  res.json(await listRequests());
}));

adminRouter.post("/requests/:id/approve", requireAdmin, h(async (req, res) => {
  const id = req.params.id ?? "";
  const request = await getRequest(id);
  if (!request) return res.status(404).json({ error: "richiesta non trovata" });
  if (request.status !== "pending") return res.status(409).json({ error: `richiesta già ${request.status}` });
  try {
    await applyPendingRequest(request);
  } catch (e) {
    if (e instanceof ConfigRevisionConflictError) {
      // Il record resta "pending": l'admin può rifiutarla e chiedere di riproporla
      // sulla revisione corrente.
      res.status(409).json({ error: e.message });
      return;
    }
    if (e instanceof ConfigValidationError) {
      // Anche qui resta "pending": una proposta non valida non viene salvata.
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
  res.json(await markRequest(request.id, "approved"));
}));

adminRouter.post("/requests/:id/reject", requireAdmin, h(async (req, res) => {
  const id = req.params.id ?? "";
  const request = await getRequest(id);
  if (!request) return res.status(404).json({ error: "richiesta non trovata" });
  if (request.status !== "pending") return res.status(409).json({ error: `richiesta già ${request.status}` });
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  res.json(await markRequest(request.id, "rejected", note));
}));
