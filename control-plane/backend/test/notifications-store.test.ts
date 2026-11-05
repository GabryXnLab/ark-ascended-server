import assert from "node:assert/strict";
import test from "node:test";
import {
  NotificationStore,
  type NewNotification,
  type NotificationsRepository,
} from "../src/notifications-store.js";

const COMMUNITY_A = "00000000-0000-4000-8000-00000000000a";
const COMMUNITY_B = "00000000-0000-4000-8000-00000000000b";
const SERVER_A = "00000000-0000-4000-8000-00000000001a";
const USER_A = "00000000-0000-4000-8000-00000000002a";

class FakeNotificationsRepository implements NotificationsRepository {
  memberships = new Set<string>();
  inbox: Array<{
    id: string;
    community_id: string;
    server_id: string;
    user_id: string;
    kind: "server_start_requested" | "server_online" | "server_watchdog_stopped";
    actor_user_id: string | null;
    actor_name: string | null;
    actor_avatar_url: string | null;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
    created_at: string;
    read_at: string | null;
  }> = [];
  notifications = new Map<string, NewNotification>();
  read = new Set<string>();
  state: {
    community_id: string;
    server_id: string;
    ark_online: boolean | null;
    online_transition_id: string | null;
    observed_at: string;
  } | undefined;

  async hasActiveMembership(communityId: string, userId: string): Promise<boolean> {
    return this.memberships.has(`${communityId}:${userId}`);
  }

  async listInbox(_communityId: string, _userId: string, options: { limit: number; unreadOnly: boolean }) {
    // Restituisce deliberatamente anche righe cross-tenant: il boundary dello
    // store deve eliminarle anche se la view/repository venisse configurata male.
    return this.inbox.filter((row) => !options.unreadOnly || row.read_at === null).slice(0, options.limit);
  }

  async countUnread(communityId: string, userId: string): Promise<number> {
    return this.inbox.filter((row) => row.community_id === communityId && row.user_id === userId && row.read_at === null).length;
  }

  async notificationExists(communityId: string, notificationId: string): Promise<boolean> {
    const notification = this.notifications.get(notificationId);
    return notification?.communityId === communityId;
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    this.read.add(`${notificationId}:${userId}`);
  }

  async markAllRead(communityId: string, userId: string): Promise<number> {
    const ids = this.inbox
      .filter((row) => row.community_id === communityId && row.user_id === userId)
      .map((row) => row.id);
    for (const id of ids) this.read.add(`${id}:${userId}`);
    return ids.length;
  }

  async createNotification(notification: NewNotification): Promise<void> {
    if ([...this.notifications.values()].some((candidate) => (
      candidate.communityId === notification.communityId && candidate.dedupeKey === notification.dedupeKey
    ))) return;
    this.notifications.set(notification.id, notification);
  }

  async getState(communityId: string, serverId: string) {
    return this.state?.community_id === communityId && this.state.server_id === serverId ? this.state : undefined;
  }

  async setState(
    communityId: string,
    serverId: string,
    arkOnline: boolean,
    transitionId: string | null,
    observedAt: string,
  ): Promise<void> {
    this.state = {
      community_id: communityId,
      server_id: serverId,
      ark_online: arkOnline,
      online_transition_id: transitionId,
      observed_at: observedAt,
    };
  }

  async claimOnlineTransition(
    communityId: string,
    serverId: string,
    transitionId: string,
    observedAt: string,
  ): Promise<void> {
    if (this.state?.community_id === communityId && this.state.server_id === serverId && this.state.ark_online === false) {
      await this.setState(communityId, serverId, true, transitionId, observedAt);
    }
  }
}

function inboxRow(id: string, communityId: string, userId: string) {
  return {
    id,
    community_id: communityId,
    server_id: SERVER_A,
    user_id: userId,
    kind: "server_online" as const,
    actor_user_id: null,
    actor_name: null,
    actor_avatar_url: null,
    title: "Server online",
    message: "Online",
    metadata: {},
    created_at: "2026-08-28T10:00:00.000Z",
    read_at: null,
  };
}

test("isola feed e accesso in base a community, utente e membership attiva", async () => {
  const repository = new FakeNotificationsRepository();
  repository.memberships.add(`${COMMUNITY_A}:${USER_A}`);
  repository.inbox.push(
    inboxRow("00000000-0000-4000-8000-000000000101", COMMUNITY_A, USER_A),
    inboxRow("00000000-0000-4000-8000-000000000102", COMMUNITY_B, USER_A),
    inboxRow("00000000-0000-4000-8000-000000000103", COMMUNITY_A, "00000000-0000-4000-8000-000000000099"),
  );
  const store = new NotificationStore(repository);

  const feed = await store.listNotifications(COMMUNITY_A, USER_A);
  assert.deepEqual(feed.items.map((item) => item.id), ["00000000-0000-4000-8000-000000000101"]);
  assert.equal(feed.unreadCount, 1);
  await assert.rejects(() => store.listNotifications(COMMUNITY_B, USER_A), /membership attiva richiesta/);
});

