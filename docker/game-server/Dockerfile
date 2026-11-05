# Immagine runtime del game server ARK: Survival Ascended (Linux + Proton-GE).
# NON contiene i file di gioco (~13GB): vengono scaricati da SteamCMD alla prima
# attivazione di una configurazione dentro /data, un volume persistente montato
# dall'esterno (coerente con la decisione "boot volume persistente, mai
# distruggere l'istanza"). L'immagine
# contiene solo il runtime: SteamCMD, Proton-GE, librerie 32-bit/Vulkan software
# (nessuna GPU richiesta: rendering headless via lavapipe/llvmpipe).
#
# Due target finali:
#   raw      runtime autonomo, senza Node né agent: usabile da solo con
#            docker/compose/server-raw.compose.yml (standalone-entrypoint.sh).
#   managed  raw + Node + server-agent, pilotato dal control plane. È l'ULTIMO
#            stage: un build senza --target produce quindi l'immagine managed.
#
# ASA/Proton sono SOLO x86: l'immagine va sempre buildata/eseguita per
# linux/amd64, anche da host ARM (build cross-platform via buildx/QEMU).
#
# Build: docker buildx build --platform linux/amd64 --target managed -f docker/game-server/Dockerfile -t ark-ascended-server-managed .
#        (--target raw per l'immagine senza agent)
# (contesto = root del repo, serve per copiare server-agent/ e config/maps/)

# --- Stage 1: build server-agent --------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS agent-build
WORKDIR /build
COPY server-agent/package.json server-agent/package-lock.json ./
RUN npm ci
COPY server-agent/tsconfig.json ./
COPY server-agent/src ./src
RUN npm run build

# Dipendenze production separate: il runtime dell'agent è JavaScript puro e
# può essere condiviso con l'immagine amd64; eventuali addon nativi futuri
# fanno fallire esplicitamente la build invece di copiare l'architettura errata.
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS agent-production
WORKDIR /build
COPY server-agent/package.json server-agent/package-lock.json ./
RUN npm ci --omit=dev \
  && test -z "$(find node_modules -type f -name '*.node' -print -quit)"

# Fornisce Node amd64 senza eseguire lo script NodeSource sotto QEMU. /usr/local
# contiene il runtime ufficiale e non dipende dai file Debian dello stage.
FROM node:20-bookworm-slim AS node-runtime

# --- Stage 3: runtime raw ----------------------------------------------------------
# GE-Proton11-1 richiede GLIBC_2.38, assente su Debian 12. Ubuntu 24.04 offre
# GLIBC 2.39 e, a differenza di Debian 13, verifica correttamente gli indici APT
# amd64 sotto il QEMU/binfmt di un runner ARM64 (Debian 13 restituiva
# falsi "No good signature" prima ancora dell'installazione dei pacchetti).
FROM ubuntu:24.04 AS raw

# GE-Proton11-1, non 10-34: quest'ultimo fa segfaultare in modo deterministico
# il processo nativo "steam.exe" (bridge Steamworks di Wine) dentro glibc,
# ~15-270s dopo l'avvio — silenzioso (mai in Sentry, solo in dmesg dell'host,
# diagnosticato via core dump + gdb: NULL deref in una routine memcpy interna,
# chiamata da ntdll.so). Verificato dal vivo: GE-Proton11-1 non riproduce più
# il crash in oltre 30 minuti di run ripetuti (prima: quasi ad ogni tentativo).
ARG GE_PROTON_VERSION=GE-Proton11-1
ARG ARK_APPID=2430930
ENV DEBIAN_FRONTEND=noninteractive

