#!/usr/bin/env bash
set -euo pipefail

# Collega un progetto Supabase già creato e applica soltanto le migration
# versionate. Le credenziali Google Auth restano nel dashboard/provider e non
# vengono mai scritte in questo repository.
: "${SUPABASE_PROJECT_REF:?Esporta SUPABASE_PROJECT_REF}"

read -r -s -p "Password database Supabase: " arksa_supabase_db_password
printf '\n'

supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$arksa_supabase_db_password"
supabase db push --password "$arksa_supabase_db_password"
supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF"

unset arksa_supabase_db_password
