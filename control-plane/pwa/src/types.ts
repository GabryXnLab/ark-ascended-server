export type InstanceState =
  | "RUNNING" | "STOPPED" | "STARTING" | "STOPPING"
  | "PROVISIONING" | "TERMINATED" | "UNKNOWN";

export interface Player { id: string; name: string }

export type PlatformProvider = "oci" | "docker" | "mock";

export interface PlatformInfo {
  provider: PlatformProvider;
  gamePort: number;
  features: { costs: boolean; capacityRetry: boolean; storageLabel: "object-storage" | "local" };
}

export interface Status {
  /** Assente nei backend precedenti: equivale a OCI. */
  platform?: PlatformInfo;
  instance: { state: InstanceState; ocid: string; publicIp: string | null };
  powerStart: {
    pending: boolean;
    attempt: number;
    requestedAt: string | null;
    nextAttemptAt: string | null;
    lastError: string | null;
  };
  ark: {
    online: boolean;
    map: string | null;
    version: string | null;
    players: Player[];
    playerCount: number;
    maxPlayers: number | null;
    profileId: string | null;
    configurationRevision: number | null;
  } | null;
  metrics: {
    cpuPct: number;
    memUsedGb: number;
    memTotalGb: number;
    diskUsedGb: number | null;
    diskTotalGb: number | null;
    uptimeSec: number;
  } | null;
  /** Timer auto-stop persistito sul control plane; `synced` null = VM spenta o agent non pronto. */
  timer: { idleStopMinutes: number; emptySinceSec: number; synced: boolean | null; offlineWatchdogMinutes: number };
  /** Spegnimento avviato dal control plane (manuale o watchdog): salvataggio, backup, stop VM. */
  shutdown: {
    inProgress: boolean;
    reason: "manual" | "watchdog" | null;
    startedAt: string | null;
    lastError: string | null;
  };
  configuration: {
    activeId: string | null;
    activeRevision: number | null;
    desiredId: string | null;
    desiredRevision: number | null;
    stale: boolean;
  };
}

export interface PlayerShare {
  id: string;
  name: string;
  seconds: number;
  pct: number; // 0-100
  shareAmount: number | null;
}

export interface PlaytimeSummary {
  month: string; // YYYY-MM
  /** null quando il provider non ha costi (modalità locale). */
  totalCost: { amount: number; currency: string } | null;
  totalSeconds: number;
  players: PlayerShare[];
}

export interface PlaytimeLogEntry {
  playerId: string;
  name: string;
  startedAt: string;
  endedAt: string | null; // null = sessione ancora in corso
  durationSec: number;
}

export interface PlaytimeLog {
  month: string; // YYYY-MM
  sessions: PlaytimeLogEntry[];
}

export interface ModSearchResult {
  id: number;
  name: string;
  summary: string;
  thumbnailUrl: string | null;
  downloadCount: number;
  websiteUrl: string;
  authors: string[];
  categoryIds: number[];
  dateModified: string | null;
}

export interface ModScreenshot {
  id: number;
  title: string;
  thumbnailUrl: string;
  url: string;
}

export interface ModDetail extends ModSearchResult {
  screenshots: ModScreenshot[];
}

export interface ModCategory {
  id: number;
  name: string;
  slug: string;
  iconUrl: string | null;
  parentCategoryId: number | null;
}

export interface FeaturedMods {
  featured: ModSearchResult[];
  popular: ModSearchResult[];
  recentlyUpdated: ModSearchResult[];
}

export interface FriendPermissions {
  power: boolean;
  timer: boolean;
  applyConfig: boolean;
}

export type Me =
  | { role: "admin"; communityRole?: "owner" | "admin"; id: string; email: string; name: string; avatarUrl: string | null; arkAccountId: string | null }
  | { role: "friend"; communityRole?: "moderator" | "member"; id: string; email: string; name: string; avatarUrl: string | null; arkAccountId: string | null; permissions: FriendPermissions; friendsEnabled: boolean };

export type CommunityVisibility = "public" | "unlisted" | "private";
export type CommunityRole = "owner" | "admin" | "moderator" | "member";

export interface CommunityMembership {
  id: string;
  role: CommunityRole;
  status: "active" | "suspended";
  permissions: FriendPermissions;
}

export interface CommunitySummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  language: string;
  region: string;
  visibility: CommunityVisibility;
  joinPolicy: "request" | "invite" | "closed";
  lifecycle: "draft" | "active" | "suspended" | "closing" | "archived";
  membersEnabled: boolean;
  membership: CommunityMembership | null;
  joinRequest: { id: string; status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string } | null;
  server: { available: boolean; lifecycle: "unallocated" | "provisioning" | "ready" | "suspended" | "deleting" | "deleted" | "error" } | null;
}

export interface ViewerProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  arkAccountId: string | null;
}

export interface ViewerMe {
  profile: ViewerProfile;
  communities: CommunitySummary[];
}

