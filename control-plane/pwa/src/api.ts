// Client API verso il backend. Il JWT è gestito e rinnovato da Supabase Auth.

import type {
  Status, PlaytimeSummary, PlaytimeLog, ModSearchResult, ModDetail, ModCategory, FeaturedMods,
  Me, FriendAccount, FriendsList, FriendPermissions, PendingRequest, GameConfiguration, GameConfigurationInput,
  InstalledMod, ProvisionState, Savegame, BootQueueOp, ViewerMe, CommunitySummary, CommunityJoinRequest,
  CommunityNotificationList, AdminWhitelistState, ViewerProfile, ConfigMember,
} from "./types";
import { getAccessToken } from "./auth";

let activeCommunityId: string | null = null;

export function setActiveCommunityId(communityId: string | null): void {
  activeCommunityId = communityId;
}

function serverPath(path: string): string {
  if (!activeCommunityId) throw new Error("seleziona prima una community");
  return `/v2/communities/${encodeURIComponent(activeCommunityId)}/server${path}`;
}

async function reqStatus<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api${serverPath(path)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("Sessione Google scaduta: accedi di nuovo.");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt || res.statusText;
    try {
      const parsed = JSON.parse(txt) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch { /* corpo non JSON: usa il testo grezzo */ }
    throw new Error(res.status === 403 ? msg : `${res.status}: ${msg}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  const parsed = (ct.includes("application/json") ? await res.json() : undefined) as T;
  return { status: res.status, body: parsed };
}

async function publicReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/v2${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("Sessione Google scaduta: accedi di nuovo.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try { message = (JSON.parse(text) as { error?: string }).error || message; } catch { /* testo non JSON */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await reqStatus<T>(method, path, body)).body;
}

/** Esito del salvataggio di una configurazione: salvata subito, oppure (`pending`)
 * inviata alle revisioni degli amministratori perché l'accesso è "con revisione". */
export interface ConfigSaveResult {
  pending: boolean;
  request?: PendingRequest;
  configuration?: GameConfiguration;
}

export const api = {
  status: () => req<Status>("GET", "/status"),
  powerOn: () => req("POST", "/power/on"),
  powerOff: () => req("POST", "/power/off"),
  setTimer: (idleStopMinutes: number) => req("POST", "/timer", { idleStopMinutes }),
  searchMods: (q: string, page = 0, categoryId?: number) =>
    req<{ items: ModSearchResult[]; totalCount: number }>(
      "GET",
      `/mods/search?q=${encodeURIComponent(q)}&page=${page}${categoryId ? `&categoryId=${categoryId}` : ""}`,
    ),
  featuredMods: () => req<FeaturedMods>("GET", "/mods/featured"),
  modCategories: () => req<ModCategory[]>("GET", "/mods/categories"),
  modsBulk: (ids: number[]) => req<ModSearchResult[]>("POST", "/mods/bulk", { ids }),
  modDetail: (id: number) => req<ModDetail>("GET", `/mods/${id}`),
  modDescription: (id: number) => req<{ html: string }>("GET", `/mods/${id}/description`),
  playtimeSummary: (month?: string) =>
    req<PlaytimeSummary>("GET", `/playtime/summary${month ? `?month=${month}` : ""}`),
  playtimeLog: (month?: string) =>
    req<PlaytimeLog>("GET", `/playtime/log${month ? `?month=${month}` : ""}`),

  viewer: () => publicReq<ViewerMe>("GET", "/me"),
  profile: {
    setArkAccountId: (arkAccountId: string | null) =>
      publicReq<ViewerProfile>("PATCH", "/me", { arkAccountId }),
  },
  serverMe: () => req<Me>("GET", "/me"),
  communities: {
    list: (q = "") => publicReq<{ items: CommunitySummary[] }>("GET", `/communities${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    get: (idOrSlug: string) =>
      publicReq<CommunitySummary>("GET", `/communities/${encodeURIComponent(idOrSlug)}`),
    create: (input: { name: string; description?: string; visibility: "public" | "unlisted" | "private" }) =>
      publicReq<CommunitySummary>("POST", "/communities", input),
    update: (id: string, input: { name: string; description: string; visibility: "public" | "unlisted" | "private"; joinPolicy?: "request" | "invite" | "closed" }) =>
      publicReq<CommunitySummary>("PATCH", `/communities/${encodeURIComponent(id)}`, input),
    join: (id: string, message = "") =>
      publicReq<CommunitySummary>("POST", `/communities/${encodeURIComponent(id)}/join-requests`, { message }),
    cancelJoin: (id: string) =>
      publicReq<void>("DELETE", `/communities/${encodeURIComponent(id)}/join-requests/me`),
    requests: (id: string) =>
      publicReq<CommunityJoinRequest[]>("GET", `/communities/${encodeURIComponent(id)}/join-requests`),
    approve: (communityId: string, requestId: string) =>
      publicReq<void>("POST", `/communities/${encodeURIComponent(communityId)}/join-requests/${encodeURIComponent(requestId)}/approve`),
    reject: (communityId: string, requestId: string) =>
      publicReq<void>("POST", `/communities/${encodeURIComponent(communityId)}/join-requests/${encodeURIComponent(requestId)}/reject`),
  },
  notifications: {
    list: (communityId: string, options?: { limit?: number; unreadOnly?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.set("limit", String(options.limit));
      if (options?.unreadOnly) params.set("unread", "true");
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return publicReq<CommunityNotificationList>(
        "GET",
        `/communities/${encodeURIComponent(communityId)}/notifications${query}`,
      );
    },
    markRead: (communityId: string, notificationId: string) =>
      publicReq<{ id: string; readAt: string }>(
        "POST",
        `/communities/${encodeURIComponent(communityId)}/notifications/${encodeURIComponent(notificationId)}/read`,
      ),
    markAllRead: (communityId: string) =>
      publicReq<{ readAt: string; count: number }>(
        "POST",
        `/communities/${encodeURIComponent(communityId)}/notifications/read-all`,
      ),
  },
  friends: {
    list: () => req<FriendsList>("GET", "/friends"),
    create: (email: string, permissions?: Partial<FriendPermissions>) =>
      req<FriendAccount>("POST", "/friends", { email, ...(permissions ? { permissions } : {}) }),
    update: (id: string, patch: { permissions?: Partial<FriendPermissions>; disabled?: boolean; role?: "admin" | "moderator" | "member" }) =>
      req<FriendAccount>("PATCH", `/friends/${id}`, patch),
    remove: (id: string) => req<void>("DELETE", `/friends/${id}`),
  },
  access: {
    set: (friendsEnabled: boolean) => req<{ friendsEnabled: boolean }>("PATCH", "/access", { friendsEnabled }),
  },
  adminWhitelist: {
    get: () => req<AdminWhitelistState>("GET", "/admin-whitelist"),
    set: (accountIds: string[]) => req<AdminWhitelistState>("PUT", "/admin-whitelist", { accountIds }),
  },
  requests: {
    list: () => req<PendingRequest[]>("GET", "/requests"),
    approve: (id: string) => req<PendingRequest>("POST", `/requests/${id}/approve`),
    reject: (id: string, note?: string) => req<PendingRequest>("POST", `/requests/${id}/reject`, note ? { note } : undefined),
  },
  configs: {
    list: () => req<GameConfiguration[]>("GET", "/configs"),
    members: () => req<ConfigMember[]>("GET", "/config-members"),
    save: async (input: GameConfigurationInput): Promise<ConfigSaveResult> => {
      const { status, body } = await reqStatus<GameConfiguration | { request?: PendingRequest }>("POST", "/configs", input);
      if (status === 202) {
        const pending = body as { request?: PendingRequest };
        return { pending: !!pending.request, request: pending.request };
      }
      return { pending: false, configuration: body as GameConfiguration };
    },
    setAccess: (id: string, accessControl: GameConfiguration["accessControl"]) =>
      req<GameConfiguration>("PATCH", `/configs/${id}/access`, { accessControl }),
    remove: (id: string) => req<void>("DELETE", `/configs/${id}`),
    select: (id: string) =>
      req<{ applied: boolean; queued?: boolean; map?: string; instanceState?: string }>("POST", `/configs/${id}/select`),
    queued: () => req<{ id: string | null }>("GET", "/configs/queued"),
  },
  provisionStatus: () => req<ProvisionState>("GET", "/provision/status"),
  bootQueue: {
    list: () => req<BootQueueOp[]>("GET", "/boot-queue"),
  },
  modLibrary: {
    // 200 con `available:false` se l'istanza non è RUNNING (scan disco richiede l'agent).
    list: () => req<{ available: boolean; instanceState: string; mods: InstalledMod[] }>("GET", "/mods/installed"),
    uninstall: (id: number) => req<void>("DELETE", `/mods/installed/${id}`),
  },
  savegames: {
    list: () => req<Savegame[]>("GET", "/savegames"),
    backup: () => req<Savegame>("POST", "/backup"),
    remove: (id: string) => req<void>("DELETE", `/savegames/${id}`),
    restore: (id: string) => req<{ map: string }>("POST", `/savegames/${id}/restore`),
  },
};
