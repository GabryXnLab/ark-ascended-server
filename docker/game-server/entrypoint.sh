#!/usr/bin/env bash
# Entrypoint del container game-server: assicura ASA installato/aggiornato nel
# volume persistente /data, poi avvia il server-agent (PID gestito da tini).
# L'agent (non questo script) avvia/ferma il processo ARK vero e proprio, via
# launch.sh, su richiesta del control plane.
set -euo pipefail

# Un volume Docker appena creato è di proprietà root:root: Proton/Wine/steamcmd
# devono girare come utente non privilegiato "steam" (Dockerfile non ha più
# USER steam a livello immagine per permettere questo passaggio), quindi se
# partiamo come root sistemiamo i permessi e ci ri-eseguiamo come steam — che
# da solo non avrebbe potuto fare il chown sulla propria directory (verificato
# dal vivo: "install: cannot change permissions" al primo avvio su un volume
# nuovo).
if [[ "$(id -u)" == "0" ]]; then
  mkdir -p /data/ark /data/proton-prefix /data/.steam /data/maps
  # La prima inizializzazione di un volume Docker parte da root:root e richiede
  # davvero una correzione ricorsiva. Nei boot successivi il volume conserva
  # invece uid/gid di steam: scandire di nuovo gioco, mod, prefix e salvataggi
  # aggiunge I/O al percorso critico senza cambiare nulla. Il controllo O(1)
  # sulla root distingue i due casi; se un volume viene sostituito o importato
  # con ownership diversa, il fallback completo resta invariato.
  if [[ "$(stat -c '%u:%g' /data)" != "$(id -u steam):$(id -g steam)" ]]; then
    echo "[entrypoint] Correggo ownership del volume dati (prima inizializzazione/import)…"
    chown -R steam:steam /data
  fi
  # /tmp appartiene al layer scrivibile del container e sopravvive a un
  # `docker restart`: Xvfb invece viene terminato. Senza pulizia, il riavvio
  # successivo trova il lock/socket orfano e resta senza display virtuale.
  install -d -m 1777 /tmp/.X11-unix
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  # gosu would reset the supplementary groups to steam's /etc/group entries,
  # dropping the ones Docker adds with group_add (BACKUP_GID): without that
  # group the agent cannot write the shared backup folder (EACCES).
  extra_groups="$(id -G | tr ' ' '\n' | grep -vx 0 | paste -sd, - || true)"
  steam_groups="$(id -G steam | tr ' ' ',')"
  exec env HOME="$(getent passwd steam | cut -d: -f6)" \
    setpriv --reuid=steam --regid=steam --groups="${steam_groups}${extra_groups:+,$extra_groups}" \
    "$0" "$@"
fi

install -d /data/ark /data/proton-prefix /data/.steam /data/maps

# I profili creati/aggiornati dalla PWA devono sopravvivere al redeploy del
# container. L'immagine contiene solo i default: li seminiamo nel volume senza
# sovrascrivere eventuali profili omonimi già personalizzati.
for profile in /opt/arksa/default-maps/*.json; do
  [[ -e "$profile" ]] || continue
  target="/data/maps/$(basename "$profile")"
  [[ -e "$target" ]] || cp "$profile" "$target"
done

# Display virtuale per Proton/Wine: nonostante sia un dedicated server, ASA
# carica comunque d3d12/dxgi/vkd3d all'avvio e li inizializza contro un vero
# DISPLAY X — il solo driver Vulkan software (lavapipe, già presente) non è
# sufficiente. Verificato dal vivo: senza Xvfb l'exe abortisce ~1s dopo l'init
# di Sentry (NONCONTINUABLE dentro ArkAscendedServer.exe stesso, prima di
# EOS/mondo).
# Il runtime di riferimento (cdp1337/ARKSurvivalAscended-Linux) fa girare un
# Xvfb persistente (non il wrapper "xvfb-run", già provato senza effetto in
# passato): qui si replica lo stesso schema, un solo processo per container.
export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1024x768x16 -nolisten tcp &
XVFB_PID=$!
for _ in {1..50}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[entrypoint] Xvfb è terminato prima di creare il display ${DISPLAY}" >&2
    exit 1
  fi
  sleep 0.1
done
[[ -S /tmp/.X11-unix/X99 ]] || {
  echo "[entrypoint] timeout in attesa del display Xvfb ${DISPLAY}" >&2
  exit 1
}

# L'entrypoint deve rendere disponibile l'agent anche quando ASA non è ancora
# installato. Installazione, controllo aggiornamenti e hook post-SteamCMD sono
# una singola fase serializzata di provisioning eseguita dall'agent subito
# prima di ogni avvio del gioco. Eseguirli anche qui crea due updater concorrenti
# e, se SteamCMD restituisce uno stato transitorio (per esempio 0x6), impedisce
# all'health endpoint di avviarsi e manda il container in restart loop.

# L'agent serve la whitelist admin su loopback; launch.sh la scrive nell'INI
# solo se questa variabile è impostata (nel target raw non lo è mai).
export ARK_ADMIN_LIST_URL="${ARK_ADMIN_LIST_URL:-http://127.0.0.1:${AGENT_PORT:-8787}/admin-whitelist.txt}"

echo "[entrypoint] Avvio server-agent…"
exec node /opt/arksa/agent/dist/src/index.js
