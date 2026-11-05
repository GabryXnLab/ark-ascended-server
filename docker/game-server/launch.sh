#!/usr/bin/env bash
# Lancia ASA via Proton-GE per la mappa passata come $1 (es. Astraeos_WP).
# Invocato dal server-agent in modalità ARK_LAUNCH_MODE=process (spawn diretto,
# niente systemd). La configurazione runtime arriva da variabili d'ambiente
# (impostate da docker/compose/game-server.compose.yml), non da /etc/arksa/*.
set -euo pipefail
MAP="${1:?mappa richiesta}"
PROFILE_ID="${2:-}"

ARK_DIR="${ARK_INSTALL_DIR:-/data/ark}"
PROTON_DIR="${PROTON_DIR:-/opt/proton}"

# Il nome sessione impostato dalla PWA (via /ini → GameUserSettings.ini,
# sezione [SessionSettings]) deve avere la precedenza sul default statico
# SESSION_NAME dell'env: il parametro ?SessionName= sulla riga di comando
# vince sempre sull'ini, quindi va costruito leggendo prima il file, non
# hardcodando solo la env var (altrimenti rinominare da web app non avrebbe
# alcun effetto, pur scrivendo correttamente l'ini).
GUS_INI="${ARK_GUS_INI:-$ARK_DIR/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini}"

