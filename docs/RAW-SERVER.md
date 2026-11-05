# Raw server image

`ghcr.io/gabryxnlab/ark-ascended-server` is the `raw` target of [`docker/game-server/Dockerfile`](../docker/game-server/Dockerfile): Ubuntu 24.04, SteamCMD, Proton-GE, software Vulkan (lavapipe), Xvfb and `rcon-cli`. No Node.js, no agent, no panel. The entrypoint ([`standalone-entrypoint.sh`](../docker/game-server/standalone-entrypoint.sh)) installs/updates ASA with SteamCMD, applies two mandatory post-install fixes, then starts [`launch.sh`](../docker/game-server/launch.sh).

The image runs `linux/amd64` only. On an ARM host it will not work.

## Run it

`docker run` and Compose quick starts are in the [README](../README.md#quick-start-raw). The Compose file is [`docker/compose/server-raw.compose.yml`](../docker/compose/server-raw.compose.yml) and reads [`server-raw.env.example`](../docker/compose/server-raw.env.example) (copy it to `server-raw.env`). Compose variables you can set in your shell or `--env-file`:

| Variable | Default | Meaning |
|---|---|---|
| `GAME_SERVER_RAW_IMAGE` | `ghcr.io/gabryxnlab/ark-ascended-server:latest` | Image to pull (or the tag given to a local `--build`) |
| `GAME_SERVER_ENV_FILE` | `server-raw.env` | Env file, relative to the compose file |
| `GAME_SERVER_DATA_VOLUME` | `asa-data` | Name of the Docker volume mounted on `/data` |

## Environment variables

Required:

| Variable | Meaning |
|---|---|
| `RCON_PASSWORD` | RCON password. It is also passed to ASA as `ServerAdminPassword` and rewritten into `GameUserSettings.ini` at every start. The container exits if it is missing. |

Server settings:

| Variable | Default | Meaning |
|---|---|---|
| `ARK_MAP` | `TheIsland_WP` | Map to launch (see [Maps](#maps)) |
| `ARK_MODS` | empty | Comma-separated CurseForge mod IDs |
| `SESSION_NAME` | `ARK On-Demand` in `launch.sh` (the example env sets `ARK Ascended Server`) | Name shown in the server list. No `?` or `"`. |
| `MAX_PLAYERS` | `20` | Passed as `-WinLiveMaxPlayers` |
| `SERVER_PASSWORD` | empty | Join password. Empty means a public server. It must not contain `?`, `"` or spaces: `launch.sh` refuses to start otherwise. |
| `SERVER_PLATFORM` | `ALL` | `-ServerPlatform`: `ALL` or `+`-joined `PC`, `XSX`, `PS5`, `WINGDK` (see [Troubleshooting](#troubleshooting)) |
| `EXTRA_ARGS` | empty | Extra command line arguments, appended unquoted (word-split) |
| `GAME_PORT` | `7777` | UDP game port |
| `QUERY_PORT` | `27015` | Passed as `?QueryPort=`. ASA opens no query socket, so this port does not need to be opened or published: server discovery goes through EOS. |
| `RCON_PORT` | `27020` | TCP RCON port |

If you change `GAME_PORT`, change the published port in the compose file accordingly.

Update and shutdown behaviour:

| Variable | Default | Meaning |
|---|---|---|
| `ARK_SKIP_UPDATE` | `0` | `1` skips the SteamCMD install/update at start (game already in the volume) |
| `ARK_UPDATE_TIMEOUT_SEC` | `1800` | Timeout of one SteamCMD attempt |
| `ARK_SAVE_SETTLE_SEC` | `15` | Seconds to wait after `saveworld` before stopping ASA |
| `ARK_STOP_TIMEOUT_SEC` | `30` | Seconds to wait for ASA to exit after SIGTERM before SIGKILL |

Wine/Proton tuning, all optional (defaults set in `launch.sh`, see [PERFORMANCE.md](PERFORMANCE.md)): `LP_NUM_THREADS` (1), `WINEDEBUG` (`-all`), `PROTON_NO_FSYNC` (0), `PROTON_NO_ESYNC` (0), `PROTON_USE_XALIA` (0).

Rarely needed (defaults match the image layout): `ARK_APPID`, `ARK_INSTALL_DIR`, `ARK_STEAMCMD_SCRIPT`, `ARK_WINESERVER_BINARY`, `ARK_WINEPREFIX`, `ARK_ACTIVE_MODS_FILE`, `ARK_GUS_INI`, `ARK_LAUNCH_ARGS_FILE`, `ARK_CACHE_DIR`, `XAUDIO2_REDIST_VERSION`, `XAUDIO2_REDIST_SHA256`.

### Env vs INI precedence

`launch.sh` reads `GameUserSettings.ini` before building the command line. If the file already contains `SessionName` (`[SessionSettings]`), `MaxPlayers` or `ServerPlatform` (`[ARKSA.Launch]`), or `ServerPassword` (`[ServerSettings]`, an empty value there makes the server public), that value wins over the env variable. In the raw image these keys are only present if you wrote them yourself; the `[ARKSA.Launch]` section is a convention of the full version. `ServerAdminPassword` and `RCONPort` are always overwritten from `RCON_PASSWORD` and `RCON_PORT`.

## Volumes and ports

| Path / port | Purpose |
|---|---|
| `/data` (volume) | Everything persistent: `/data/ark` (game, about 13 GB, config and saves under `ShooterGame/Saved`), `/data/proton-prefix` (Wine prefix and shader caches), `/data/.steam`, `/data/cache` (XAudio2 DLL), `/data/active-mods` |
| `7777/udp` | Game |
| `27020/tcp` | RCON. Not published by default; the clean stop uses `127.0.0.1` inside the container. If you publish it, restrict it with a firewall. |

The container starts as root only to fix the ownership of a fresh volume, then runs everything as the unprivileged user `steam` (UID/GID 1000). A bind mount must be writable by UID 1000 or the first start will `chown` it.

Config files live in `/data/ark/ShooterGame/Saved/Config/WindowsServer/` (`GameUserSettings.ini`, `Game.ini`). Edit them while the container is stopped. Saves are under `/data/ark/ShooterGame/Saved/`.

## Maps

`ARK_MAP` takes the internal map name. Names used by the panel's catalog: `TheIsland_WP`, `ScorchedEarth_WP`, `TheCenter_WP`, `Aberration_WP`, `Extinction_WP`, `Astraeos_WP`, `Ragnarok_WP`, `Valguero_WP`, `LostColony_WP`, `Genesis_WP`. Map DLCs must be owned by the clients that join. To change map, change `ARK_MAP` and recreate the container (`docker compose up -d`).

## Mods

Set `ARK_MODS=<id1>,<id2>` (CurseForge mod IDs, the number shown on the mod page). The list is written to `/data/active-mods` at every start and passed as `-mods=`. ASA downloads and updates the mods itself at startup. There is no mod search in the raw version.

## Updates

At every container start SteamCMD checks for a new game build (up to three attempts; the third one runs `validate` and, if SteamCMD is stuck in state `0x6` on a retired depot manifest, sets aside the local `appmanifest` so it can be rebuilt without touching game files or saves). Then the Proton-incompatible `steamclient64.dll` is removed and `xaudio2_9.dll` is installed again (download from NuGet, cached in `/data/cache`, SHA-256 checked). Set `ARK_SKIP_UPDATE=1` to start faster when you know the game is current.

To update the image: `docker compose -f docker/compose/server-raw.compose.yml pull && docker compose -f docker/compose/server-raw.compose.yml up -d` (the data volume is kept). Clients that update before the server will not see it until the next restart updates the server.

## RCON

RCON is always enabled on `RCON_PORT`. From the host:

```bash
docker exec asa rcon-cli -a 127.0.0.1:27020 -p "$RCON_PASSWORD" listplayers
```

(Replace `$RCON_PASSWORD` with the actual password: it is not set in your host shell by default, unless you export it.)

With Compose the container is not named `asa` (Compose names it `<project>-asa-1`, for example `compose-asa-1`): address the service instead, the password is read inside the container:

```bash
docker compose -f docker/compose/server-raw.compose.yml --env-file docker/compose/server-raw.env \
  exec asa sh -c 'rcon-cli -a 127.0.0.1:27020 -p "$RCON_PASSWORD" listplayers'
```

## Clean stop

`docker stop` (SIGTERM) triggers: RCON `saveworld`, wait `ARK_SAVE_SETTLE_SEC`, SIGTERM to the whole ASA process group, wait up to `ARK_STOP_TIMEOUT_SEC`, then SIGKILL and `wineserver -k`. The worst case is about 70 seconds, so the container needs a grace period above that: the compose file sets `stop_grace_period: 90s`, `docker run` needs `--stop-timeout 90`. With Docker's default of 10 seconds the world can be cut mid-save.

## Troubleshooting

**The server does not appear in the in-game list.**
Check, in this order: (1) the port is open on the host and any firewall/NAT: UDP 7777; (2) the client and server build match (see below); (3) on console, the "Show Player Servers" option must be ticked in the session filter. If the server is listed nowhere, joining by IP (`host:7777`) from a PC client tells you whether the problem is networking or listing.

**Console players (PS5/Xbox) cannot see or join it.**
Console crossplay needs `-ServerPlatform`. The default `SERVER_PLATFORM=ALL` allows everyone; if you set a combination, include the consoles you want (for example `PC+XSX+PS5`). A typo makes the server invisible, so use exactly those tokens. On the console, "Show Player Servers" must be enabled in the session filter. Mods that are not console-compatible block console clients.

**"Version mismatch" or the server is not listed right after a game update.**
The server and the clients must be on the same build. Restart the container so SteamCMD pulls the latest build (do not set `ARK_SKIP_UPDATE=1`). If the client is on a build the server does not have yet, wait for Valve to publish it; if SteamCMD cannot reach the new build, check the log for `state is 0x6` handling above.

**The container exits right after the start.**
Run `docker logs asa`. Typical causes: `RCON_PASSWORD` missing; a `SERVER_PASSWORD` with `?`, quotes or spaces; no disk space (the install needs about 13 GB, plan for 30 GB); SteamCMD could not certify the update after three attempts (network or Steam outage: retry later).

**First start is very slow.**
Expected: about 13 GB of download, then shader compilation on the first launch. Later starts are much faster because game, prefix and caches live in the volume.

**Exit code 21 or Proton crashes at launch.**
The image already includes the pieces ASA needs to start (a virtual X display, a software Vulkan driver, the steamclient bridge for Proton). If you built a custom image or changed the runtime, check that they are still there: [PERFORMANCE.md](PERFORMANCE.md) explains why Wine, Proton and Vulkan cannot be dropped.

**The stop loses progress.**
The grace period is too short (see Clean stop), or RCON was unreachable (`saveworld` failed is logged as `[raw] saveworld fallito`).
