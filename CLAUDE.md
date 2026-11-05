# CLAUDE.md — ark-ascended-server

## What this is

Open source (MIT) Docker images for an ARK: Survival Ascended dedicated server on Linux via Proton-GE, in two flavours: **raw** (`ark-ascended-server`, server only, env-configured) and **full** (`ark-ascended-server-managed` + `ark-ascended-control-plane`: PWA panel with Google login via Supabase, on-demand power, versioned configurations, CurseForge mods, backups, auto-stop, notifications, communities). The full version controls the game either as a local container (`INSTANCE_PROVIDER=docker`) or as an Oracle Cloud VM provisioned by Terraform (`oci`). Human docs: `README.md` and `docs/`.

## Stack

TypeScript everywhere (Node 20 in images, Node 24 in CI): Express backend (`control-plane/backend`), React + Vite PWA (`control-plane/pwa`), Express agent (`server-agent`). Bash for the game launcher/entrypoints (`docker/game-server`). Supabase (Postgres + Google auth, `supabase/migrations`). Terraform for OCI (`terraform/`). Package manager: npm (each package has its own `package-lock.json`; there is no root workspace).

## Structure

- `docker/game-server/` Dockerfile (targets `raw`, then `managed` = `FROM raw` + Node + agent), `standalone-entrypoint.sh` (raw), `entrypoint.sh` (managed), `launch.sh`, `install-xaudio2.sh`
- `docker/control-plane/` control plane image, `Caddyfile.tmpl`
- `docker/compose/` compose files and `*.env.example` (`server-raw`, `local`, `control-plane`, `game-server`, `dev`)
- `server-agent/` agent inside the game container (RCON, provisioning, INI, mods, backups, self-stop)
- `control-plane/backend/`, `control-plane/pwa/` panel
- `supabase/`, `scripts/` migrations and setup helpers; `terraform/` OCI modules and cloud-init
- `config/maps/` default map profiles; `docs/` English documentation

## Commands

Per package (`server-agent`, `control-plane/backend`, `control-plane/pwa`), after `npm ci`:

- `npm run typecheck`, `npm test` (what CI runs); `npm run build`; `npm run dev`
- Backend and agent tests: `node --test --import tsx test/*.test.ts`; PWA tests: `node --test test/*.test.ts` (needs Node 24)

Config rules shared copy (after editing `control-plane/pwa/src/configRules.ts` or the catalog), from `server-agent/`: `node --import tsx ../scripts/sync-config-rules.mts` (add `--check` to verify).

Checks that CI also runs: `bash -n` and `shellcheck -S warning` on `docker/game-server/*.sh`, `docker/control-plane/*.sh`, `scripts/*.sh`; `docker compose config -q` on each compose file with its `.env.example`.

Images (context = repo root): `docker buildx build --platform linux/amd64 --target raw -f docker/game-server/Dockerfile .`, same with `--target managed`; control plane: `docker build -f docker/control-plane/Dockerfile .`. Publishing is done by `.github/workflows/images.yml` on `main` and `v*` tags.

## Constraints

- ASA only ships a Windows server: it runs under Wine/Proton with software Vulkan and Xvfb; none of these can be dropped (see `docs/PERFORMANCE.md`). Never assume a native Linux binary.
- The game server is x86_64 only (`linux/amd64`); the control plane image is also built for arm64. Do not mix the roles.
- The game server defaults to STOPPED; everything is designed around starting and stopping it on demand. Never destroy the instance/container or its volume to "restart" it; stop/start. Game files, mods and saves live in `/data`.
- The `raw` image must stay free of Node and the agent. `managed` is `FROM raw`; the managed entrypoint must not run SteamCMD itself, the agent owns updates. The post-SteamCMD logic in `standalone-entrypoint.sh` mirrors `server-agent/src/content-updates.ts`: keep the two aligned.
- No game files, no Microsoft DLLs in images (XAudio2 is downloaded from NuGet at runtime, pinned by SHA-256).
- `RCON_PASSWORD` doubles as `ServerAdminPassword` and is infrastructure-owned: profiles must never override it (nor `RCONPort`, `AdminListURL`).
- In local mode the control plane never mounts the Docker socket and never creates containers; only a socket proxy allowing inspect/start/stop of the game container.
- `FLEET_PROVISIONING_ENABLED` stays `false`: no code path may create cloud resources.
- Terraform: the game instance has `prevent_destroy` and ignores metadata changes by design.
- Never commit secrets, `*.tfstate`, `terraform.tfvars` or real `.env` files. Do not put real IPs, emails, OCIDs, project refs or domains in code, docs or examples.

## Conventions

- Documentation, UI strings aside, is in English. The PWA UI and the existing code comments are in Italian; write new code comments in English, and only to explain a non-obvious why.
- Identifiers in English. Verify every env var and command against the code and the `*.env.example` files before documenting it.
- Compose env files: a literal `$` must be written `$$`.
- Atomic commits, one purpose each; no unrelated refactors.
