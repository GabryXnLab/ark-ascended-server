// Configurazione dell'agent, letta da ambiente con default ragionevoli.

function envStr(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? def : v;
}
function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export type AgentMode = "mock" | "live";
export type AgentPlatform = "oci" | "docker";

function parsePlatform(): AgentPlatform {
  const v = envStr("AGENT_PLATFORM", "oci");
  if (v !== "oci" && v !== "docker") {
    throw new Error(`AGENT_PLATFORM non valido: "${v}" (ammessi: oci, docker)`);
  }
  return v;
}

const agentPort = envInt("AGENT_PORT", 8787);

export interface Config {
  port: number;
  bind: string;
  token: string;
  mode: AgentMode;
  platform: AgentPlatform;
  imageRevision: string;

  // Installazione ARK dentro il volume persistente del container (vedi
  // docker/game-server/Dockerfile/launch.sh). Un solo processo ARK alla volta,
  // nessun concetto di "servizio"/unità systemd (spawn/kill diretto in ark.ts).
  arkInstallDir: string;
  gusIni: string;
  gameIni: string;

  mapsDir: string;
  activeMapFile: string;
  activeProfileFile: string;
  activeConfigFile: string;
  modVersionsFile: string;
  activeModsFile: string;
  launchArgsFile: string;
  allowedCheaterAccountsFile: string;
  adminListUrl: string;
  adminListRefreshSeconds: number;

  launchScript: string;
  pidFile: string;
  launchLogFile: string;
  wineServerBinary: string;
  winePrefix: string;
  stopTimeoutSec: number;
  saveSettleSec: number;
  arkAppId: string;
  steamCmdScript: string;
  xaudioInstallScript: string;
  gameUpdateTimeoutSec: number;

  rconHost: string;
  rconPort: number;
  rconPassword: string;

  idleStopMinutes: number;
  watcherIntervalSec: number;

  playtimeLogFile: string;
  playtimeIntervalSec: number;

  ociInstanceOcid: string;
  ociAuth: string;

  backupBucket: string;
  backupDir: string;
  backupKeepVersions: number;
  backupRetentionDays: number;
  backupEnabled: boolean;
  lastBackupFile: string;

  diskGrowThresholdPct: number;
  diskGrowStepGb: number;
  diskGrowMaxGb: number;
  diskGrowCooldownMin: number;
  bootIdleVpus: number;
}

const platform = parsePlatform();

export const config: Config = {
  port: agentPort,
  bind: envStr("AGENT_BIND", "0.0.0.0"),
  token: envStr("AGENT_TOKEN", ""),
  mode: (envStr("AGENT_MODE", "mock") as AgentMode),
  platform,
  imageRevision: envStr("APP_REVISION", "dev"),

  arkInstallDir: envStr("ARK_INSTALL_DIR", "/data/ark"),
  mapsDir: envStr("ARK_MAPS_DIR", "/data/maps"),
  gusIni: envStr(
    "ARK_GUS_INI",
    "/data/ark/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini",
  ),
  gameIni: envStr(
    "ARK_GAME_INI",
    "/data/ark/ShooterGame/Saved/Config/WindowsServer/Game.ini",
  ),
  activeMapFile: envStr("ARK_ACTIVE_MAP_FILE", "/data/active-map"),
  activeProfileFile: envStr("ARK_ACTIVE_PROFILE_FILE", "/data/active-profile"),
  activeConfigFile: envStr("ARK_ACTIVE_CONFIG_FILE", "/data/active-configuration.json"),
  modVersionsFile: envStr("ARK_MOD_VERSIONS_FILE", "/data/mod-versions.json"),
  activeModsFile: envStr("ARK_ACTIVE_MODS_FILE", "/data/active-mods"),
  launchArgsFile: envStr("ARK_LAUNCH_ARGS_FILE", "/data/arksa-launch-args"),
  allowedCheaterAccountsFile: envStr(
    "ARK_ALLOWED_CHEATER_ACCOUNTS_FILE",
    "/data/ark/ShooterGame/Saved/AllowedCheaterAccountIDs.txt",
  ),
  adminListUrl: `http://127.0.0.1:${agentPort}/admin-whitelist.txt`,
  adminListRefreshSeconds: Math.max(3, envInt("ARK_ADMIN_LIST_REFRESH_SECONDS", 5)),

  launchScript: envStr("ARK_LAUNCH_SCRIPT", "/opt/arksa/launch.sh"),
  pidFile: envStr("ARK_PID_FILE", "/data/ark.pid"),
  launchLogFile: envStr("ARK_LAUNCH_LOG_FILE", "/data/launch.log"),
  wineServerBinary: envStr("ARK_WINESERVER_BINARY", "/opt/proton/files/bin/wineserver"),
  winePrefix: envStr("ARK_WINEPREFIX", "/data/proton-prefix/pfx"),
  stopTimeoutSec: envInt("ARK_STOP_TIMEOUT_SEC", 30),
  saveSettleSec: Math.max(0, envInt("ARK_SAVE_SETTLE_SEC", 15)),
  arkAppId: envStr("ARK_APPID", "2430930"),
  steamCmdScript: envStr("ARK_STEAMCMD_SCRIPT", "/opt/steamcmd/steamcmd.sh"),
  xaudioInstallScript: envStr("ARK_XAUDIO_INSTALL_SCRIPT", "/opt/arksa/install-xaudio2.sh"),
  gameUpdateTimeoutSec: Math.max(60, envInt("ARK_UPDATE_TIMEOUT_SEC", 1800)),

  rconHost: envStr("RCON_HOST", "127.0.0.1"),
  rconPort: envInt("RCON_PORT", 27020),
  rconPassword: envStr("RCON_PASSWORD", ""),

  idleStopMinutes: envInt("IDLE_STOP_MINUTES", 20),
  watcherIntervalSec: envInt("WATCHER_INTERVAL_SEC", 60),

  playtimeLogFile: envStr("ARK_PLAYTIME_LOG_FILE", "/data/playtime.jsonl"),
  playtimeIntervalSec: envInt("PLAYTIME_INTERVAL_SEC", 30),

  ociInstanceOcid: envStr("OCI_INSTANCE_OCID", ""),
  ociAuth: envStr("OCI_AUTH", "instance_principal"),

  backupBucket: envStr("BACKUP_BUCKET", ""),
  backupDir: envStr("BACKUP_DIR", ""),
  backupKeepVersions: Math.max(0, envInt("BACKUP_KEEP_VERSIONS", 5)),
  backupRetentionDays: Math.max(0, envInt("BACKUP_RETENTION_DAYS", 30)),
  backupEnabled:
    platform === "docker" ? envStr("BACKUP_DIR", "") !== "" : envStr("BACKUP_BUCKET", "") !== "",
  lastBackupFile: envStr("ARK_LAST_BACKUP_FILE", "/data/last-backup.json"),

  diskGrowThresholdPct: envInt("DISK_GROW_THRESHOLD_PCT", 80),
  // Su Docker il disco è dell'host: niente crescita automatica.
  diskGrowStepGb: platform === "docker" ? 0 : envInt("DISK_GROW_STEP_GB", 20),
  diskGrowMaxGb: envInt("DISK_GROW_MAX_GB", 150),
  diskGrowCooldownMin: envInt("DISK_GROW_COOLDOWN_MIN", 60),
  bootIdleVpus: Math.max(10, envInt("ARK_BOOT_IDLE_VPUS", 10)),
};

export const isMock = (): boolean => config.mode === "mock";
