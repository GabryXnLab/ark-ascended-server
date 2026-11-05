import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";

export type CommunityNotificationKind = "server_start_requested" | "server_online" | "server_watchdog_stopped";

export interface NotificationActor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface NotificationRow {
  id: string;
  community_id: string;
  server_id: string;
  user_id: string;
  kind: CommunityNotificationKind;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_avatar_url: string | null;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

interface NotificationStateRow {
  community_id: string;
  server_id: string;
  ark_online: boolean | null;
  online_transition_id: string | null;
  observed_at: string;
}

export interface CommunityNotification {
  id: string;
  communityId: string;
  serverId: string;
  kind: CommunityNotificationKind;
  actor: NotificationActor | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  items: CommunityNotification[];
  unreadCount: number;
}

export interface NewNotification {
  id: string;
  communityId: string;
  serverId: string;
  kind: CommunityNotificationKind;
  actor: NotificationActor | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  dedupeKey: string;
  createdAt: string;
}

/** Boundary piccolo per rendere testabili isolamento e transizioni senza Supabase remoto. */
export interface NotificationsRepository {
  hasActiveMembership(communityId: string, userId: string): Promise<boolean>;
  listInbox(
    communityId: string,
    userId: string,
    options: { limit: number; unreadOnly: boolean },
  ): Promise<NotificationRow[]>;
  countUnread(communityId: string, userId: string): Promise<number>;
  notificationExists(communityId: string, notificationId: string): Promise<boolean>;
  markRead(notificationId: string, userId: string, readAt: string): Promise<void>;
  markAllRead(communityId: string, userId: string, readAt: string): Promise<number>;
  createNotification(notification: NewNotification): Promise<void>;
  getState(communityId: string, serverId: string): Promise<NotificationStateRow | undefined>;
  setState(
    communityId: string,
    serverId: string,
    arkOnline: boolean,
    transitionId: string | null,
    observedAt: string,
  ): Promise<void>;
  claimOnlineTransition(
    communityId: string,
    serverId: string,
    transitionId: string,
    observedAt: string,
  ): Promise<void>;
}

function dbError(error: { message: string; code?: string } | null): never {
  throw Object.assign(new Error(`Supabase: ${error?.message ?? "errore sconosciuto"}`), { code: error?.code });
}

class SupabaseNotificationsRepository implements NotificationsRepository {
  async hasActiveMembership(communityId: string, userId: string): Promise<boolean> {
    const { data, error } = await getSupabaseAdmin()
      .from("arksa_community_memberships")
      .select("id")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error) dbError(error);
    return !!data;
  }

  async listInbox(
    communityId: string,
    userId: string,
    options: { limit: number; unreadOnly: boolean },
  ): Promise<NotificationRow[]> {
    let query = getSupabaseAdmin()
      .from("arksa_notification_inbox")
      .select("*")
      .eq("community_id", communityId)
      .eq("user_id", userId);
    if (options.unreadOnly) query = query.is("read_at", null);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(options.limit);
    if (error) dbError(error);
    return (data ?? []) as NotificationRow[];
  }

