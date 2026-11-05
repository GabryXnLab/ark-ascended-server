-- Fondazione multi-community additiva.
--
-- La community legacy rappresenta il server già in produzione senza spostare,
-- duplicare o riscrivere i file persistenti correnti. Le risorse OCI restano
-- fuori da questa migration: `adapter = legacy` è soltanto un binding logico.

create table if not exists public.arksa_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email = lower(email)),
  name text not null,
  avatar_url text,
  public_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists arksa_profiles_public_handle_idx
  on public.arksa_profiles (lower(public_handle)) where public_handle is not null;

create table if not exists public.arksa_communities (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  name text not null check (char_length(name) between 3 and 80),
  description text not null default '' check (char_length(description) <= 600),
  language text not null default 'it' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  region text not null default 'us-ashburn-1',
  visibility text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  join_policy text not null default 'request' check (join_policy in ('request', 'invite', 'closed')),
  lifecycle text not null default 'active' check (lifecycle in ('draft', 'active', 'suspended', 'closing', 'archived')),
  members_enabled boolean not null default true,
  billing_exempt boolean not null default false,
  legacy boolean not null default false,
  created_by uuid references public.arksa_profiles (user_id) on delete restrict,
  search_text text generated always as (lower(name || ' ' || slug || ' ' || coalesce(description, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists arksa_communities_one_legacy_idx
  on public.arksa_communities (legacy) where legacy;
create index if not exists arksa_communities_discovery_idx
  on public.arksa_communities (visibility, lifecycle, created_at desc);
create index if not exists arksa_communities_search_idx
  on public.arksa_communities (search_text text_pattern_ops);

create table if not exists public.arksa_community_memberships (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete cascade,
  user_id uuid not null references public.arksa_profiles (user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'moderator', 'member')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  permissions jsonb not null default '{"power":false,"mapSwitch":false,"timer":false,"proposeMods":false,"proposeMapInstall":false,"proposeIni":false,"proposeConfig":false,"proposeDelete":false,"applyConfig":false}'::jsonb,
  joined_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);

create unique index if not exists arksa_community_one_owner_idx
  on public.arksa_community_memberships (community_id) where role = 'owner' and status = 'active';
create unique index if not exists arksa_community_one_owned_per_user_idx
  on public.arksa_community_memberships (user_id) where role = 'owner' and status = 'active';
create index if not exists arksa_community_memberships_user_idx
  on public.arksa_community_memberships (user_id, status);

create table if not exists public.arksa_community_invitations (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete cascade,
  email text not null check (email = lower(email)),
  permissions jsonb not null default '{"power":false,"mapSwitch":false,"timer":false,"proposeMods":false,"proposeMapInstall":false,"proposeIni":false,"proposeConfig":false,"proposeDelete":false,"applyConfig":false}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'revoked')),
  claimed_by uuid references public.arksa_profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (community_id, email)
);

create index if not exists arksa_community_invitations_email_idx
  on public.arksa_community_invitations (email, status);

create table if not exists public.arksa_community_join_requests (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete cascade,
  requester_user_id uuid not null references public.arksa_profiles (user_id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_user_id uuid references public.arksa_profiles (user_id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists arksa_join_requests_one_pending_idx
  on public.arksa_community_join_requests (community_id, requester_user_id)
  where status = 'pending';
create index if not exists arksa_join_requests_review_idx
  on public.arksa_community_join_requests (community_id, status, created_at desc);

create table if not exists public.arksa_game_servers (
  id uuid primary key,
  community_id uuid not null unique references public.arksa_communities (id) on delete restrict,
  name text not null,
  adapter text not null check (adapter in ('legacy', 'fleet')),
  lifecycle text not null default 'unallocated' check (lifecycle in ('unallocated', 'provisioning', 'ready', 'suspended', 'deleting', 'deleted', 'error')),
  region text not null default 'us-ashburn-1',
  desired_state text not null default 'stopped' check (desired_state in ('stopped', 'running')),
  generation integer not null default 1 check (generation > 0),
  release_channel text not null default 'legacy',
  provisioning_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, id)
);

create table if not exists public.arksa_billing_accounts (
  id uuid primary key,
  community_id uuid not null unique references public.arksa_communities (id) on delete restrict,
  provider text not null default 'stripe',
  provider_customer_id text unique,
  status text not null default 'not_configured' check (status in ('not_configured', 'pending', 'funded', 'past_due', 'closed')),
  balance_minor bigint not null default 0 check (balance_minor >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.arksa_server_operations (
  id uuid primary key,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  kind text not null,
  idempotency_key text not null unique,
  generation integer not null check (generation > 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by uuid references public.arksa_profiles (user_id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  deadline_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict
);

create index if not exists arksa_server_operations_worker_idx
  on public.arksa_server_operations (status, created_at);

-- Tabelle tenant-scoped per la futura lane fleet. Il server legacy continua a
-- usare i file correnti attraverso i binding dichiarati più sotto: nessuna
-- copia incompleta può diventare accidentalmente la nuova fonte di verità.
create table if not exists public.arksa_game_configurations (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  name text not null,
  configuration jsonb not null,
  created_by uuid references public.arksa_profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, server_id, id),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict
);

create table if not exists public.arksa_change_requests (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'approved', 'rejected', 'failed')),
  submitted_by uuid references public.arksa_profiles (user_id) on delete set null,
  reviewed_by uuid references public.arksa_profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict
);

create index if not exists arksa_change_requests_review_idx
  on public.arksa_change_requests (community_id, server_id, status, created_at desc);

create table if not exists public.arksa_play_sessions (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  player_id text not null,
  player_name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict
);

create index if not exists arksa_play_sessions_range_idx
  on public.arksa_play_sessions (community_id, server_id, started_at desc);

create table if not exists public.arksa_savegames (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  configuration_id uuid,
  object_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'backup_failed', 'deleting')),
  backed_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, server_id, object_key),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict,
  foreign key (community_id, server_id, configuration_id) references public.arksa_game_configurations (community_id, server_id, id) on delete restrict
);

create table if not exists public.arksa_legacy_data_bindings (
  community_id uuid not null references public.arksa_communities (id) on delete restrict,
  server_id uuid not null references public.arksa_game_servers (id) on delete restrict,
  data_kind text not null check (data_kind in ('configurations', 'current_configuration', 'change_requests', 'boot_queue', 'playtime', 'savegames')),
  source text not null default 'control_plane_file' check (source = 'control_plane_file'),
  authority text not null default 'authoritative' check (authority in ('authoritative', 'shadow', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community_id, server_id, data_kind),
  foreign key (community_id, server_id) references public.arksa_game_servers (community_id, id) on delete restrict
);

create table if not exists public.arksa_provider_events (
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

-- Binding logico e stabile del sistema attuale. Non contiene OCID e non causa
-- alcuna operazione sull'infrastruttura.
insert into public.arksa_communities (
  id, slug, name, description, visibility, join_policy, lifecycle,
  members_enabled, billing_exempt, legacy
)
values (
  '00000000-0000-4000-8000-000000000001',
  'arksa-originale',
  'ARKSA — Community originale',
  'Community migrata dal server ARKSA esistente.',
  'public',
  'request',
  'active',
  coalesce((select friends_enabled from public.arksa_settings where id = true), true),
  true,
  true
)
on conflict (id) do update set
  members_enabled = excluded.members_enabled,
  billing_exempt = true,
  legacy = true;

insert into public.arksa_game_servers (
  id, community_id, name, adapter, lifecycle, desired_state,
  release_channel, provisioning_enabled
)
values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Server ARKSA originale',
  'legacy',
  'ready',
  'stopped',
  'legacy',
  false
)
on conflict (id) do nothing;

insert into public.arksa_legacy_data_bindings (community_id, server_id, data_kind)
select
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  data_kind
from unnest(array[
  'configurations',
  'current_configuration',
  'change_requests',
  'boot_queue',
  'playtime',
  'savegames'
]::text[]) as data_kind
on conflict (community_id, server_id, data_kind) do nothing;

-- Profili e membership degli amici che hanno già effettuato il login.
insert into public.arksa_profiles (user_id, email, name, avatar_url)
select
  m.auth_user_id,
  m.email,
  coalesce(nullif(m.name, ''), split_part(m.email, '@', 1)),
  m.avatar_url
from public.arksa_members m
join auth.users u on u.id = m.auth_user_id
where m.auth_user_id is not null
on conflict (user_id) do update set
  email = excluded.email,
  name = excluded.name,
  avatar_url = excluded.avatar_url;

insert into public.arksa_community_memberships (
  id, community_id, user_id, role, status, permissions, joined_at, last_used_at
)
select
  m.id,
  '00000000-0000-4000-8000-000000000001',
  m.auth_user_id,
  'member',
  case when m.disabled then 'suspended' else 'active' end,
  m.permissions,
  m.invited_at,
  m.last_used_at
from public.arksa_members m
join public.arksa_profiles p on p.user_id = m.auth_user_id
where m.auth_user_id is not null and m.status = 'accepted'
on conflict (community_id, user_id) do nothing;

-- Le email autorizzate che non hanno ancora effettuato il login restano
-- rivendicabili: nessun invito o permesso corrente viene perso.
insert into public.arksa_community_invitations (
  id, community_id, email, permissions, status, created_at
)
select
  m.id,
  '00000000-0000-4000-8000-000000000001',
  m.email,
  m.permissions,
  case when m.status = 'rejected' then 'revoked' else 'pending' end,
  m.invited_at
from public.arksa_members m
where m.auth_user_id is null
on conflict (community_id, email) do nothing;

-- RLS chiusa: per ora tutte le query applicative passano dal backend. Questo
-- evita di esporre email, billing e riferimenti infrastrutturali al browser.
alter table public.arksa_profiles enable row level security;
alter table public.arksa_communities enable row level security;
alter table public.arksa_community_memberships enable row level security;
alter table public.arksa_community_invitations enable row level security;
alter table public.arksa_community_join_requests enable row level security;
alter table public.arksa_game_servers enable row level security;
alter table public.arksa_billing_accounts enable row level security;
alter table public.arksa_server_operations enable row level security;
alter table public.arksa_game_configurations enable row level security;
alter table public.arksa_change_requests enable row level security;
alter table public.arksa_play_sessions enable row level security;
alter table public.arksa_savegames enable row level security;
alter table public.arksa_legacy_data_bindings enable row level security;
alter table public.arksa_provider_events enable row level security;

revoke all on public.arksa_profiles from anon, authenticated;
revoke all on public.arksa_communities from anon, authenticated;
revoke all on public.arksa_community_memberships from anon, authenticated;
revoke all on public.arksa_community_invitations from anon, authenticated;
revoke all on public.arksa_community_join_requests from anon, authenticated;
revoke all on public.arksa_game_servers from anon, authenticated;
revoke all on public.arksa_billing_accounts from anon, authenticated;
revoke all on public.arksa_server_operations from anon, authenticated;
revoke all on public.arksa_game_configurations from anon, authenticated;
revoke all on public.arksa_change_requests from anon, authenticated;
revoke all on public.arksa_play_sessions from anon, authenticated;
revoke all on public.arksa_savegames from anon, authenticated;
revoke all on public.arksa_legacy_data_bindings from anon, authenticated;
revoke all on public.arksa_provider_events from anon, authenticated;

drop trigger if exists arksa_profiles_updated_at on public.arksa_profiles;
create trigger arksa_profiles_updated_at before update on public.arksa_profiles
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_communities_updated_at on public.arksa_communities;
create trigger arksa_communities_updated_at before update on public.arksa_communities
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_community_memberships_updated_at on public.arksa_community_memberships;
create trigger arksa_community_memberships_updated_at before update on public.arksa_community_memberships
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_community_invitations_updated_at on public.arksa_community_invitations;
create trigger arksa_community_invitations_updated_at before update on public.arksa_community_invitations
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_community_join_requests_updated_at on public.arksa_community_join_requests;
create trigger arksa_community_join_requests_updated_at before update on public.arksa_community_join_requests
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_game_servers_updated_at on public.arksa_game_servers;
create trigger arksa_game_servers_updated_at before update on public.arksa_game_servers
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_billing_accounts_updated_at on public.arksa_billing_accounts;
create trigger arksa_billing_accounts_updated_at before update on public.arksa_billing_accounts
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_server_operations_updated_at on public.arksa_server_operations;
create trigger arksa_server_operations_updated_at before update on public.arksa_server_operations
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_game_configurations_updated_at on public.arksa_game_configurations;
create trigger arksa_game_configurations_updated_at before update on public.arksa_game_configurations
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_change_requests_updated_at on public.arksa_change_requests;
create trigger arksa_change_requests_updated_at before update on public.arksa_change_requests
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_savegames_updated_at on public.arksa_savegames;
create trigger arksa_savegames_updated_at before update on public.arksa_savegames
for each row execute function public.arksa_set_updated_at();

drop trigger if exists arksa_legacy_data_bindings_updated_at on public.arksa_legacy_data_bindings;
create trigger arksa_legacy_data_bindings_updated_at before update on public.arksa_legacy_data_bindings
for each row execute function public.arksa_set_updated_at();
