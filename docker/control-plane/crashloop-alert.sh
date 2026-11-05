#!/usr/bin/env bash
# Rileva un crash-loop del container backend del control plane e notifica via
# ntfy. Non viene eseguito automaticamente da nulla in questo repo: va lanciato
# periodicamente (cron/systemd timer) sull'host dove gira il container: un
# crash-loop prolungato altrimenti passa inosservato.
#
# Uso tipico (crontab, ogni 5 minuti):
#   */5 * * * * NTFY_URL=http://localhost/arksa-alerts \
#     /path/to/crashloop-alert.sh >> /var/log/arksa-crashloop-alert.log 2>&1
set -euo pipefail

CONTAINER="${CONTAINER:-arksa-control-plane-backend-1}"
NTFY_URL="${NTFY_URL:?imposta NTFY_URL, es. http://localhost/arksa-alerts}"
# Soglia coerente con quanto discusso nella issue: RestartCount anomalo se
# supera questo valore entro la finestra STATE_TTL_SEC.
THRESHOLD="${CRASHLOOP_THRESHOLD:-20}"
STATE_TTL_SEC="${STATE_TTL_SEC:-3600}"
STATE_FILE="${STATE_FILE:-/var/tmp/arksa-crashloop-alert.state}"

restart_count="$(docker inspect --format='{{.RestartCount}}' "$CONTAINER" 2>/dev/null)" || {
  echo "crashloop-alert: impossibile leggere RestartCount di $CONTAINER (container fermo/inesistente?)" >&2
  exit 0
}

now="$(date +%s)"
prev_count="$restart_count"
prev_ts="$now"
alerted=0
if [[ -f "$STATE_FILE" ]]; then
  read -r prev_count prev_ts alerted < "$STATE_FILE" || true
fi

# Finestra scaduta: apre una nuova finestra di osservazione da questo conteggio.
if (( now - prev_ts > STATE_TTL_SEC )); then
  prev_count="$restart_count"
  prev_ts="$now"
  alerted=0
fi

delta=$(( restart_count - prev_count ))

if (( delta >= THRESHOLD )) && (( alerted == 0 )); then
  curl -fsS -X POST "$NTFY_URL" \
    -H "Title: Crash-loop rilevato: $CONTAINER" \
    -H "Priority: urgent" \
    -H "Tags: rotating_light" \
    -d "RestartCount +$delta nell'ultima ora (ora a $restart_count)." \
    >/dev/null || echo "crashloop-alert: invio notifica ntfy fallito" >&2
  alerted=1
fi

# Baseline della finestra invariata finché non scade: il conteggio deve
# accumulare rispetto all'inizio della finestra, non rispetto all'ultimo run.
echo "$prev_count $prev_ts $alerted" > "$STATE_FILE"