  async countUnread(communityId: string, userId: string): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("arksa_notification_inbox")
      .select("id", { count: "exact", head: true })
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) dbError(error);
    return count ?? 0;
  }

  async notificationExists(communityId: string, notificationId: string): Promise<boolean> {
    const { data, error } = await getSupabaseAdmin()
      .from("arksa_community_notifications")
      .select("id")
      .eq("community_id", communityId)
      .eq("id", notificationId)
      .maybeSingle();
    if (error) dbError(error);
    return !!data;
  }

  async markRead(notificationId: string, userId: string, readAt: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("arksa_notification_reads").upsert({
      notification_id: notificationId,
      user_id: userId,
      read_at: readAt,
    }, { onConflict: "notification_id,user_id" });
    if (error) dbError(error);
  }

  async markAllRead(communityId: string, userId: string, readAt: string): Promise<number> {
    const notificationIds: string[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await getSupabaseAdmin()
        .from("arksa_community_notifications")
        .select("id")
        .eq("community_id", communityId)
        .range(from, from + pageSize - 1);
      if (error) dbError(error);
      const page = (data ?? []) as Array<{ id: string }>;
      notificationIds.push(...page.map((row) => row.id));
      if (page.length < pageSize) break;
    }
    for (let offset = 0; offset < notificationIds.length; offset += 500) {
      const records = notificationIds.slice(offset, offset + 500).map((notificationId) => ({
        notification_id: notificationId,
        user_id: userId,
        read_at: readAt,
      }));
      const { error } = await getSupabaseAdmin()
        .from("arksa_notification_reads")
        .upsert(records, { onConflict: "notification_id,user_id" });
      if (error) dbError(error);
    }
    return notificationIds.length;
  }

  async createNotification(notification: NewNotification): Promise<void> {
    const { error } = await getSupabaseAdmin().from("arksa_community_notifications").upsert({
      id: notification.id,
      community_id: notification.communityId,
      server_id: notification.serverId,
      kind: notification.kind,
      actor_user_id: notification.actor?.id ?? null,
      actor_name: notification.actor?.name ?? null,
      actor_avatar_url: notification.actor?.avatarUrl ?? null,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata,
      dedupe_key: notification.dedupeKey,
      created_at: notification.createdAt,
    }, { onConflict: "community_id,dedupe_key", ignoreDuplicates: true });
    if (error) dbError(error);
  }

  async getState(communityId: string, serverId: string): Promise<NotificationStateRow | undefined> {
    const { data, error } = await getSupabaseAdmin()
      .from("arksa_server_notification_state")
      .select("*")
      .eq("community_id", communityId)
      .eq("server_id", serverId)
      .maybeSingle();
    if (error) dbError(error);
    return (data as NotificationStateRow | null) ?? undefined;
  }

  async setState(
    communityId: string,
    serverId: string,
    arkOnline: boolean,
    transitionId: string | null,
    observedAt: string,
  ): Promise<void> {
    const { error } = await getSupabaseAdmin().from("arksa_server_notification_state").upsert({
      community_id: communityId,
      server_id: serverId,
      ark_online: arkOnline,
      online_transition_id: transitionId,
      observed_at: observedAt,
    }, { onConflict: "server_id" });
    if (error) dbError(error);
  }

  async claimOnlineTransition(
    communityId: string,
    serverId: string,
    transitionId: string,
    observedAt: string,
  ): Promise<void> {
    const { error } = await getSupabaseAdmin().from("arksa_server_notification_state").update({
      ark_online: true,
      online_transition_id: transitionId,
      observed_at: observedAt,
    })
      .eq("community_id", communityId)
      .eq("server_id", serverId)
      .eq("ark_online", false);
    if (error) dbError(error);
  }
}

function forbidden(): Error {
  return Object.assign(new Error("membership attiva richiesta per le notifiche"), { code: "COMMUNITY_FORBIDDEN" });
}

function notFound(): Error {
  return Object.assign(new Error("notifica non trovata nella community"), { code: "COMMUNITY_NOT_FOUND" });
}

