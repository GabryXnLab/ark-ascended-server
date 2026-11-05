create table if not exists public.arksa_settings (
  id boolean primary key default true check (id),
  friends_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.arksa_settings (id, friends_enabled)
values (true, true)
on conflict (id) do nothing;

create table if not exists public.arksa_members (
  id uuid primary key,
  email text not null unique check (email = lower(email)),
  name text,
  avatar_url text,
  auth_user_id uuid unique,
  permissions jsonb not null default '{"power":true,"mapSwitch":false,"timer":false,"proposeMods":false,"proposeMapInstall":false,"proposeIni":false,"proposeConfig":false,"proposeDelete":false,"applyConfig":false}'::jsonb,
  disabled boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  invitation_token_hash text unique,
  invited_at timestamptz not null default now(),
  invitation_expires_at timestamptz,
  responded_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arksa_members_status_idx on public.arksa_members (status);
create index if not exists arksa_members_email_idx on public.arksa_members (email);

alter table public.arksa_settings enable row level security;
alter table public.arksa_members enable row level security;

-- Nessuna policy per anon/authenticated: soltanto la secret key del backend
-- (che bypassa RLS) può leggere email, inviti e permessi.
revoke all on public.arksa_settings from anon, authenticated;
revoke all on public.arksa_members from anon, authenticated;

create or replace function public.arksa_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists arksa_settings_updated_at on public.arksa_settings;
create trigger arksa_settings_updated_at before update on public.arksa_settings
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_members_updated_at on public.arksa_members;
create trigger arksa_members_updated_at before update on public.arksa_members
for each row execute function public.arksa_set_updated_at();
