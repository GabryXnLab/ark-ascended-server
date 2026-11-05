# Local mode (full version on one Docker host)

The control plane (backend + PWA) and the game server container run on the same x86_64 Docker host. The panel starts and stops the game container, no cloud account is needed. Supabase is still required, for Google login and the panel's data.

```
browser --> [caddy, optional] --> control-plane --(tcp, socket proxy)--> docker-proxy --> Docker socket
                                       |  AGENT_URL=http://game-server:8787
                                       v
                                  game-server (managed image, created by you, started/stopped by the panel)
```

Everything is in [`docker/compose/local.compose.yml`](../docker/compose/local.compose.yml); variables are in [`local.env.example`](../docker/compose/local.env.example). Every variable is described in [CONFIGURATION.md](CONFIGURATION.md).

## 1. Supabase project

1. Create a project at supabase.com (the free tier is enough). Note the project ref (the `xxxx` in `https://xxxx.supabase.co`).
2. Apply the migrations in [`supabase/migrations/`](../supabase/migrations). With the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and `supabase login` done:

   ```bash
   export SUPABASE_PROJECT_REF=xxxx
   ./scripts/setup-supabase.sh
   ```

   The script asks for the database password, runs `supabase link` and `supabase db push`, then prints the API keys. You can also run `supabase link` and `supabase db push` yourself, or paste the SQL files in order in the SQL editor.
3. From the project's API settings take the URL, the **publishable** (anon) key and the **secret** (service role) key. The secret key stays on the backend only.

## 2. Google OAuth

1. In Google Cloud Console create an OAuth client of type *Web application* (Google Auth Platform). Add this authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Keep only the `openid`, `email` and `profile` scopes. While the OAuth consent screen is in *Testing*, add every Google account that must sign in to the test users.
2. In the Supabase dashboard enable the Google provider with that client ID and secret (Authentication, Sign In / Providers). Alternatively [`scripts/configure-supabase-google.sh`](../scripts/configure-supabase-google.sh) does it through the Management API (needs `supabase login`, `jq`, `curl`, and `SUPABASE_PROJECT_REF`; it prompts for the client ID and secret so they never touch the disk).
3. In Supabase, Authentication, URL Configuration: set **Site URL** to the address where you will open the panel (for example `http://127.0.0.1:3100`, or `https://panel.example.com` behind Caddy) and add it to the redirect allow-list. The PWA asks Supabase to return to the current page after login.

## 3. Configure and start

```bash
cp docker/compose/local.env.example docker/compose/local.env
```

Edit `local.env`:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: from step 1.
- `ADMIN_EMAILS`: comma-separated Google emails. The first becomes the owner of the community at first login, the others admins.
- `AGENT_TOKEN`, `RCON_PASSWORD`: generate long random strings (`openssl rand -hex 24`). `RCON_PASSWORD` is also the in-game admin password.
- `DOCKER_GID`: group id of the `docker` group on the host (`getent group docker | cut -d: -f3`), needed by the socket proxy.
- `PUBLIC_HOST`: the public IP or DNS name shown to players as the server address.
- `CURSEFORGE_API_KEY` (optional): enables mod search. Get a key from the CurseForge developer console (https://console.curseforge.com).
- A literal `$` in any value must be written `$$`.

Backup folder permissions (see below), then start:

```bash
mkdir -p docker/compose/backups && sudo chgrp 2000 docker/compose/backups && sudo chmod 2770 docker/compose/backups
docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env up -d
```

### Create the game container

The game container is created by you, not by the panel, and sits behind the `game` profile:

```bash
docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env --profile game create game-server
```

The panel can then only start and stop it (container name `GAME_CONTAINER_NAME`, default `arksa-game-server`). If you start the server from the panel before this step, you get an error that tells you to run this command. The first start downloads about 13 GB into the `arksa-game-data` volume (name from `GAME_SERVER_DATA_VOLUME`).

Open `http://127.0.0.1:3100` (`PANEL_BIND`:`PANEL_PORT`), sign in with the first `ADMIN_EMAILS` address, create or apply a configuration and press the power button. Open UDP `GAME_PORT` (7777) and `QUERY_PORT` (27015) on the host firewall/router.

## Backups: `BACKUP_GID` and folder permissions

On a clean stop the agent archives the world of the active profile (`.tar.zst`) into `/backups`; the panel lists, restores and deletes them. The two containers run as different users (the agent as `steam`, the panel as `100:101`), so both are given a shared supplementary group through `group_add: ["${BACKUP_GID:-2000}"]` and the host folder must belong to that group with the setgid bit:

```bash
sudo chgrp <BACKUP_GID> <BACKUP_HOST_DIR> && sudo chmod 2770 <BACKUP_HOST_DIR>
```

Defaults: `BACKUP_GID=2000`, `BACKUP_HOST_DIR=./backups` (relative to `docker/compose`, where the compose file lives, unless you use an absolute path). If the folder is not writable, backups fail; the managed entrypoint does not check this, look at the agent log. Retention per profile: `BACKUP_KEEP_VERSIONS` (default 5 previous versions) and `BACKUP_RETENTION_DAYS` (30).

## Why a socket proxy

Access to the Docker socket is equivalent to root on the host, so the panel never mounts it. The `docker-proxy` service ([wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy)) is the only one that does, read-only, with all capabilities dropped. It answers only the control plane and only for three calls on the game container: `GET .../json` (inspect), `POST .../start`, `POST .../stop`. Container *creation* is never allowed, which is why you run `create` yourself. The proxy and the panel share the `docker-api` network, which is `internal` (no outbound access). The panel only reads `State` and `Id` from inspect, because the container environment contains `RCON_PASSWORD`.

If you rename the container, set `GAME_CONTAINER_NAME` in `local.env`: the proxy allow-list follows it.

## HTTPS / reverse proxy

By default the panel is bound to `127.0.0.1:3100` only. To publish it:

- **Bundled Caddy** (dedicated host with ports 80/443 free): set `ARKSA_DOMAIN` in `local.env` to a domain pointing at the host, then start with the profile:

  ```bash
  docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env --profile caddy up -d
  ```

  Caddy obtains a Let's Encrypt certificate and proxies to the panel ([`Caddyfile.tmpl`](../docker/control-plane/Caddyfile.tmpl)). Remember to put the HTTPS address in the Supabase Site URL.
- **Your own reverse proxy**: leave the profile off and proxy to `127.0.0.1:3100`. To reach the panel from the LAN without a proxy set `PANEL_BIND=0.0.0.0`, but the login flow then runs over plain HTTP.

## Updating

The panel image is replaced with `up -d` after a pull. The game image is replaced only while the server is stopped, because `create` recreates the container (the volume is kept):

```bash
C="docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env"
$C pull && $C up -d
$C --profile game pull game-server && $C --profile game create --force-recreate game-server
```

The game itself (SteamCMD), official maps and CurseForge mods are checked and updated by the agent before each start. New Supabase migrations must be applied to the project before the new panel image (`./scripts/setup-supabase.sh` is idempotent for already-applied files).

## Behaviour to know

- `restart: "no"` on the game container: after an auto-stop the agent ends its own process and the container must stay stopped.
- The panel stops the container with `DOCKER_STOP_TIMEOUT_SEC` (default 150), which must be at least the game container's `stop_grace_period` (90 s) plus the backup time.
- A watchdog stops the container if ASA does not reach RCON-online within 90 minutes (`OFFLINE_WATCHDOG_MINUTES`).
- Costs are not shown in local mode; the usage tab shows play time.
- Multi-community creation is app-level only: `FLEET_PROVISIONING_ENABLED` is forced to `false` and no route creates cloud resources.
