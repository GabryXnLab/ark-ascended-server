#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

ARK_DIR="$TEST_DIR/ark"
PROTON_TEST_DIR="$TEST_DIR/proton"
GUS_INI="$TEST_DIR/GameUserSettings.ini"
ARGS_LOG="$TEST_DIR/args.log"
LAUNCH_ARGS_FILE="$TEST_DIR/launch-args"
WIN64="$ARK_DIR/ShooterGame/Binaries/Win64"
mkdir -p "$WIN64" "$PROTON_TEST_DIR"
: > "$WIN64/ArkAscendedServer.exe"

cat > "$PROTON_TEST_DIR/proton" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" > "$ARKSA_TEST_ARGS_LOG"
EOF
chmod +x "$PROTON_TEST_DIR/proton"

cat > "$GUS_INI" <<'EOF'
[ServerSettings]
# Deve essere ignorata come input e riallineata da RCON_PASSWORD.
ServerAdminPassword=profilo-da-ignorare
+serveradminpassword=duplicato-da-rimuovere
# Anche URL/intervallo del profilo devono essere ignorati.
AdminListURL=https://example.invalid/admins.txt
UpdateAllowedCheatersInterval=600
ServerPassword=
RCONPort=27021
[SessionSettings]
SessionName=ARKSA Launch Test
MultiHome=192.0.2.10
[ARKSA.Launch]
MaxPlayers=33
ServerPlatform=PC+XSX
EnableIdlePlayerKick=True
AutoDestroyStructures=True
ForceAllowCaveFlyers=True
NoDinos=False
NoWildBabies=True
ExclusiveJoin=True
UseDynamicConfig=True
ServerGameLog=True
ServerGameLogIncludeTribeLogs=True
NoTransferFromFiltering=False
ClusterId=test cluster
ClusterDirOverride=/data/cluster shared
EOF
cat > "$LAUNCH_ARGS_FILE" <<'EOF'
-culture=it
-AlwaysTickDedicatedSkeletalMeshes
-CustomNotificationURL=https://example.invalid/hook path
EOF

ARK_INSTALL_DIR="$ARK_DIR" \
ARK_GUS_INI="$GUS_INI" \
ARK_ACTIVE_MODS_FILE="$TEST_DIR/no-mods" \
ARK_LAUNCH_ARGS_FILE="$LAUNCH_ARGS_FILE" \
PROTON_DIR="$PROTON_TEST_DIR" \
STEAM_COMPAT_CLIENT_INSTALL_PATH="$TEST_DIR/steam" \
ARKSA_TEST_ARGS_LOG="$ARGS_LOG" \
ARK_ADMIN_LIST_URL="http://127.0.0.1:8787/admin-whitelist.txt" \
RCON_PASSWORD="admin-test" \
RCON_PORT=27020 \
bash "$(dirname "$0")/launch.sh" TestMap_WP test-profile