# Dipendenze Proton/SteamCMD (i386, Vulkan software, wine deps) e zstd, che
# tar richiede per backup e ripristino dei salvataggi (.tar.zst). unzip serve a
# install-xaudio2.sh, che estrae la DLL dal pacchetto NuGet a runtime.
RUN dpkg --add-architecture i386 \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends \
       ca-certificates curl wget tar xz-utils zstd unzip gnupg tini gosu libstdc++6 \
       lib32gcc-s1 libc6-i386 libsdl2-2.0-0:i386 \
       winbind libvulkan1 mesa-vulkan-drivers xvfb \
  && rm -rf /var/lib/apt/lists/*

# Utente non privilegiato (Proton/Wine non deve girare come root). Ubuntu crea
# gia l'utente ubuntu con UID/GID 1000: lo rinominiamo per mantenere invariata
# la proprieta dei dati persistenti rispetto alla precedente immagine Debian.
RUN groupmod --new-name steam ubuntu \
  && usermod --login steam --home /home/steam --move-home --shell /bin/bash ubuntu

# SteamCMD e Proton-GE: fanno parte del runtime, vivono nell'immagine (non nel
# volume dati) così un aggiornamento immagine porta anche l'aggiornamento loro.
# Download to files with -f and retries, then verify: an HTTP error or a
# truncated CDN response must fail loudly instead of surfacing as "not in gzip
# format" mid-pipe (seen on the first GitHub-hosted build).
ARG GE_PROTON_SHA512=d5792f4ac81d3832f5fe40467090c67d561b780c6a4236e76f8b59cb1d4ca25c82df91018e79d156bb267a67224a41f0d621a1e6cbbeec79040cc60275dc9e5a
RUN install -d -o steam -g steam /opt/steamcmd /opt/proton \
  && curl -fsSL --retry 5 --retry-all-errors -o /tmp/steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
  && curl -fsSL --retry 5 --retry-all-errors -o /tmp/proton.tar.gz "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/${GE_PROTON_VERSION}/${GE_PROTON_VERSION}.tar.gz" \
  && echo "${GE_PROTON_SHA512}  /tmp/proton.tar.gz" | sha512sum -c - \
  && su steam -c "tar -xzf /tmp/steamcmd.tar.gz -C /opt/steamcmd && tar -xzf /tmp/proton.tar.gz -C /opt/proton --strip-components=1" \
  && rm -f /tmp/steamcmd.tar.gz /tmp/proton.tar.gz

# rcon-cli (MIT, gorcon): saveworld allo stop dell'immagine raw, dove non c'è
# l'agent. Il checksum.txt della release pubblica solo MD5: lo SHA256 qui sotto
# è calcolato sul tarball scaricato dalla release v0.10.3 ed è la fissazione.
ARG RCON_CLI_VERSION=0.10.3
ARG RCON_CLI_SHA256=6962a641ebf9a5957bd0cda1b8acf3e34a23686ae709f6c6a14ac3898521a5cc
RUN curl -fsSL "https://github.com/gorcon/rcon-cli/releases/download/v${RCON_CLI_VERSION}/rcon-${RCON_CLI_VERSION}-amd64_linux.tar.gz" -o /tmp/rcon.tgz \
  && echo "${RCON_CLI_SHA256}  /tmp/rcon.tgz" | sha256sum -c - \
  && tar -xzf /tmp/rcon.tgz -C /tmp \
  && install -m 755 "/tmp/rcon-${RCON_CLI_VERSION}-amd64_linux/rcon" /usr/local/bin/rcon-cli \
  && rm -rf /tmp/rcon.tgz "/tmp/rcon-${RCON_CLI_VERSION}-amd64_linux"

# Il solo SHA non deve invalidare apt, SteamCMD e Proton: resta dopo tutti gli
# strati runtime costosi e prima dei file applicativi che cambiano davvero.
ARG SOURCE_REVISION=dev
ENV ARK_APPID=${ARK_APPID} \
    APP_REVISION=${SOURCE_REVISION} \
    STEAM_COMPAT_CLIENT_INSTALL_PATH=/data/.steam \
    STEAM_COMPAT_DATA_PATH=/data/proton-prefix \
    ARK_INSTALL_DIR=/data/ark \
    ARK_MAPS_DIR=/data/maps \
    ARK_ACTIVE_MAP_FILE=/data/active-map \
    ARK_ACTIVE_PROFILE_FILE=/data/active-profile \
    ARK_ACTIVE_CONFIG_FILE=/data/active-configuration.json \
    ARK_MOD_VERSIONS_FILE=/data/mod-versions.json \
    ARK_ACTIVE_MODS_FILE=/data/active-mods \
    ARK_LAUNCH_ARGS_FILE=/data/arksa-launch-args \
    ARK_ALLOWED_CHEATER_ACCOUNTS_FILE=/data/ark/ShooterGame/Saved/AllowedCheaterAccountIDs.txt \
    ARK_GUS_INI=/data/ark/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini \
    ARK_GAME_INI=/data/ark/ShooterGame/Saved/Config/WindowsServer/Game.ini \
    ARK_PID_FILE=/data/ark.pid \
    ARK_LAUNCH_SCRIPT=/opt/arksa/launch.sh \
    ARK_WINESERVER_BINARY=/opt/proton/files/bin/wineserver \
    ARK_WINEPREFIX=/data/proton-prefix/pfx

COPY docker/game-server/launch.sh /opt/arksa/launch.sh
COPY docker/game-server/install-xaudio2.sh /opt/arksa/install-xaudio2.sh
COPY docker/game-server/standalone-entrypoint.sh /opt/arksa/standalone-entrypoint.sh
RUN chmod 755 /opt/arksa/launch.sh /opt/arksa/install-xaudio2.sh /opt/arksa/standalone-entrypoint.sh \
  && chown -R steam:steam /opt/arksa

VOLUME ["/data"]
EXPOSE 7777/udp 27015/udp 27020/tcp

# Niente "USER steam" qui: il container parte come root così l'entrypoint può
# sistemare i permessi di un volume /data appena creato (di proprietà root)
# prima di ri-eseguirsi come steam via gosu — vedi standalone-entrypoint.sh.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/arksa/standalone-entrypoint.sh"]

# --- Stage 4: runtime managed (raw + Node + server-agent) ---------------------
FROM raw AS managed

COPY --from=node-runtime /usr/local /usr/local

ENV ARK_PLAYTIME_LOG_FILE=/data/playtime.jsonl \
    ARK_LAST_BACKUP_FILE=/data/last-backup.json \
    AGENT_MODE=live

COPY docker/game-server/entrypoint.sh /opt/arksa/entrypoint.sh
COPY config/maps /opt/arksa/default-maps
COPY --from=agent-build /build/dist /opt/arksa/agent/dist
COPY --from=agent-production /build/node_modules /opt/arksa/agent/node_modules
COPY server-agent/package.json /opt/arksa/agent/package.json
# L'agent è l'unico proprietario dell'update: l'entrypoint deve sempre poter
# esporre /health, anche se SteamCMD o il contenuto ASA hanno problemi.
RUN chmod 755 /opt/arksa/entrypoint.sh \
  && ! grep -Eq 'steamcmd\.sh|\+app_update' /opt/arksa/entrypoint.sh \
  && chown -R steam:steam /opt/arksa

EXPOSE 8787/tcp
WORKDIR /opt/arksa/agent
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/arksa/entrypoint.sh"]