# Le chiavi si cercano nella sezione scritta dalla PWA (catalogo): l'agent
# preserva le chiavi omonime di ASA o delle mod in altre sezioni (per esempio
# MaxPlayers in [/Script/Engine.GameSession]) e non devono sostituirle.
ini_has() {
  [[ -f "$GUS_INI" ]] && awk -v key="$1" -v want="${2,,}" '
    /^[[:space:]]*\[/ { line = $0; gsub(/^[[:space:]]*\[|\][[:space:]]*\r?$/, "", line); current = tolower(line); next }
    current == want && index($0, key "=") == 1 { found = 1; exit }
    END { exit found ? 0 : 1 }
  ' "$GUS_INI"
}

ini_value() {
  awk -v key="$1" -v want="${2,,}" '
    /^[[:space:]]*\[/ { line = $0; gsub(/^[[:space:]]*\[|\][[:space:]]*\r?$/, "", line); current = tolower(line); next }
    current == want && index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }
  ' "$GUS_INI"
}

ini_true() {
  local value=""
  ini_has "$1" ARKSA.Launch && value="$(ini_value "$1" ARKSA.Launch)"
  [[ "${value,,}" == "true" || "$value" == "1" ]]
}

SESSION_NAME_INI=""; ini_has SessionName SessionSettings && SESSION_NAME_INI="$(ini_value SessionName SessionSettings)"
SESSION_NAME="${SESSION_NAME_INI:-${SESSION_NAME:-ARK On-Demand}}"
# Nell'URL di avvio "?" separa le opzioni e le virgolette rompono il parsing: la
# PWA le rifiuta, ma un INI modificato a mano non deve troncare le altre opzioni.
if [[ "$SESSION_NAME" == *[\?\"]* ]]; then
  echo "SessionName contiene ? o virgolette: sostituiti con spazi" >&2
  SESSION_NAME="${SESSION_NAME//[\?\"]/ }"
fi

MAX_PLAYERS_INI=""; ini_has MaxPlayers ARKSA.Launch && MAX_PLAYERS_INI="$(ini_value MaxPlayers ARKSA.Launch)"
MAX_PLAYERS="${MAX_PLAYERS_INI:-${MAX_PLAYERS:-20}}"

# La porta RCON è infrastrutturale (la usa anche l'agent): un RCONPort nell'INI
# viene ignorato e riallineato qui sotto.
RCON_PORT="${RCON_PORT:-27020}"
GAME_PORT="${GAME_PORT:-7777}"
QUERY_PORT="${QUERY_PORT:-27015}"

# Un'unica credenziale infrastrutturale alimenta sia RCON sia la console admin.
# I profili non possono sovrascriverla: altrimenti GET /configs distribuirebbe
# un segreto operativo e una modifica PWA potrebbe spezzare health, saveworld e
# auto-stop. RCON_PASSWORD è già l'env obbligatoria dell'agent.
SERVER_ADMIN_PASSWORD="${RCON_PASSWORD:?RCON_PASSWORD richiesta}"
# La whitelist admin dinamica esiste solo con l'agent (target managed), che
# imposta ARK_ADMIN_LIST_URL: nel raw AdminListURL non deve comparire.
ARKSA_ADMIN_LIST_URL="${ARK_ADMIN_LIST_URL:-}"
ARKSA_ADMIN_LIST_REFRESH_SECONDS="${ARK_ADMIN_LIST_REFRESH_SECONDS:-5}"
if [[ ! "$ARKSA_ADMIN_LIST_REFRESH_SECONDS" =~ ^[0-9]+$ ]] || (( ARKSA_ADMIN_LIST_REFRESH_SECONDS < 3 )); then
  echo "ARK_ADMIN_LIST_REFRESH_SECONDS deve essere un intero >= 3" >&2
  exit 1
fi
export ARKSA_ADMIN_LIST_URL ARKSA_ADMIN_LIST_REFRESH_SECONDS RCON_PORT

# ASA può ripersistire impostazioni amministrative nel proprio INI durante lo
# shutdown. Quei valori locali non sono mai una fonte: prima di ogni avvio li
# riallineiamo all'infrastruttura e riduciamo eventuali duplicati storici. La
# lista viene servita dall'agent solo su loopback e riletta senza riavvio.
sync_infrastructure_admin_ini() {
  mkdir -p "$(dirname "$GUS_INI")"
  [[ -f "$GUS_INI" ]] || install -m 600 /dev/null "$GUS_INI"
  local tmp
  tmp="$(mktemp "${GUS_INI}.arksa-admin.XXXXXX")"
  if ! awk '
    tolower($0) ~ /^[[:space:]]*[+-]?(serveradminpassword|rconport)[[:space:]]*=/ {
      next
    }
    ENVIRON["ARKSA_ADMIN_LIST_URL"] != "" && tolower($0) ~ /^[[:space:]]*[+-]?(adminlisturl|updateallowedcheatersinterval)[[:space:]]*=/ {
      next
    }
    tolower($0) ~ /^[[:space:]]*\[serversettings\][[:space:]]*\r?$/ {
      print
      if (!written) {
        print "ServerAdminPassword=" ENVIRON["RCON_PASSWORD"]
        if (ENVIRON["ARKSA_ADMIN_LIST_URL"] != "") {
          print "AdminListURL=\"" ENVIRON["ARKSA_ADMIN_LIST_URL"] "\""
          print "UpdateAllowedCheatersInterval=" ENVIRON["ARKSA_ADMIN_LIST_REFRESH_SECONDS"]
        }
        print "RCONPort=" ENVIRON["RCON_PORT"]
      }
      written = 1
      next
    }
    { print }
    END {
      if (!written) {
        if (NR > 0) print ""
        print "[ServerSettings]"
        print "ServerAdminPassword=" ENVIRON["RCON_PASSWORD"]
        if (ENVIRON["ARKSA_ADMIN_LIST_URL"] != "") {
          print "AdminListURL=\"" ENVIRON["ARKSA_ADMIN_LIST_URL"] "\""
          print "UpdateAllowedCheatersInterval=" ENVIRON["ARKSA_ADMIN_LIST_REFRESH_SECONDS"]
        }
        print "RCONPort=" ENVIRON["RCON_PORT"]
      }
    }
  ' "$GUS_INI" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$GUS_INI"
}
sync_infrastructure_admin_ini

# A differenza degli altri valori, la stringa vuota è significativa: rimuove
# la password giocatore e rende pubblico il server. L'env è solo il default
# quando la chiave non è mai stata scritta dalla configurazione PWA.
if ini_has ServerPassword ServerSettings; then
  SERVER_PASSWORD="$(ini_value ServerPassword ServerSettings)"
else
  SERVER_PASSWORD="${SERVER_PASSWORD:-}"
fi
# Una password che non sopravvive all'URL di avvio non va mai troncata in silenzio:
# il server risulterebbe pubblico. Meglio non avviarlo.
if [[ "$SERVER_PASSWORD" == *[\?\"[:space:]]* ]]; then
  echo "ServerPassword contiene ?, virgolette o spazi: non è utilizzabile nell'URL di avvio" >&2
  exit 1
fi

SERVER_PLATFORM_INI=""; ini_has ServerPlatform ARKSA.Launch && SERVER_PLATFORM_INI="$(ini_value ServerPlatform ARKSA.Launch)"
SERVER_PLATFORM="${SERVER_PLATFORM_INI:-${SERVER_PLATFORM:-ALL}}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

# Opzioni ASA che esistono solo sulla riga di comando. La PWA le conserva in
# [ARKSA.Launch] nello stesso INI persistente, ma il gioco riceve esclusivamente
# gli argomenti ufficiali qui generati. L'array mantiene ogni valore in un solo
# argv (anche se contiene spazi) e non passa mai attraverso eval.
ARKSA_ARGS=()
ini_true EnableIdlePlayerKick && ARKSA_ARGS+=("-EnableIdlePlayerKick")
ini_true AutoDestroyStructures && ARKSA_ARGS+=("-AutoDestroyStructures")
ini_true ForceAllowCaveFlyers && ARKSA_ARGS+=("-ForceAllowCaveFlyers")
ini_true NoDinos && ARKSA_ARGS+=("-NoDinos")
ini_true NoWildBabies && ARKSA_ARGS+=("-NoWildBabies")
ini_true ExclusiveJoin && ARKSA_ARGS+=("-exclusivejoin")
ini_true UseDynamicConfig && ARKSA_ARGS+=("-UseDynamicConfig")
ini_true ServerGameLog && ARKSA_ARGS+=("-servergamelog")
ini_true ServerGameLogIncludeTribeLogs && ARKSA_ARGS+=("-servergamelogincludetribelogs")
ini_true NoTransferFromFiltering && ARKSA_ARGS+=("-NoTransferFromFiltering")
MULTIHOME_IP=""; ini_has MultiHome SessionSettings && MULTIHOME_IP="$(ini_value MultiHome SessionSettings)"
[[ -n "$MULTIHOME_IP" ]] && ARKSA_ARGS+=("-MULTIHOME")

CLUSTER_ID=""; ini_has ClusterId ARKSA.Launch && CLUSTER_ID="$(ini_value ClusterId ARKSA.Launch)"
[[ -n "$CLUSTER_ID" ]] && ARKSA_ARGS+=("-clusterid=$CLUSTER_ID")
CLUSTER_DIR=""; ini_has ClusterDirOverride ARKSA.Launch && CLUSTER_DIR="$(ini_value ClusterDirOverride ARKSA.Launch)"
[[ -n "$CLUSTER_DIR" ]] && ARKSA_ARGS+=("-ClusterDirOverride=$CLUSTER_DIR")

PROFILE_ARGS=()
LAUNCH_ARGS_FILE="${ARK_LAUNCH_ARGS_FILE:-/data/arksa-launch-args}"
if [[ -f "$LAUNCH_ARGS_FILE" ]]; then
  mapfile -t PROFILE_ARGS < "$LAUNCH_ARGS_FILE"
fi

# --- Tuning runtime Wine/Proton per un server headless -----------------------
# ASA non ha un dedicated server nativo Linux né una vera modalità "-nullrhi":
# l'exe carica comunque d3d12/dxgi/vkd3d e richiede un ICD Vulkan funzionante
# anche senza alcun client collegato (vedi docs/PERFORMANCE.md). Non si può
# quindi eliminare Wine/Proton/Vulkan, ma si può evitare che questi strati
# consumino CPU/RAM oltre il necessario per un processo che non disegna mai
# nulla di visibile:
#  - lavapipe/llvmpipe (rasterizzatore software) usa di default un thread per
#    ogni core della VM anche per un "rendering" che non produce output reale:
#    lo limitiamo esplicitamente per lasciare i core al game-thread di ASA.
#  - WINEDEBUG=-all azzera il logging fixme/warn di Wine (overhead puro su un
#    processo headless, nessuno legge quei log).
#  - fsync/esync sono già i default di Proton (richiedono kernel >=5.16, presente
#    sulle immagini Ubuntu OCI): li rendiamo espliciti per non dipendere da un
#    default che potrebbe cambiare tra versioni di Proton.
#  - PROTON_USE_XALIA=0 disattiva il demone di accessibilità di Proton (hook di
#    input per screen reader): inutile senza display/input, risparmio minimo ma reale.
# Tutti i valori sono overridabili da env (game-server.env) per test A/B.
export LP_NUM_THREADS="${LP_NUM_THREADS:-1}"
export WINEDEBUG="${WINEDEBUG:--all}"
export PROTON_NO_FSYNC="${PROTON_NO_FSYNC:-0}"
export PROTON_NO_ESYNC="${PROTON_NO_ESYNC:-0}"
export PROTON_USE_XALIA="${PROTON_USE_XALIA:-0}"

# Bridge steamclient per Proton: lsteamclient.dll (Windows) cerca la libreria
# nativa Linux sotto STEAM_COMPAT_CLIENT_INSTALL_PATH/sdk{32,64}/steamclient.so
# — un STEAM_COMPAT_CLIENT_INSTALL_PATH vuoto (nessun vero client Steam
# installato, solo SteamCMD) fa fallire steamclient_init in modo silenzioso
# (nessun crash del processo ASA, ma un blocco di fatto prima di RCON/mondo:
# verificato dal vivo, log "unable to load native steamclient library" +
# assert in steamclient_main.c visibile solo con WINEDEBUG=+seh). ASA scarica
# già i .so Steamworks redistributable insieme al gioco: basta linkarli dove
# Proton se li aspetta, non serve un vero client Steam installato.
STEAM_SDK_DIR="${STEAM_COMPAT_CLIENT_INSTALL_PATH:-/data/.steam}"
mkdir -p "$STEAM_SDK_DIR/sdk32" "$STEAM_SDK_DIR/sdk64"
[[ -f "$ARK_DIR/steamclient.so" ]] && ln -sf "$ARK_DIR/steamclient.so" "$STEAM_SDK_DIR/sdk32/steamclient.so"
[[ -f "$ARK_DIR/linux64/steamclient.so" ]] && ln -sf "$ARK_DIR/linux64/steamclient.so" "$STEAM_SDK_DIR/sdk64/steamclient.so"

MODS=""
if [[ -f "${ARK_ACTIVE_MODS_FILE:-/data/active-mods}" ]]; then
  MODS="$(cat "${ARK_ACTIVE_MODS_FILE:-/data/active-mods}")"
fi
MODS_ARG=""; [[ -n "$MODS" ]] && MODS_ARG="-mods=$MODS"

PASS_ARG=""; [[ -n "$SERVER_PASSWORD" ]] && PASS_ARG="?ServerPassword=${SERVER_PASSWORD}"
SAVE_ARG=""; [[ -n "$PROFILE_ID" ]] && SAVE_ARG="?AltSaveDirectoryName=${PROFILE_ID}"

WIN64="$ARK_DIR/ShooterGame/Binaries/Win64"
EXE="$WIN64/ArkAscendedServer.exe"

# Il servizio nativo funzionante imposta questa directory con
# WorkingDirectory=. Alcuni componenti UE/EOS/Steamworks risolvono DLL e asset
# relativamente alla cwd anche quando l'exe è passato con un path assoluto.
cd "$WIN64"

exec "$PROTON_DIR/proton" run "$EXE" \
  "${MAP}?listen?SessionName=${SESSION_NAME}${SAVE_ARG}?Port=${GAME_PORT}?QueryPort=${QUERY_PORT}?RCONEnabled=True?RCONPort=${RCON_PORT}?ServerAdminPassword=${SERVER_ADMIN_PASSWORD}${PASS_ARG}" \
  $MODS_ARG \
  -newsaveformat \
  -usestore \
  -WinLiveMaxPlayers="${MAX_PLAYERS}" \
  -ServerPlatform="${SERVER_PLATFORM}" \
  "${ARKSA_ARGS[@]}" \
  "${PROFILE_ARGS[@]}" \
  -nosound \
  ${EXTRA_ARGS}
