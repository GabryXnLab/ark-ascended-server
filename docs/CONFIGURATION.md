# Configuration reference

Environment variables of the **control plane** (backend, [`config.ts`](../control-plane/backend/src/config.ts)) and of the **agent** (inside the managed game image, [`config.ts`](../server-agent/src/config.ts)). The raw image has its own list in [RAW-SERVER.md](RAW-SERVER.md). Empty values behave like unset ones. Examples: [`control-plane/backend/.env.example`](../control-plane/backend/.env.example), [`server-agent/.env.example`](../server-agent/.env.example), and the compose env examples in [`docker/compose/`](../docker/compose). In Compose env files a literal `$` must be written `$$`.

In local mode ([LOCAL-MODE.md](LOCAL-MODE.md)) most of these are set for you by `local.compose.yml` from `local.env`; in OCI mode ([OCI-MODE.md](OCI-MODE.md)) cloud-init writes them from Terraform variables.

## Control plane

### Server and auth

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `BIND` | `3000`, `0.0.0.0` | Listen address |
| `PWA_DIST` | empty | Folder of the built PWA to serve (`/app/pwa` in the image) |
| `SUPABASE_URL` | none | Supabase project URL (required) |
| `SUPABASE_PUBLISHABLE_KEY` | none | Publishable/anon key, handed to the browser (required) |
| `SUPABASE_SECRET_KEY` | none | Service-role key, backend only (required) |
| `ADMIN_EMAILS` | empty | Comma-separated Google emails: first = owner of the community, others = admins. The list is authoritative on every request |
| `COMMUNITY_CREATION_ENABLED` | `true` | Whether signed-in users can create communities (app-level only, no cloud resources) |
| `FLEET_PROVISIONING_ENABLED` | `false` | Must stay `false`: no code path creates cloud resources |
| `CURSEFORGE_API_KEY` | empty | Enables mod search; without it `GET /mods/search` returns an error |
| `SENTRY_DSN` | empty | Optional error reporting; empty = off. Request headers, cookies and bodies are not sent |
| `NODE_ENV`, `APP_REVISION` | `development`, `dev` | Environment and revision labels (the image sets the revision) |

### Instance provider

| Variable | Default | Meaning |
|---|---|---|
| `INSTANCE_PROVIDER` | derived | `oci`, `docker` or `mock`. If unset: `mock` when `OCI_MODE=mock`, otherwise `oci`. Any other value makes the process exit |
| `AGENT_URL` | `http://127.0.0.1:8787` | Base URL of the agent (`http://game-server:8787` in local mode, the VM private IP on OCI) |
| `AGENT_TOKEN` | empty | Shared secret sent as `Authorization: Bearer`; must equal the agent's `AGENT_TOKEN` |

`docker` provider:

| Variable | Default | Meaning |
|---|---|---|
| `DOCKER_HOST` | `unix:///var/run/docker.sock` | Engine API: `tcp://docker-proxy:2375` (socket proxy, recommended) or a socket |
| `DOCKER_API_VERSION` | `v1.41` | API version prefix |
| `GAME_CONTAINER_NAME` | `arksa-game-server` | Name of the game container; it must already exist |
| `PUBLIC_HOST` | empty | Address shown to players when the server is running |
| `GAME_PORT` | `7777` | Display only; the real port is the one Compose publishes |
| `BACKUP_DIR` | `/backups` | Backups folder shared with the agent (used to delete saves) |
| `DOCKER_STOP_TIMEOUT_SEC` | `150` (min 10) | Max wait for `docker stop`; keep it at or above the container's `stop_grace_period` |

`oci` provider:

| Variable | Default | Meaning |
|---|---|---|
| `GAME_INSTANCE_OCID` | empty | Instance to start/stop |
| `OCI_MODE` | `mock` | `instance_principal` (production), `config_file` (uses `~/.oci/config`) or `mock` |
| `OCI_PROFILE` | `DEFAULT` | Profile for `config_file` |
| `OCI_TENANCY_OCID` | empty | Tenancy (cost queries) |
| `BACKUP_BUCKET` | `arksa-backups` | Object Storage bucket for backups |
| `OCI_START_RETRY_BASE_SEC`, `OCI_START_RETRY_MAX_SEC` | `30` (min 5), `300` (min 30) | Backoff when OCI answers "Out of host capacity"; the start request is persistent and survives restarts |
| `GAME_BOOT_ACTIVE_VPUS`, `GAME_BOOT_IDLE_VPUS` | `20`, `10` (min 10) | Boot volume performance during a session and while stopped |

### Behaviour

| Variable | Default | Meaning |
|---|---|---|
| `IDLE_STOP_MINUTES` | `20` | Initial auto-stop timer until someone saves one from the panel (`0` disables) |
| `OFFLINE_WATCHDOG_MINUTES` | `90` (min 30) | Stop the server if ASA is not RCON-online this long after the start (no backup is made) |
| `SAVEGAME_SYNC_INTERVAL_SEC` | `30` | Backup list sync |
| `PLAYTIME_SYNC_INTERVAL_SEC` | `60` | Play time sampling |
| `QUEUED_CONFIG_SYNC_INTERVAL_SEC` | `20` | Applying queued changes when the server is up |
| `MOCK_MONTHLY_COST_EUR` | `25` | Fake cost in `mock` provider |

