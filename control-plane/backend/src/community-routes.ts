import { Router, type NextFunction, type Request, type Response } from "express";
import { adminRouter } from "./admin.js";
import { authenticateGoogle, requireAdmin } from "./auth.js";
import { config } from "./config.js";
import {
  cancelJoinRequest,
  createCommunity,
  createJoinRequest,
  deleteCommunityFriend,
  ensureViewer,
  getActiveCommunityMembership,
  getCommunity,
  getViewer,
  getViewerProfile,
  inviteCommunityFriend,
  listCommunities,
  listCommunityFriends,
  listJoinRequests,
  reviewJoinRequest,
  setCommunityMembersEnabled,
  updateCommunity,
  updateCommunityFriend,
  updateViewerArkAccountId,
} from "./communities-store.js";
import {
  LEGACY_COMMUNITY_ID,
  normalizeDiscoveryQuery,
  SAFE_MEMBER_PERMISSIONS,
  type FriendPermissions,
} from "./community-model.js";
import { router as legacyServerRouter } from "./routes.js";
import { notifications } from "./notifications-store.js";
import { resolveLegacyCommunityAccess } from "./legacy-community-access.js";

function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

function validPermissions(value: unknown): value is Partial<FriendPermissions> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, permission]) => Object.hasOwn(SAFE_MEMBER_PERMISSIONS, key) && typeof permission === "boolean");
}

const rateBuckets = new Map<string, { resetAt: number; count: number }>();