grep -Fqx '<-WinLiveMaxPlayers=33>' "$ARGS_LOG"
grep -Fqx '<-ServerPlatform=PC+XSX>' "$ARGS_LOG"
grep -Fqx '<-EnableIdlePlayerKick>' "$ARGS_LOG"
grep -Fqx '<-AutoDestroyStructures>' "$ARGS_LOG"
grep -Fqx '<-ForceAllowCaveFlyers>' "$ARGS_LOG"
grep -Fqx '<-NoWildBabies>' "$ARGS_LOG"
grep -Fqx '<-exclusivejoin>' "$ARGS_LOG"
grep -Fqx '<-UseDynamicConfig>' "$ARGS_LOG"
grep -Fqx '<-servergamelog>' "$ARGS_LOG"
grep -Fqx '<-servergamelogincludetribelogs>' "$ARGS_LOG"
grep -Fqx '<-MULTIHOME>' "$ARGS_LOG"
grep -Fqx '<-clusterid=test cluster>' "$ARGS_LOG"
grep -Fqx '<-ClusterDirOverride=/data/cluster shared>' "$ARGS_LOG"
grep -Fqx '<-culture=it>' "$ARGS_LOG"
grep -Fqx '<-AlwaysTickDedicatedSkeletalMeshes>' "$ARGS_LOG"
grep -Fqx '<-CustomNotificationURL=https://example.invalid/hook path>' "$ARGS_LOG"
grep -Fqx '<TestMap_WP?listen?SessionName=ARKSA Launch Test?AltSaveDirectoryName=test-profile?Port=7777?QueryPort=27015?RCONEnabled=True?RCONPort=27020?ServerAdminPassword=admin-test>' "$ARGS_LOG"
grep -Fqx 'ServerAdminPassword=admin-test' "$GUS_INI"
grep -Fqx 'AdminListURL="http://127.0.0.1:8787/admin-whitelist.txt"' "$GUS_INI"
grep -Fqx 'UpdateAllowedCheatersInterval=5' "$GUS_INI"
# RCONPort=27021 del profilo è ignorato: vale l'env e l'INI viene riallineato.
grep -Fqx 'RCONPort=27020' "$GUS_INI"
[[ "$(grep -Eic '^[[:space:]]*RCONPort[[:space:]]*=' "$GUS_INI")" == "1" ]]
[[ "$(grep -Eic '^[[:space:]]*[+-]?ServerAdminPassword[[:space:]]*=' "$GUS_INI")" == "1" ]]
[[ "$(grep -Eic '^[[:space:]]*[+-]?AdminListURL[[:space:]]*=' "$GUS_INI")" == "1" ]]
[[ "$(grep -Eic '^[[:space:]]*[+-]?UpdateAllowedCheatersInterval[[:space:]]*=' "$GUS_INI")" == "1" ]]
[[ "$(stat -c '%a' "$GUS_INI")" == "600" ]]
if grep -F 'profilo-da-ignorare' "$GUS_INI" >/dev/null; then
  echo "la password admin storica non deve restare nell'INI" >&2
  exit 1
fi

# Anche dopo l'apply sostitutivo dell'agent la riga non esiste: il launcher
# deve ricrearla dall'env, altrimenti ASA può ripristinare un vecchio valore.
grep -Eiv '^[[:space:]]*[+-]?(ServerAdminPassword|AdminListURL|UpdateAllowedCheatersInterval)[[:space:]]*=' "$GUS_INI" > "$GUS_INI.without-admin"
mv "$GUS_INI.without-admin" "$GUS_INI"
ARK_INSTALL_DIR="$ARK_DIR" \
ARK_GUS_INI="$GUS_INI" \
ARK_ACTIVE_MODS_FILE="$TEST_DIR/no-mods" \
ARK_LAUNCH_ARGS_FILE="$LAUNCH_ARGS_FILE" \
PROTON_DIR="$PROTON_TEST_DIR" \
STEAM_COMPAT_CLIENT_INSTALL_PATH="$TEST_DIR/steam" \
ARKSA_TEST_ARGS_LOG="$ARGS_LOG" \
ARK_ADMIN_LIST_URL="http://127.0.0.1:8787/admin-whitelist.txt" \
RCON_PASSWORD="admin-test" \
RCON_PORT=27020 \
bash "$(dirname "$0")/launch.sh" TestMap_WP test-profile
grep -Fqx 'ServerAdminPassword=admin-test' "$GUS_INI"
grep -Fqx 'AdminListURL="http://127.0.0.1:8787/admin-whitelist.txt"' "$GUS_INI"
grep -Fqx 'UpdateAllowedCheatersInterval=5' "$GUS_INI"
[[ "$(grep -Eic '^[[:space:]]*[+-]?ServerAdminPassword[[:space:]]*=' "$GUS_INI")" == "1" ]]
if grep -Fqx '<-NoTransferFromFiltering>' "$ARGS_LOG"; then
  echo "-NoTransferFromFiltering non deve essere forzato quando il profilo lo disattiva" >&2
  exit 1
