#!/usr/bin/env bash
# Entrypoint dell'immagine "raw": un server ASA autonomo, senza control plane né
# agent. Installa/aggiorna il gioco con SteamCMD, avvia launch.sh e allo stop
# (SIGTERM) salva il mondo via RCON prima di chiudere Proton.
# La logica post-SteamCMD replica server-agent/src/content-updates.ts: le due
# copie vanno tenute allineate.
# Le funzioni raggiunte solo dalla trap TERM/INT non sono rilevabili da shellcheck.
# shellcheck disable=SC2317
set -euo pipefail

if [[ "$(id -u)" == "0" ]]; then
  # Un volume Docker nuovo è root:root, ma Proton/SteamCMD non devono girare
  # come root: sistemiamo i permessi e rientriamo come steam.
  mkdir -p /data/ark /data/proton-prefix /data/.steam /data/cache
  # Il chown ricorsivo costa I/O su volumi da 13GB+: serve solo quando la root
  # non appartiene già a steam (prima inizializzazione o volume importato).
  if [[ "$(stat -c '%u:%g' /data)" != "$(id -u steam):$(id -g steam)" ]]; then
    echo "[raw] Correggo ownership del volume dati (prima inizializzazione/import)…"
    chown -R steam:steam /data
  fi
  # /tmp sopravvive a `docker restart`, Xvfb no: un lock orfano lascerebbe il
  # riavvio senza display virtuale.
  install -d -m 1777 /tmp/.X11-unix
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  exec gosu steam "$0" "$@"
fi

log() { echo "[raw] $*"; }

: "${RCON_PASSWORD:?RCON_PASSWORD obbligatoria: impostala nel file env o nel compose}"
ARK_MAP="${ARK_MAP:-TheIsland_WP}"
ARK_MODS="${ARK_MODS:-}"
RCON_PORT="${RCON_PORT:-27020}"
ARK_APPID="${ARK_APPID:-2430930}"
ARK_DIR="${ARK_INSTALL_DIR:-/data/ark}"
STEAMCMD="${ARK_STEAMCMD_SCRIPT:-/opt/steamcmd/steamcmd.sh}"
WINESERVER="${ARK_WINESERVER_BINARY:-/opt/proton/files/bin/wineserver}"
SAVE_SETTLE_SEC="${ARK_SAVE_SETTLE_SEC:-15}"
STOP_TIMEOUT_SEC="${ARK_STOP_TIMEOUT_SEC:-30}"
UPDATE_TIMEOUT_SEC="${ARK_UPDATE_TIMEOUT_SEC:-1800}"
WIN64="$ARK_DIR/ShooterGame/Binaries/Win64"
MODS_FILE="${ARK_ACTIVE_MODS_FILE:-/data/active-mods}"
export RCON_PORT ARK_APPID

install -d /data/ark /data/proton-prefix /data/.steam /data/cache

# Display virtuale: ASA carica comunque d3d12/dxgi/vkd3d all'avvio e senza un
# DISPLAY X reale l'exe abortisce ~1s dopo l'init (lavapipe da solo non basta).
# Stesso schema di entrypoint.sh: un solo Xvfb persistente per container.
export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1024x768x16 -nolisten tcp &
XVFB_PID=$!
for _ in {1..50}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[raw] Xvfb è terminato prima di creare il display ${DISPLAY}" >&2
    exit 1
  fi
  sleep 0.1
done
[[ -S /tmp/.X11-unix/X99 ]] || { echo "[raw] timeout in attesa del display Xvfb ${DISPLAY}" >&2; exit 1; }

steam_certified() {
  grep -Eq "App '${ARK_APPID}' (fully installed|already up to date)" "$1"
}

# Quando Valve ritira un vecchio depot manifest, SteamCMD resta bloccato su
# "state is 0x6": prova l'update differenziale col manifest locale, riceve
# Access Denied e ogni retry ripete l'errore. Il manifest viene isolato (non
# cancellato, per diagnosi) e il tentativo con validate ricostruisce i metadati
# dai file presenti, senza toccare gioco, config o salvataggi.
reset_steam_metadata() {
  local steamapps="$ARK_DIR/steamapps"
  local manifest="$steamapps/appmanifest_${ARK_APPID}.acf"
  if [[ -e "$manifest" ]]; then
    rm -f "$manifest.arksa-stale"
    mv "$manifest" "$manifest.arksa-stale"
    log "SteamCMD: manifesto locale obsoleto isolato in $manifest.arksa-stale"
  fi
  rm -rf "$steamapps/downloading/${ARK_APPID}"
}

