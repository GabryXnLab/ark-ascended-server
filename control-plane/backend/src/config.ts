function s(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? def : v;
}
function i(key: string, def: number): number {
  const v = process.env[key];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function b(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const dataDir = s("DATA_DIR", "./data").replace(/\/$/, "");

export type OciMode = "mock" | "instance_principal" | "config_file";
export type InstanceProvider = "oci" | "docker" | "mock";

// Senza INSTANCE_PROVIDER vale il comportamento storico: OCI_MODE=mock è il mock,
// qualunque altro valore è OCI.
export function resolveInstanceProvider(env: NodeJS.ProcessEnv): InstanceProvider {
  const raw = (env.INSTANCE_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "") return (env.OCI_MODE ?? "mock") === "mock" ? "mock" : "oci";
  if (raw === "oci" || raw === "docker" || raw === "mock") return raw;
  throw new Error(`INSTANCE_PROVIDER="${env.INSTANCE_PROVIDER}" non valido: valori ammessi oci, docker, mock`);
}

// OCI_MODE only describes how the OCI SDK authenticates, so it is meaningful
// for the health payload only when the effective provider is OCI.
export function healthMode(provider: InstanceProvider, ociMode: OciMode): string {
  return provider === "oci" ? ociMode : provider;
}

function loadInstanceProvider(): InstanceProvider {
  try {
    return resolveInstanceProvider(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export const config = {
  nodeEnv: s("NODE_ENV", "development"),
  imageRevision: s("APP_REVISION", "dev"),
  port: i("PORT", 3000),
  bind: s("BIND", "0.0.0.0"),
  pwaDist: s("PWA_DIST", ""),
  dataDir,

  // Supabase Auth autentica Google; il backend usa esclusivamente la secret key
  // per leggere/scrivere le tabelle applicative (mai esposta alla PWA).
  supabaseUrl: s("SUPABASE_URL", "").replace(/\/$/, ""),
  supabasePublishableKey: s("SUPABASE_PUBLISHABLE_KEY", ""),
  supabaseSecretKey: s("SUPABASE_SECRET_KEY", ""),
  adminEmails: s("ADMIN_EMAILS", "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  // Creare una community non alloca risorse. Il provisioning fleet resta un
  // gate distinto e spento finché non sono risolti licenza e billing.
  communityCreationEnabled: b("COMMUNITY_CREATION_ENABLED", true),
  fleetProvisioningEnabled: b("FLEET_PROVISIONING_ENABLED", false),
  gameInstanceOcid: s("GAME_INSTANCE_OCID", ""),
  agentUrl: s("AGENT_URL", "http://127.0.0.1:8787").replace(/\/$/, ""),
  agentToken: s("AGENT_TOKEN", ""),

  instanceProvider: loadInstanceProvider(),
  ociMode: s("OCI_MODE", "mock") as OciMode,
  ociProfile: s("OCI_PROFILE", "DEFAULT"),
  ociTenancyOcid: s("OCI_TENANCY_OCID", ""),

  backupBucket: s("BACKUP_BUCKET", "arksa-backups"),

  // Provider docker: il pannello controlla un container già creato da Compose.
  dockerHost: s("DOCKER_HOST", "unix:///var/run/docker.sock"),
  dockerApiVersion: s("DOCKER_API_VERSION", "v1.41"),
  gameContainerName: s("GAME_CONTAINER_NAME", "arksa-game-server"),
  publicHost: s("PUBLIC_HOST", ""),
  // Solo display per la PWA: la porta reale la pubblica Compose.
  gamePort: i("GAME_PORT", 7777),
  backupDir: s("BACKUP_DIR", "/backups").replace(/\/$/, ""),
  dockerStopTimeoutSec: Math.max(10, i("DOCKER_STOP_TIMEOUT_SEC", 150)),
  savegamesDataFile: s("SAVEGAMES_DATA_FILE", `${dataDir}/savegames.json`),
  savegameSyncIntervalSec: i("SAVEGAME_SYNC_INTERVAL_SEC", 30),

  playtimeDataFile: s("PLAYTIME_DATA_FILE", `${dataDir}/playtime-sessions.jsonl`),
  playtimeSyncIntervalSec: i("PLAYTIME_SYNC_INTERVAL_SEC", 60),
  mockMonthlyCostEur: Number(s("MOCK_MONTHLY_COST_EUR", "25")) || 25,

  requestsDataFile: s("REQUESTS_DATA_FILE", `${dataDir}/pending-requests.json`),
  configsDataFile: s("CONFIGS_DATA_FILE", `${dataDir}/game-configs.json`),
  // Configurazione attualmente residente sul game server (l'ultima applicata con successo):
  // usata da boot-sync.ts per ripristinare la sessione da sola quando l'istanza si riaccende
  // senza che l'utente abbia scelto nulla (vedi boot-sync.ts).
  currentConfigFile: s("CURRENT_CONFIG_FILE", `${dataDir}/current-config.json`),
  powerStartStateFile: s("POWER_START_STATE_FILE", `${dataDir}/power-start.json`),
  // Spegnimento in corso dal control plane: sopravvive ai restart del backend (vedi server-shutdown.ts).
  shutdownStateFile: s("SHUTDOWN_STATE_FILE", `${dataDir}/shutdown.json`),
  ociStartRetryBaseSec: Math.max(5, i("OCI_START_RETRY_BASE_SEC", 30)),
  ociStartRetryMaxSec: Math.max(30, i("OCI_START_RETRY_MAX_SEC", 300)),
  // Il boot volume resta economico a VM spenta e passa a Higher Performance
  // solo durante una sessione. OCI applica il cambio elasticamente, senza
  // ricreare volume/istanza né toccare i dati.
  gameBootActiveVpus: Math.max(10, i("GAME_BOOT_ACTIVE_VPUS", 20)),
  gameBootIdleVpus: Math.max(10, i("GAME_BOOT_IDLE_VPUS", 10)),
  // Operazioni dirette (whitelist admin/mod/ini/installazione mappa/selezione config) fatte a game server
  // spento, in attesa di essere applicate al prossimo avvio — vedi boot-queue-store.ts.
  bootQueueDataFile: s("BOOT_QUEUE_DATA_FILE", `${dataDir}/boot-queue.json`),
  adminWhitelistDataFile: s("ADMIN_WHITELIST_DATA_FILE", `${dataDir}/admin-whitelist.json`),
  // Timer auto-stop desiderato: vive qui (sempre acceso) e viene riallineato
  // sull'agent a ogni boot, perché l'agent lo tiene solo in memoria.
  idleStopDataFile: s("IDLE_STOP_DATA_FILE", `${dataDir}/idle-stop.json`),
  // Stesso default dell'agent (IDLE_STOP_MINUTES) finché nessuno salva un valore.
  defaultIdleStopMinutes: Math.max(0, i("IDLE_STOP_MINUTES", 20)),
  // Rete di sicurezza sui costi: VM accesa ma ASA mai RCON-online per così tanto
  // → spegnimento dal control plane. Largo abbastanza da coprire aggiornamento
  // SteamCMD (timeout 30 min) più download mod e primo caricamento del mondo.
  offlineWatchdogMinutes: Math.max(30, i("OFFLINE_WATCHDOG_MINUTES", 90)),
  // Nome storico (dai tempi in cui esisteva solo la coda di selezione config): mantenuto per
  // non rompere un eventuale QUEUED_CONFIG_SYNC_INTERVAL_SEC già impostato in produzione.
  queuedConfigSyncIntervalSec: i("QUEUED_CONFIG_SYNC_INTERVAL_SEC", 20),

  curseforgeApiKey: s("CURSEFORGE_API_KEY", ""),
};

export const isMockOci = () => config.instanceProvider === "mock";