### Persistence

`DATA_DIR` (default `./data`; the image sets `/data`) is the base for the files below. They must be on a persistent volume, outside any working copy that gets cleaned. Override individual files only if needed:

`PLAYTIME_DATA_FILE`, `REQUESTS_DATA_FILE`, `CONFIGS_DATA_FILE` (configurations and ACLs, authoritative), `SAVEGAMES_DATA_FILE`, `CURRENT_CONFIG_FILE`, `POWER_START_STATE_FILE`, `SHUTDOWN_STATE_FILE`, `BOOT_QUEUE_DATA_FILE`, `ADMIN_WHITELIST_DATA_FILE`, `IDLE_STOP_DATA_FILE`.

## Agent (managed game image)

### Core

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PLATFORM` | `oci` | `docker` (local mode) or `oci`. `docker`: self-stop by SIGTERM to its own process, no OCI calls, no disk growth, backups to a folder |
| `AGENT_MODE` | `mock` | `live` runs the real game (the managed image sets `live`); `mock` keeps in-memory state for development |
| `AGENT_PORT`, `AGENT_BIND` | `8787`, `0.0.0.0` | Listen address. Do not publish this port to the Internet |
| `AGENT_TOKEN` | empty | Shared secret with the control plane |
| `APP_REVISION` | `dev` | Revision label |

### RCON and auto-stop

| Variable | Default | Meaning |
|---|---|---|
| `RCON_HOST`, `RCON_PORT` | `127.0.0.1`, `27020` | RCON endpoint |
| `RCON_PASSWORD` | empty | RCON and in-game admin password. Infrastructure-owned: profiles cannot override it |
| `IDLE_STOP_MINUTES` | `20` | Minutes with zero players before self-stop (`0` disables). Only the initial value: the control plane re-applies the saved one at each boot |
| `WATCHER_INTERVAL_SEC` | `60` | RCON polling interval of the watcher |
| `ARK_SAVE_SETTLE_SEC` | `15` | Wait after `saveworld` |
| `ARK_STOP_TIMEOUT_SEC` | `30` | Wait for ASA to exit after SIGTERM |
| `ARK_ADMIN_LIST_REFRESH_SECONDS` | `5` (min 3) | Polling of the loopback admin whitelist by ASA |
| `PLAYTIME_INTERVAL_SEC` | `30` | Player sampling for play-time stats |

### Backups

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | empty | `docker` platform: backup folder; empty = backups disabled |
| `BACKUP_KEEP_VERSIONS` | `5` | Previous versions kept per profile (`docker`) |
| `BACKUP_RETENTION_DAYS` | `30` | Max age of previous versions (`docker`) |
| `BACKUP_BUCKET` | empty | `oci` platform: bucket; empty = backups disabled |
| `ARK_LAST_BACKUP_FILE` | `/data/last-backup.json` | Last backup record |

### OCI only

`OCI_INSTANCE_OCID` (empty: read from instance metadata), `OCI_AUTH` (`instance_principal`), `ARK_BOOT_IDLE_VPUS` (`10`, min 10), `DISK_GROW_THRESHOLD_PCT` (`80`), `DISK_GROW_STEP_GB` (`20`; forced to `0` on `docker`), `DISK_GROW_MAX_GB` (`150`), `DISK_GROW_COOLDOWN_MIN` (`60`). Disk growth only ever enlarges the boot volume.

### Game launch variables (read by `launch.sh`)

`SESSION_NAME`, `MAX_PLAYERS`, `GAME_PORT`, `QUERY_PORT`, `SERVER_PASSWORD`, `SERVER_PLATFORM`, `EXTRA_ARGS` and the Wine/Proton tuning variables behave as in [RAW-SERVER.md](RAW-SERVER.md#environment-variables). In the managed version the panel writes `SessionName`, `MaxPlayers`, `ServerPlatform` and `ServerPassword` into the INI from the active configuration, and those values override the env defaults. `ARK_ADMIN_LIST_URL` is set by the managed entrypoint to the agent's loopback endpoint; in the raw image it is never set.

### File locations

These default to paths under `/data` that match the image (`ARK_INSTALL_DIR`, `ARK_MAPS_DIR`, `ARK_ACTIVE_MAP_FILE`, `ARK_ACTIVE_PROFILE_FILE`, `ARK_ACTIVE_CONFIG_FILE`, `ARK_MOD_VERSIONS_FILE`, `ARK_ACTIVE_MODS_FILE`, `ARK_LAUNCH_ARGS_FILE`, `ARK_ALLOWED_CHEATER_ACCOUNTS_FILE`, `ARK_GUS_INI`, `ARK_GAME_INI`, `ARK_LAUNCH_SCRIPT`, `ARK_PID_FILE`, `ARK_LAUNCH_LOG_FILE`, `ARK_PLAYTIME_LOG_FILE`, `ARK_WINESERVER_BINARY`, `ARK_WINEPREFIX`, `ARK_APPID`, `ARK_STEAMCMD_SCRIPT`, `ARK_XAUDIO_INSTALL_SCRIPT`, `ARK_UPDATE_TIMEOUT_SEC`). Leave them alone unless you build a custom image.
