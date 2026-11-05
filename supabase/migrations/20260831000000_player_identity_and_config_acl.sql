-- Collega in modo stabile l'identita Google al giocatore ASA e prepara il
-- modello ACL anche per la futura persistenza tenant-scoped. Il server legacy
-- continua a usare configs.json come fonte autorevole (D19).

alter table public.arksa_profiles
  add column if not exists ark_account_id text;

alter table public.arksa_profiles
  drop constraint if exists arksa_profiles_ark_account_id_format;
alter table public.arksa_profiles
  add constraint arksa_profiles_ark_account_id_format
  check (ark_account_id is null or ark_account_id ~ '^[A-Za-z0-9]{32}$');

create unique index if not exists arksa_profiles_ark_account_id_idx
  on public.arksa_profiles (ark_account_id)
  where ark_account_id is not null;

alter table public.arksa_game_configurations
  add column if not exists access_control jsonb not null default
    '{"administratorLocked":false,"grants":{}}'::jsonb;

comment on column public.arksa_profiles.ark_account_id is
  'EOS/ARK account ID di 32 caratteri collegato dall utente alla propria identita Google';
comment on column public.arksa_game_configurations.access_control is
  'ACL per-configurazione: blocco amministrativo e grant review/full indicizzati per user_id';