function rateLimit(scope: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${scope}:${req.googleUser?.id ?? req.ip}`;
    const current = rateBuckets.get(key);
    const bucket = !current || current.resetAt <= now ? { resetAt: now + windowMs, count: 0 } : current;
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 10_000) {
      for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
      for (const candidate of rateBuckets.keys()) {
        if (rateBuckets.size <= 10_000) break;
        rateBuckets.delete(candidate);
      }
    }
    if (bucket.count > limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: "troppe richieste, riprova più tardi" });
      return;
    }
    next();
  };
}

export const communityRouter = Router();
communityRouter.use(authenticateGoogle);

communityRouter.get("/me", rateLimit("me", 30, 60_000), h(async (req, res) => {
  await ensureViewer(req.googleUser!, config.adminEmails);
  res.json(await getViewer(req.googleUser!.id));
}));

communityRouter.patch("/me", rateLimit("me-update", 20, 60_000), h(async (req, res) => {
  await ensureViewer(req.googleUser!, config.adminEmails);
  const value = req.body?.arkAccountId;
  if (value !== null && typeof value !== "string") {
    return res.status(400).json({ error: "'arkAccountId' deve essere una stringa o null" });
  }
  res.json(await updateViewerArkAccountId(req.googleUser!.id, value));
}));

communityRouter.get("/communities", rateLimit("discovery", 60, 60_000), h(async (req, res) => {
  await ensureViewer(req.googleUser!, config.adminEmails);
  const query = normalizeDiscoveryQuery(req.query.q);
  res.json({ items: await listCommunities(req.googleUser!.id, query) });
}));

communityRouter.post("/communities", rateLimit("community-create", 5, 3_600_000), h(async (req, res) => {
  if (!config.communityCreationEnabled) {
    return res.status(503).json({ error: "creazione community temporaneamente disabilitata" });
  }
  await ensureViewer(req.googleUser!, config.adminEmails);
  const community = await createCommunity(req.googleUser!.id, {
    name: req.body?.name,
    slug: req.body?.slug,
    description: req.body?.description,
    visibility: req.body?.visibility,
    language: req.body?.language,
    region: req.body?.region,
  });
  res.status(201).json(community);
}));

communityRouter.get("/communities/:communityId", h(async (req, res) => {
  await ensureViewer(req.googleUser!, config.adminEmails);
  const community = await getCommunity(req.googleUser!.id, req.params.communityId ?? "");
  if (!community) return res.status(404).json({ error: "community non trovata" });
  res.json(community);
}));

communityRouter.post("/communities/:communityId/join-requests", rateLimit("join-request", 20, 3_600_000), h(async (req, res) => {
  await ensureViewer(req.googleUser!, config.adminEmails);
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const community = await createJoinRequest(req.googleUser!.id, req.params.communityId ?? "", message);
  res.status(201).json(community);
}));

communityRouter.delete("/communities/:communityId/join-requests/me", h(async (req, res) => {
  const cancelled = await cancelJoinRequest(req.googleUser!.id, req.params.communityId ?? "");
  if (!cancelled) return res.status(404).json({ error: "nessuna richiesta in attesa" });
  res.status(204).end();
}));

communityRouter.get("/communities/:communityId/join-requests", h(async (req, res) => {
  res.json(await listJoinRequests(req.params.communityId ?? "", req.googleUser!.id));
}));

communityRouter.post("/communities/:communityId/join-requests/:requestId/approve", h(async (req, res) => {
  await reviewJoinRequest(
    req.params.communityId ?? "",
    req.params.requestId ?? "",
    req.googleUser!.id,
    "approved",
    typeof req.body?.note === "string" ? req.body.note : "",
  );
  res.status(204).end();
}));

communityRouter.post("/communities/:communityId/join-requests/:requestId/reject", h(async (req, res) => {
  await reviewJoinRequest(
    req.params.communityId ?? "",
    req.params.requestId ?? "",
    req.googleUser!.id,
    "rejected",
    typeof req.body?.note === "string" ? req.body.note : "",
  );
  res.status(204).end();
}));

async function requireCommunityMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await ensureViewer(req.googleUser!, config.adminEmails);
    const communityId = req.params.communityId ?? "";
    const membership = await getActiveCommunityMembership(communityId, req.googleUser!.id);
    if (!membership) return void res.status(403).json({ error: "membership attiva richiesta" });
    req.communityId = communityId;
    req.communityRole = membership.role;
    next();
  } catch (error) {
    next(error);
  }
}

communityRouter.get("/communities/:communityId/notifications/unread-count", requireCommunityMember, h(async (req, res) => {
  res.json({ unreadCount: await notifications.unreadCount(req.communityId!, req.googleUser!.id) });
}));

communityRouter.get("/communities/:communityId/notifications", requireCommunityMember, h(async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 40);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 40;
  const unreadOnly = req.query.unread === "true";
  res.json(await notifications.listNotifications(req.communityId!, req.googleUser!.id, { limit, unreadOnly }));
}));

communityRouter.post("/communities/:communityId/notifications/read-all", requireCommunityMember, h(async (req, res) => {
  res.json(await notifications.markAllNotificationsRead(req.communityId!, req.googleUser!.id));
}));

communityRouter.post("/communities/:communityId/notifications/:notificationId/read", requireCommunityMember, h(async (req, res) => {
  const readAt = await notifications.markNotificationRead(
    req.communityId!,
    req.googleUser!.id,
    req.params.notificationId ?? "",
  );
  res.json({ id: req.params.notificationId, readAt });
}));

async function requireCommunityAdministrator(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await ensureViewer(req.googleUser!, config.adminEmails);
    const community = await getCommunity(req.googleUser!.id, req.params.communityId ?? "");
    if (!community?.membership || community.membership.status !== "active") {
      return void res.status(403).json({ error: "membership amministrativa richiesta" });
    }
    if (!["owner", "admin"].includes(community.membership.role)) {
      return void res.status(403).json({ error: "riservato agli amministratori della community" });
    }
    req.communityRole = community.membership.role;
    next();
  } catch (error) {
    next(error);
  }
}

// Gestione membership indipendente dalla presenza di un game server: una
// community può quindi formare il proprio team prima del futuro provisioning.
communityRouter.get("/communities/:communityId/members", requireCommunityAdministrator, h(async (req, res) => {
  res.json(await listCommunityFriends(req.params.communityId ?? ""));
}));

communityRouter.patch("/communities/:communityId", requireCommunityAdministrator, h(async (req, res) => {
  res.json(await updateCommunity(req.googleUser!.id, req.params.communityId ?? "", {
    name: typeof req.body?.name === "string" ? req.body.name : undefined,
    description: typeof req.body?.description === "string" ? req.body.description : undefined,
    visibility: req.body?.visibility,
    joinPolicy: req.body?.joinPolicy,
  }));
}));

communityRouter.post("/communities/:communityId/members", requireCommunityAdministrator, h(async (req, res) => {
  const email = req.body?.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "email valida richiesta" });
  }
  res.status(201).json(await inviteCommunityFriend(req.params.communityId ?? "", email));
}));

communityRouter.patch("/communities/:communityId/members/:id", requireCommunityAdministrator, h(async (req, res) => {
  const role = req.body?.role;
  if (!["admin", "moderator", "member"].includes(role)) {
    return res.status(400).json({ error: "ruolo community non valido" });
  }
  if (req.communityRole !== "owner") {
    return res.status(403).json({ error: "solo il titolare può modificare i ruoli amministrativi" });
  }
  const member = await updateCommunityFriend(req.params.communityId ?? "", req.params.id ?? "", { role });
  if (!member) return res.status(404).json({ error: "membro non trovato" });
  res.json(member);
}));

communityRouter.delete("/communities/:communityId/members/:id", requireCommunityAdministrator, h(async (req, res) => {
  const target = (await listCommunityFriends(req.params.communityId ?? "")).accounts.find((account) => account.id === (req.params.id ?? ""));
  if (target?.communityRole === "admin" && req.communityRole !== "owner") {
    return res.status(403).json({ error: "solo il titolare può rimuovere un amministratore" });
  }
  if (!(await deleteCommunityFriend(req.params.communityId ?? "", req.params.id ?? ""))) {
    return res.status(404).json({ error: "membro non trovato" });
  }
  res.status(204).end();
}));

const communityAdminRouter = Router({ mergeParams: true });

function currentCommunityId(req: Request): string {
  return req.communityId ?? req.params.communityId ?? "";
}

// Compatibilità con i componenti PWA correnti: nel pannello server i ruoli
// community vengono proiettati nel vecchio contratto admin/friend.
communityAdminRouter.get("/me", h(async (req, res) => {
  const account = req.account!;
  const profile = await getViewerProfile(req.googleUser!.id);
  if (account.role === "admin") {
    return res.json({
      role: "admin",
      communityRole: req.communityRole,
      id: req.googleUser!.id,
      email: account.email,
      name: account.name,
      avatarUrl: account.avatarUrl,
      arkAccountId: profile?.arkAccountId ?? null,
    });
  }
  res.json({
    role: "friend",
    id: req.googleUser!.id,
    email: account.email,
    name: account.name,
    avatarUrl: account.avatarUrl,
    arkAccountId: profile?.arkAccountId ?? null,
    permissions: account.permissions,
    friendsEnabled: true,
    communityRole: req.communityRole,
  });
}));

communityAdminRouter.get("/friends", requireAdmin, h(async (req, res) => {
  res.json(await listCommunityFriends(currentCommunityId(req)));
}));

communityAdminRouter.post("/friends", requireAdmin, h(async (req, res) => {
  const email = req.body?.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "email valida richiesta" });
  }
  if (req.body?.permissions !== undefined && !validPermissions(req.body.permissions)) {
    return res.status(400).json({ error: "'permissions' contiene chiavi o valori non validi" });
  }
  res.status(201).json(await inviteCommunityFriend(currentCommunityId(req), email, req.body?.permissions));
}));

communityAdminRouter.patch("/friends/:id", requireAdmin, h(async (req, res) => {
  if (req.body?.permissions !== undefined && !validPermissions(req.body.permissions)) {
    return res.status(400).json({ error: "'permissions' contiene chiavi o valori non validi" });
  }
  const role = req.body?.role;
  if (role !== undefined && !["admin", "moderator", "member"].includes(role)) {
    return res.status(400).json({ error: "ruolo community non valido" });
  }
  if (role !== undefined && req.communityRole !== "owner") {
    return res.status(403).json({ error: "solo il titolare può modificare i ruoli amministrativi" });
  }
  const communityId = currentCommunityId(req);
  const target = (await listCommunityFriends(communityId)).accounts.find((account) => account.id === (req.params.id ?? ""));
  if (target?.communityRole === "admin" && req.communityRole !== "owner") {
    return res.status(403).json({ error: "solo il titolare può modificare un altro amministratore" });
  }
  const friend = await updateCommunityFriend(communityId, req.params.id ?? "", {
    permissions: req.body?.permissions,
    disabled: typeof req.body?.disabled === "boolean" ? req.body.disabled : undefined,
    role,
  });
  if (!friend) return res.status(404).json({ error: "membro non trovato" });
  res.json(friend);
}));

communityAdminRouter.delete("/friends/:id", requireAdmin, h(async (req, res) => {
  const communityId = currentCommunityId(req);
  const target = (await listCommunityFriends(communityId)).accounts.find((account) => account.id === (req.params.id ?? ""));
  if (target?.communityRole === "admin" && req.communityRole !== "owner") {
    return res.status(403).json({ error: "solo il titolare può rimuovere un amministratore" });
  }
  if (!(await deleteCommunityFriend(communityId, req.params.id ?? ""))) {
    return res.status(404).json({ error: "membro non trovato" });
  }
  res.status(204).end();
}));

communityAdminRouter.patch("/access", requireAdmin, h(async (req, res) => {
  if (typeof req.body?.friendsEnabled !== "boolean") {
    return res.status(400).json({ error: "'friendsEnabled' (bool) richiesto" });
  }
  await setCommunityMembersEnabled(currentCommunityId(req), req.body.friendsEnabled);
  res.json({ friendsEnabled: req.body.friendsEnabled });
}));

async function requireLegacyServer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await resolveLegacyCommunityAccess(
      req.googleUser!,
      req.params.communityId ?? "",
      config.adminEmails,
    );
    if (!result.allowed) {
      if (result.reason === "missing") return void res.status(404).json({ error: "server della community non disponibile" });
      if (result.reason === "unsupported") return void res.status(409).json({ error: "provisioning nuovi server non ancora abilitato" });
      if (result.reason === "suspended") return void res.status(403).json({ error: "membership sospesa" });
      return void res.status(403).json({ error: "accesso membri disabilitato dagli amministratori" });
    }
    req.communityId = result.communityId;
    req.communityServerId = result.serverId;
    req.communityRole = result.communityRole;
    req.account = result.account;
    next();
  } catch (error) {
    next(error);
  }
}

// Adapter tenant-aware davanti alle rotte singleton. La verifica `legacy`
// impedisce che un futuro server fleet finisca per controllare l'OCID corrente.
communityRouter.use(
  "/communities/:communityId/server",
  requireLegacyServer,
  communityAdminRouter,
  adminRouter,
  legacyServerRouter,
);

// Alias v1 per client/PWA rimasti in cache: usa esattamente membership,
// permessi e kill-switch della community legacy v2, senza mirror negli store
// arksa_members/arksa_settings. Le rotte amici/accesso vengono intercettate dal
// communityAdminRouter; richieste e dati server restano nei rispettivi store.
export const legacyCompatibilityRouter = Router();
legacyCompatibilityRouter.use(authenticateGoogle);
legacyCompatibilityRouter.use(async (req, res, next) => {
  try {
    const result = await resolveLegacyCommunityAccess(
      req.googleUser!,
      LEGACY_COMMUNITY_ID,
      config.adminEmails,
    );
    if (!result.allowed) {
      if (result.reason === "unsupported") return void res.status(409).json({ error: "server legacy non disponibile" });
      if (result.reason === "members-disabled") return void res.status(403).json({ error: "accesso membri disabilitato dagli amministratori" });
      return void res.status(403).json({ error: "membership legacy attiva richiesta" });
    }
    req.communityId = result.communityId;
    req.communityServerId = result.serverId;
    req.communityRole = result.communityRole;
    req.account = result.account;
    next();
  } catch (error) {
    next(error);
  }
});
legacyCompatibilityRouter.use(communityAdminRouter, adminRouter, legacyServerRouter);
