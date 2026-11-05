#!/usr/bin/env bash
set -euo pipefail

# Abilita Google Auth sul progetto Supabase senza scrivere il client secret su
# disco o nella shell history. La creazione del client Web resta un'azione
# manuale obbligatoria nel Google Auth Platform.
arksa_project_ref="${SUPABASE_PROJECT_REF:-your-project-ref}"
arksa_access_token_file="${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}"

[[ -f "$arksa_access_token_file" ]] || {
  echo "Token CLI Supabase mancante: esegui prima 'supabase login'." >&2
  exit 1
}

read -r -p "Client ID Google (Web primo; altri separati da virgola): " arksa_google_client_id
read -r -s -p "Client secret Google Web: " arksa_google_client_secret
printf '\n'

arksa_supabase_access_token=""
IFS= read -r arksa_supabase_access_token < "$arksa_access_token_file" || true

arksa_payload="$(jq -n \
  --arg client_id "$arksa_google_client_id" \
  --arg client_secret "$arksa_google_client_secret" \
  '{external_google_enabled:true, external_google_client_id:$client_id, external_google_secret:$client_secret}')"

curl -fsS -X PATCH \
  -H "Authorization: Bearer $arksa_supabase_access_token" \
  -H "Content-Type: application/json" \
  -d "$arksa_payload" \
  "https://api.supabase.com/v1/projects/$arksa_project_ref/config/auth" \
  | jq '{site_url, uri_allow_list, external_google_enabled, external_google_client_id}'

unset arksa_google_client_secret arksa_supabase_access_token arksa_payload
echo "Google Auth abilitato su Supabase."