function toNotification(row: NotificationRow): CommunityNotification {
  return {
    id: row.id,
    communityId: row.community_id,
    serverId: row.server_id,
    kind: row.kind,
    actor: row.actor_user_id && row.actor_name
      ? { id: row.actor_user_id, name: row.actor_name, avatarUrl: row.actor_avatar_url }
      : null,
    title: row.title,
    message: row.message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export class NotificationStore {
  constructor(private readonly repository: NotificationsRepository) {}

  private async requireMembership(communityId: string, userId: string): Promise<void> {
    if (!(await this.repository.hasActiveMembership(communityId, userId))) throw forbidden();
  }

  async listNotifications(
    communityId: string,
    userId: string,
    options: { limit?: number; unreadOnly?: boolean } = {},
  ): Promise<NotificationList> {
    await this.requireMembership(communityId, userId);
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 40)));
    const [inbox, unreadCount] = await Promise.all([
      this.repository.listInbox(communityId, userId, { limit, unreadOnly: options.unreadOnly === true }),
      this.repository.countUnread(communityId, userId),
    ]);
    // Difesa aggiuntiva: un adapter o una view mal configurati non possono far
    // uscire record di un altro utente/community dal boundary applicativo.
    const items = inbox
      .filter((row) => row.community_id === communityId && row.user_id === userId)
      .map(toNotification);
    return { items, unreadCount };
  }

  async unreadCount(communityId: string, userId: string): Promise<number> {
    await this.requireMembership(communityId, userId);
    return this.repository.countUnread(communityId, userId);
  }

  async markNotificationRead(communityId: string, userId: string, notificationId: string): Promise<string> {
    await this.requireMembership(communityId, userId);
    if (!(await this.repository.notificationExists(communityId, notificationId))) throw notFound();
    const readAt = new Date().toISOString();
    await this.repository.markRead(notificationId, userId, readAt);
    return readAt;
  }

  async markAllNotificationsRead(communityId: string, userId: string): Promise<{ readAt: string; count: number }> {
    await this.requireMembership(communityId, userId);
    const readAt = new Date().toISOString();
    const count = await this.repository.markAllRead(communityId, userId, readAt);
    return { readAt, count };
  }

  async recordServerStartRequested(
    communityId: string,
    serverId: string,
    requestId: string,
    actor: NotificationActor,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.repository.createNotification({
      id: randomUUID(),
      communityId,
      serverId,
      kind: "server_start_requested",
      actor,
      title: "Accensione del server richiesta",
      message: `${actor.name} ha richiesto l'accensione del server.`,
      metadata: { requestId },
      dedupeKey: `server-start:${serverId}:${requestId}`,
      createdAt,
    });
    // La richiesta accettata riabilita esplicitamente il prossimo passaggio
    // offline→online, anche se il monitor non aveva ancora osservato la VM spenta.
    await this.repository.setState(communityId, serverId, false, null, createdAt);
  }

  async recordWatchdogShutdown(
    communityId: string,
    serverId: string,
    offlineSince: Date,
    minutes: number,
  ): Promise<void> {
    await this.repository.createNotification({
      id: randomUUID(),
      communityId,
      serverId,
      kind: "server_watchdog_stopped",
      actor: null,
      title: "Server spento per sicurezza",
      message: `ARK non è risultato online per ${minutes} minuti con la VM accesa: il server è stato spento per non pagarlo a vuoto.`,
      metadata: { offlineSince: offlineSince.toISOString(), minutes },
      dedupeKey: `server-watchdog:${serverId}:${offlineSince.toISOString()}`,
      createdAt: new Date().toISOString(),
    });
  }

  async observeServerOnline(communityId: string, serverId: string, online: boolean): Promise<void> {
    const observedAt = new Date().toISOString();
    const previous = await this.repository.getState(communityId, serverId);
    if (!previous) {
      // Prima osservazione = baseline. Evita un falso evento ONLINE al primo
      // deploy o dopo una migrazione eseguita mentre ARK è già avviato.
      await this.repository.setState(communityId, serverId, online, null, observedAt);
      return;
    }
    if (!online) {
      if (previous.ark_online !== false || previous.online_transition_id !== null) {
        await this.repository.setState(communityId, serverId, false, null, observedAt);
      }
      return;
    }
    if (previous.ark_online === null) {
      await this.repository.setState(communityId, serverId, true, null, observedAt);
      return;
    }
    if (previous.ark_online === false) {
      await this.repository.claimOnlineTransition(communityId, serverId, randomUUID(), observedAt);
    }
    const current = await this.repository.getState(communityId, serverId);
    if (!current?.ark_online || !current.online_transition_id) return;
    await this.repository.createNotification({
      id: randomUUID(),
      communityId,
      serverId,
      kind: "server_online",
      actor: null,
      title: "Server online",
      message: "Il game server è online e pronto per giocare.",
      metadata: {},
      dedupeKey: `server-online:${serverId}:${current.online_transition_id}`,
      createdAt: observedAt,
    });
  }
}

export const notifications = new NotificationStore(new SupabaseNotificationsRepository());
