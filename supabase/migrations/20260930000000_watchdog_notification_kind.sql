-- Notifica in-app generata dal watchdog del control plane quando spegne una VM
-- rimasta accesa senza che ASA diventasse RCON-online (vedi offline-watchdog.ts).
-- Il backend la registra best-effort: senza questa migration lo spegnimento
-- avviene comunque, manca soltanto la voce nel feed.

alter table public.arksa_community_notifications
  drop constraint if exists arksa_community_notifications_kind_check;

alter table public.arksa_community_notifications
  add constraint arksa_community_notifications_kind_check
  check (kind in ('server_start_requested', 'server_online', 'server_watchdog_stopped'));
