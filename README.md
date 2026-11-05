# ARK: Survival Ascended dedicated server for Linux (Proton-GE)

Docker images that run an **ARK: Survival Ascended (ASA)** dedicated server on Linux. ASA only ships a Windows server, so the images run it through Proton-GE (Wine + software Vulkan, no GPU needed). Two flavours:

- **raw**: just the server, configured with environment variables. Nothing else to run.
- **full**: the same server plus a web panel (PWA) with Google login, on-demand power on/off, versioned configurations, CurseForge mods, backups, auto-stop, notifications and communities. It can control a container on the same host (`docker` provider) or an Oracle Cloud VM provisioned with Terraform (`oci` provider).

## Which one

| | Raw | Full |
|---|---|---|
| Images | `ghcr.io/gabryxnlab/ark-ascended-server` | `ghcr.io/gabryxnlab/ark-ascended-server-managed` + `ghcr.io/gabryxnlab/ark-ascended-control-plane` |
| Configuration | env vars, INI files by hand | web panel, 422 documented settings, versioned configurations |
| Start/stop | `docker compose up/down` | from the panel, auto-stop when idle |
| Mods | `ARK_MODS` (CurseForge IDs) | search and manage from the panel (needs a CurseForge API key) |
| Backups | none built in (back up the volume) | save archive on every clean stop (local folder or OCI Object Storage) |
| Extra requirements | none | Supabase project (free tier is enough) with Google OAuth |
| Where it runs | any x86_64 Docker host | same host (`docker` provider) or OCI (`oci` provider) |
| Guide | [docs/RAW-SERVER.md](docs/RAW-SERVER.md) | [docs/LOCAL-MODE.md](docs/LOCAL-MODE.md), [docs/OCI-MODE.md](docs/OCI-MODE.md) |

The managed image is built `FROM` the raw one and only adds Node.js and the agent. The panel UI is in Italian.

## Requirements

- x86_64 Docker host with Docker Compose v2 (ASA and Proton are x86 only; ARM hosts are not supported for the game server, the control plane image is also built for arm64).
- RAM: 16 GB or more recommended (a running ASA instance uses roughly 10-18 GB depending on map and mods).
- Disk: about 30 GB free (the game alone is about 13 GB, plus the Proton prefix, mods and saves).
- Open UDP port `7777` (game). RCON is TCP `27020` and stays internal unless you publish it.

## Quick start: raw

```bash
docker run -d --name asa \
  --platform linux/amd64 \
  --stop-timeout 90 \
  -e RCON_PASSWORD=change-me \
  -e ARK_MAP=TheIsland_WP \
  -p 7777:7777/udp \
  -v asa-data:/data \
  ghcr.io/gabryxnlab/ark-ascended-server:latest
docker logs -f asa
```

The first start downloads about 13 GB with SteamCMD into the `asa-data` volume; the server is ready only after that.

With Compose, from a clone of this repository:

```bash
cp docker/compose/server-raw.env.example docker/compose/server-raw.env   # set RCON_PASSWORD at least
docker compose -f docker/compose/server-raw.compose.yml --env-file docker/compose/server-raw.env up -d
```

The compose file contains a `build:` section: add `--build` to build the image locally instead of pulling it. All variables, volumes and troubleshooting: [docs/RAW-SERVER.md](docs/RAW-SERVER.md).

## Quick start: full (local mode)

The panel and the game container run on the same Docker host; the panel starts and stops the game container.

```bash
cp docker/compose/local.env.example docker/compose/local.env      # fill in Supabase, tokens, DOCKER_GID, ...
mkdir -p docker/compose/backups && sudo chgrp 2000 docker/compose/backups && sudo chmod 2770 docker/compose/backups
docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env up -d
docker compose -f docker/compose/local.compose.yml --env-file docker/compose/local.env --profile game create game-server
```

Then open the panel (`http://127.0.0.1:3100` by default), sign in with Google and start the server from the UI. You need a Supabase project with the migrations applied and Google OAuth enabled: see [docs/LOCAL-MODE.md](docs/LOCAL-MODE.md).

## Documentation

- [docs/RAW-SERVER.md](docs/RAW-SERVER.md): raw image reference and troubleshooting
- [docs/LOCAL-MODE.md](docs/LOCAL-MODE.md): full stack on one Docker host
- [docs/OCI-MODE.md](docs/OCI-MODE.md): full stack on Oracle Cloud with Terraform
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): environment variables of control plane and agent
- [docs/GAME-SETTINGS.md](docs/GAME-SETTINGS.md): settings catalog and validation
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): what runs under emulation and what was tuned
- Sub-packages: [server-agent](server-agent/README.md), [control-plane/backend](control-plane/backend/README.md), [control-plane/pwa](control-plane/pwa/README.md)

## Legal

- No game files are included in any image. The server is downloaded from Steam by SteamCMD at runtime (anonymous login, app id 2430930), subject to Valve's and Studio Wildcard's terms.
- The Microsoft XAudio2 redistributable DLL is not shipped either: it is downloaded at runtime from the official NuGet package (`Microsoft.XAudio2.Redist`), pinned by version and SHA-256.
- Proton-GE and `rcon-cli` are downloaded at image build time from their upstream releases.
- This project is not affiliated with, endorsed by or sponsored by Studio Wildcard, Snail Games, Valve or Microsoft. "ARK: Survival Ascended" is a trademark of its owners.

## License

[MIT](LICENSE)