test("non permette di marcare letta una notifica appartenente a un'altra community", async () => {
  const repository = new FakeNotificationsRepository();
  repository.memberships.add(`${COMMUNITY_A}:${USER_A}`);
  repository.notifications.set("notification-b", {
    id: "notification-b",
    communityId: COMMUNITY_B,
    serverId: SERVER_A,
    kind: "server_online",
    actor: null,
    title: "Server online",
    message: "Online",
    metadata: {},
    dedupeKey: "online-b",
    createdAt: new Date().toISOString(),
  });
  const store = new NotificationStore(repository);

  await assert.rejects(
    () => store.markNotificationRead(COMMUNITY_A, USER_A, "notification-b"),
    /notifica non trovata nella community/,
  );
  assert.equal(repository.read.size, 0);
});

test("segna lette tutte le notifiche della community, anche oltre la pagina visibile", async () => {
  const repository = new FakeNotificationsRepository();
  repository.memberships.add(`${COMMUNITY_A}:${USER_A}`);
  for (let index = 0; index < 45; index += 1) {
    repository.inbox.push(inboxRow(`notification-${index}`, COMMUNITY_A, USER_A));
  }
  repository.inbox.push(inboxRow("other-community", COMMUNITY_B, USER_A));
  const store = new NotificationStore(repository);

  const feed = await store.listNotifications(COMMUNITY_A, USER_A, { limit: 40 });
  assert.equal(feed.items.length, 40);
  assert.equal(feed.unreadCount, 45);
  const result = await store.markAllNotificationsRead(COMMUNITY_A, USER_A);
  assert.equal(result.count, 45);
  assert.equal(repository.read.size, 45);
  assert.equal(repository.read.has(`other-community:${USER_A}`), false);
});

test("deduplica la transizione online in modo persistente e si riabilita solo dopo offline", async () => {
  const repository = new FakeNotificationsRepository();
  const firstProcess = new NotificationStore(repository);

  // Prima osservazione online: baseline, nessun falso positivo al deploy.
  await firstProcess.observeServerOnline(COMMUNITY_A, SERVER_A, true);
  assert.equal(repository.notifications.size, 0);

  await firstProcess.observeServerOnline(COMMUNITY_A, SERVER_A, false);
  await firstProcess.observeServerOnline(COMMUNITY_A, SERVER_A, true);
  assert.equal(repository.notifications.size, 1);

  // Simula restart del backend mantenendo repository/stato persistente.
  const restartedProcess = new NotificationStore(repository);
  await restartedProcess.observeServerOnline(COMMUNITY_A, SERVER_A, true);
  assert.equal(repository.notifications.size, 1);

  await restartedProcess.observeServerOnline(COMMUNITY_A, SERVER_A, false);
  await restartedProcess.observeServerOnline(COMMUNITY_A, SERVER_A, true);
  assert.equal(repository.notifications.size, 2);
});

test("la richiesta di accensione include attore e riabilita l'evento online", async () => {
  const repository = new FakeNotificationsRepository();
  const store = new NotificationStore(repository);
  await store.recordServerStartRequested(COMMUNITY_A, SERVER_A, "request-1", {
    id: USER_A,
    name: "Gaia",
    avatarUrl: null,
  });
  await store.recordServerStartRequested(COMMUNITY_A, SERVER_A, "request-1", {
    id: USER_A,
    name: "Gaia",
    avatarUrl: null,
  });

  const created = [...repository.notifications.values()][0]!;
  assert.equal(repository.notifications.size, 1);
  assert.equal(created.kind, "server_start_requested");
  assert.deepEqual(created.actor, { id: USER_A, name: "Gaia", avatarUrl: null });
  assert.equal(created.message, "Gaia ha richiesto l'accensione del server.");
  assert.equal(repository.state?.ark_online, false);
});

test("lo spegnimento del watchdog crea una notifica deduplicata per episodio", async () => {
  const repository = new FakeNotificationsRepository();
  const store = new NotificationStore(repository);
  const since = new Date("2026-09-30T10:00:00.000Z");
  await store.recordWatchdogShutdown(COMMUNITY_A, SERVER_A, since, 90);
  const created = [...repository.notifications.values()];
  assert.equal(created.length, 1);
  assert.equal(created[0]?.kind, "server_watchdog_stopped");
  assert.equal(created[0]?.dedupeKey, `server-watchdog:${SERVER_A}:2026-09-30T10:00:00.000Z`);
  assert.deepEqual(created[0]?.metadata, { offlineSince: "2026-09-30T10:00:00.000Z", minutes: 90 });
});