update_game() {
  local out attempt code=0
  out="$(mktemp)"
  for attempt in 1 2 3; do
    # Dal terzo tentativo si ricostruisce lo stato locale con validate.
    local validate=()
    if (( attempt == 3 )); then reset_steam_metadata; validate=(validate); fi
    code=0
    timeout "$UPDATE_TIMEOUT_SEC" "$STEAMCMD" +force_install_dir "$ARK_DIR" +login anonymous \
      +app_update "$ARK_APPID" "${validate[@]}" +quit 2>&1 | tee "$out" || code=${PIPESTATUS[0]}
    if (( code == 0 )) && steam_certified "$out"; then rm -f "$out"; return 0; fi
    log "SteamCMD non ha certificato ASA (tentativo ${attempt}/3, code=${code})"
    (( attempt < 3 )) && sleep 5
  done
  rm -f "$out"
  echo "[raw] SteamCMD non ha certificato l'aggiornamento ASA dopo 3 tentativi" >&2
  return 1
}

if [[ "${ARK_SKIP_UPDATE:-0}" == "1" ]]; then
  log "ARK_SKIP_UPDATE=1: salto install/update SteamCMD"
else
  log "Install/update ASA (appid ${ARK_APPID}) in ${ARK_DIR}…"
  update_game
fi

[[ -d "$WIN64" ]] || { echo "[raw] ASA non installato in ${ARK_DIR} (manca ${WIN64})" >&2; exit 1; }

# steamclient64.dll di SteamCMD è incompatibile con Proton; xaudio2_9.dll va
# rimessa dopo ogni update perché SteamCMD può ripristinare i file originali.
rm -f "$WIN64/steamclient64.dll"
/opt/arksa/install-xaudio2.sh "$WIN64"
echo "$ARK_APPID" > "$WIN64/steam_appid.txt"
echo "$ARK_APPID" > "$ARK_DIR/steam_appid.txt"

# launch.sh legge le mod da questo file (lista ID CurseForge separati da virgola).
if [[ -n "$ARK_MODS" ]]; then
  printf '%s' "$ARK_MODS" > "$MODS_FILE"
else
  rm -f "$MODS_FILE"
fi

stopping=0
GAME_PID=""

rcon_cmd() {
  timeout 15 rcon-cli -a "127.0.0.1:${RCON_PORT}" -p "$RCON_PASSWORD" "$@"
}

stop_wineserver() {
  WINEPREFIX="${ARK_WINEPREFIX:-/data/proton-prefix/pfx}" "$WINESERVER" -k 2>/dev/null || true
  WINEPREFIX="${ARK_WINEPREFIX:-/data/proton-prefix/pfx}" timeout 10 "$WINESERVER" -w 2>/dev/null || true
}

graceful_stop() {
  stopping=1
  log "Arresto: saveworld via RCON…"
  if rcon_cmd saveworld; then
    log "saveworld eseguito, attendo ${SAVE_SETTLE_SEC}s per il flush"
    sleep "$SAVE_SETTLE_SEC"
  else
    log "saveworld fallito (RCON non raggiungibile?), procedo"
  fi
  # Il segnale va a tutto il gruppo: killare solo Proton lascerebbe orfani
  # wineserver/steam.exe che collidono con un riavvio ravvicinato.
  kill -TERM -- "-${GAME_PID}" 2>/dev/null || kill -TERM "$GAME_PID" 2>/dev/null || true
  local waited=0
  while kill -0 "$GAME_PID" 2>/dev/null && (( waited < STOP_TIMEOUT_SEC )); do
    sleep 1; waited=$((waited + 1))
  done
  if kill -0 "$GAME_PID" 2>/dev/null; then
    log "ASA non terminato entro ${STOP_TIMEOUT_SEC}s, invio SIGKILL"
    kill -KILL -- "-${GAME_PID}" 2>/dev/null || kill -KILL "$GAME_PID" 2>/dev/null || true
  fi
  stop_wineserver
}

trap 'if [[ -n "$GAME_PID" && "$stopping" == 0 ]]; then graceful_stop; fi' TERM INT

log "Avvio ASA su ${ARK_MAP}…"
# setsid: il gioco diventa leader di un proprio process group, così lo stop può
# raggiungere anche wineserver e figli.
setsid /opt/arksa/launch.sh "$ARK_MAP" &
GAME_PID=$!

code=0
while true; do
  wait "$GAME_PID" && code=0 || code=$?
  # `wait` torna subito (>128) quando un segnale con trap interrompe l'attesa:
  # se è in corso lo stop, aspettiamo davvero la fine del processo.
  if kill -0 "$GAME_PID" 2>/dev/null; then continue; fi
  break
done
stop_wineserver
kill "$XVFB_PID" 2>/dev/null || true
log "ASA terminato con codice ${code}"
exit "$code"