fi
if grep -F '<-NoDinos>' "$ARGS_LOG" >/dev/null; then
  echo "i flag booleani False non devono essere aggiunti" >&2
  exit 1
fi

# Chiavi omonime di altre sezioni (scritte da ASA o da mod) non vanno lette, e
# caratteri che rompono l'URL di avvio non devono troncare le altre opzioni.
cat > "$GUS_INI" <<'INI'
[/Script/Engine.GameSession]
MaxPlayers=70
[SessionSettings]
SessionName=Mio "server" ?x=1
[ARKSA.Launch]
MaxPlayers=12
[ServerSettings]
ServerPassword=segreta
INI
ARK_INSTALL_DIR="$ARK_DIR" \
ARK_GUS_INI="$GUS_INI" \
ARK_ACTIVE_MODS_FILE="$TEST_DIR/no-mods" \
ARK_LAUNCH_ARGS_FILE="$TEST_DIR/no-launch-args" \
PROTON_DIR="$PROTON_TEST_DIR" \
STEAM_COMPAT_CLIENT_INSTALL_PATH="$TEST_DIR/steam" \
ARKSA_TEST_ARGS_LOG="$ARGS_LOG" \
RCON_PASSWORD="admin-test" \
RCON_PORT=27020 \
bash "$(dirname "$0")/launch.sh" TestMap_WP test-profile 2>/dev/null
grep -Fqx '<-WinLiveMaxPlayers=12>' "$ARGS_LOG"
grep -Fqx '<TestMap_WP?listen?SessionName=Mio  server   x=1?AltSaveDirectoryName=test-profile?Port=7777?QueryPort=27015?RCONEnabled=True?RCONPort=27020?ServerAdminPassword=admin-test?ServerPassword=segreta>' "$ARGS_LOG"

sed -i 's/^ServerPassword=.*/ServerPassword=pass?word/' "$GUS_INI"
if ARK_INSTALL_DIR="$ARK_DIR" ARK_GUS_INI="$GUS_INI" ARK_ACTIVE_MODS_FILE="$TEST_DIR/no-mods" \
  ARK_LAUNCH_ARGS_FILE="$TEST_DIR/no-launch-args" PROTON_DIR="$PROTON_TEST_DIR" \
  STEAM_COMPAT_CLIENT_INSTALL_PATH="$TEST_DIR/steam" ARKSA_TEST_ARGS_LOG="$ARGS_LOG" \
  RCON_PASSWORD="admin-test" bash "$(dirname "$0")/launch.sh" TestMap_WP test-profile 2>/dev/null; then
  echo "una ServerPassword con ? non deve avviare il server (resterebbe senza password)" >&2
  exit 1
fi

# Target raw (nessun agent, ARK_ADMIN_LIST_URL assente): AdminListURL e
# l'intervallo non devono comparire, mentre password e porta RCON sì.
cat > "$GUS_INI" <<'INI'
[ServerSettings]
ServerPassword=
INI
ARK_INSTALL_DIR="$ARK_DIR" ARK_GUS_INI="$GUS_INI" ARK_ACTIVE_MODS_FILE="$TEST_DIR/no-mods" \
  ARK_LAUNCH_ARGS_FILE="$TEST_DIR/no-launch-args" PROTON_DIR="$PROTON_TEST_DIR" \
  STEAM_COMPAT_CLIENT_INSTALL_PATH="$TEST_DIR/steam" ARKSA_TEST_ARGS_LOG="$ARGS_LOG" \
  RCON_PASSWORD="admin-test" RCON_PORT=27020 bash "$(dirname "$0")/launch.sh" TestMap_WP
grep -Fqx 'ServerAdminPassword=admin-test' "$GUS_INI"
grep -Fqx 'RCONPort=27020' "$GUS_INI"
if grep -Eiq 'AdminListURL|UpdateAllowedCheatersInterval' "$GUS_INI"; then
  echo "senza agent AdminListURL non deve comparire nell'INI" >&2
  exit 1
fi

echo "launch.sh: argomenti ASA verificati"