export interface CommunityJoinRequest {
  id: string;
  communityId: string;
  requester: { id: string; email: string; name: string; avatarUrl: string | null };
  message: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
  reviewedAt: string | null;
}

export type CommunityNotificationKind = "server_start_requested" | "server_online" | "server_watchdog_stopped";

export interface CommunityNotification {
  id: string;
  communityId: string;
  serverId: string;
  kind: CommunityNotificationKind;
  actor: { id: string; name: string; avatarUrl: string | null } | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface CommunityNotificationList {
  items: CommunityNotification[];
  unreadCount: number;
}

export interface FriendAccount {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  arkAccountId: string | null;
  authUserId: string | null;
  permissions: FriendPermissions;
  disabled: boolean;
  status: "pending" | "accepted" | "rejected";
  authorizedAt: string;
  lastUsedAt: string | null;
  communityRole?: "admin" | "moderator" | "member";
}

export interface FriendsList {
  friendsEnabled: boolean;
  accounts: FriendAccount[];
}

export interface AdminWhitelistState {
  accountIds: string[];
  initialized: boolean;
  updatedAt: string | null;
  queued: boolean;
  diskMatches: boolean | null;
  instanceState: InstanceState;
}

export type PendingRequestKind = "config";
export type PendingRequestStatus = "pending" | "approved" | "rejected";

export interface PendingRequest {
  id: string;
  kind: PendingRequestKind;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  status: PendingRequestStatus;
  payload: Record<string, unknown>;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface IniOverrideSet {
  values: Record<string, string>;
  sections: Record<string, string>;
  raw?: string;
  managedKeys?: string[];
}

export interface GameConfiguration {
  id: string;
  revision: number;
  name: string;
  map: string;
  mods: number[];
  iniOverrides: {
    gus: IniOverrideSet;
    game: IniOverrideSet;
    launchArgs?: string;
  };
  ownerId: string;
  ownerName: string;
  accessControl: {
    administratorLocked: boolean;
    grants: Record<string, ConfigAccessMode>;
  };
  capabilities: {
    access: "none" | ConfigAccessMode;
    isOwner: boolean;
    canManageAccess: boolean;
    canDelete: boolean;
  };
  accessUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
}

export type ConfigAccessMode = "review" | "full";

export interface ConfigMember extends ViewerProfile {
  membershipId: string;
  role: CommunityRole;
}

export type GameConfigurationInput = Pick<GameConfiguration, "name" | "map" | "mods" | "iniOverrides"> & {
  id?: string;
  baseRevision?: number;
  accessControl?: GameConfiguration["accessControl"];
};

/**
 * Mod effettivamente presente sul disco del game server (Content/Mods), condivisa da
 * tutte le configurazioni che la referenziano: non viene mai scaricata due volte.
 * Disponibile solo a istanza RUNNING (richiede l'agent); `usedByConfigIds` invece è
 * sempre calcolabile lato backend dalle configurazioni salvate, a prescindere dallo
 * stato di accensione.
 */
export interface InstalledMod {
  id: number;
  sizeBytes: number | null;
  installedAt: string | null; // ISO, mtime della cartella su disco
  usedByConfigIds: string[];
  // true solo se l'ID è un vero ModID CurseForge (referenziato da una configurazione);
  // false per gli ID trovati solo su disco, mai da interrogare su CurseForge.
  isCatalogKnown: boolean;
}

/**
 * Fase osservabile del provisioning. La PWA la traduce in una percentuale per
 * passaggi dichiaratamente stimata; non è un conteggio byte, perché il download
 * delle mod-map eseguito da ASA non espone un progresso affidabile.
 */
export type ProvisionStage =
  | "idle" | "checking" | "stopping"
  | "checking-updates" | "updating-game" | "applying-settings" | "updating-mods"
  | "restoring-save" | "starting" | "waiting-online"
  | "online" | "error";

/**
 * Salvataggio (partita) di cui esiste un backup su Object Storage. Copia singola per
 * configurazione, indipendente dalle configurazioni: sopravvive alla cancellazione
 * della sua config (`configId` diventa null, ma nome/mappa/mod restano nello snapshot).
 */
export interface Savegame {
  id: string;
  configId: string | null;
  configName: string;
  map: string;
  mods: number[];
  objectKey: string;
  sizeBytes: number | null;
  lastBackupAt: string | null;
  status: "ok" | "backup-failed";
}

export interface ProvisionState {
  stage: ProvisionStage;
  mapId: string | null;
  startedAt: string | null;
  updatedAt: string;
  error?: string;
}

/**
 * Operazione (whitelist admin o selezione configurazione) fatta a game server spento,
 * in attesa di essere applicata automaticamente al prossimo avvio (vedi
 * boot-queue-store.ts/boot-sync.ts sul backend). In ordine di accodamento.
 */
export type BootQueueKind = "selectConfig" | "adminWhitelist";

export interface BootQueueOp {
  id: string;
  kind: BootQueueKind;
  payload: Record<string, unknown>;
  queuedAt: string;
}
