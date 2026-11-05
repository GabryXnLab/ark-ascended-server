-- Notifiche in-app persistenti e tenant-scoped.
--
-- Un evento appartiene alla community; la lettura è invece personale. La view
-- inbox incrocia soltanto membership attive e impedisce che una query priva del
-- corretto user/community context esponga notifiche di un altro tenant.

create table if not exists public.arksa_community_notifications (
  id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete cascade,
  server_id uuid not null references public.arksa_game_servers (id) on delete cascade,
  kind text not null check (kind in ('server_start_requested', 'server_online')),
  actor_user_id uuid,
  actor_name text check (actor_name is null or char_length(actor_name) between 1 and 120),
  actor_avatar_url text,
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (community_id, dedupe_key),
  foreign key (community_id, server_id)
    references public.arksa_game_servers (community_id, id) on delete cascade
);

create index if not exists arksa_community_notifications_feed_idx
  on public.arksa_community_notifications (community_id, created_at desc);

create table if not exists public.arksa_notification_reads (
  notification_id uuid not null references public.arksa_community_notifications (id) on delete cascade,
  user_id uuid not null references public.arksa_profiles (user_id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists arksa_notification_reads_user_idx
  on public.arksa_notification_reads (user_id, read_at desc);

-- Stato persistente del monitor. NULL è la baseline non ancora osservata; false
-- riabilita il prossimo passaggio a online; transition_id rende l'insert della
-- notifica ritentabile e idempotente dopo errori o restart del backend.
create table if not exists public.arksa_server_notification_state (
  server_id uuid primary key,
  community_id uuid not null references public.arksa_communities (id) on delete cascade,
  ark_online boolean,
  online_transition_id uuid,
  observed_at timestamptz not null default now(),
  foreign key (community_id, server_id)
    references public.arksa_game_servers (community_id, id) on delete cascade,
  check (ark_online is true or online_transition_id is null)
);

insert into public.arksa_server_notification_state (
  server_id, community_id, ark_online, online_transition_id
)
select id, community_id, null, null
from public.arksa_game_servers
on conflict (server_id) do nothing;

create or replace view public.arksa_notification_inbox
with (security_invoker = true)
as
select
  n.id,
  n.community_id,
  n.server_id,
  m.user_id,
  n.kind,
  n.actor_user_id,
  n.actor_name,
  n.actor_avatar_url,
  n.title,
  n.message,
  n.metadata,
  n.created_at,
  r.read_at
from public.arksa_community_notifications n
join public.arksa_community_memberships m
  on m.community_id = n.community_id and m.status = 'active'
left join public.arksa_notification_reads r
  on r.notification_id = n.id and r.user_id = m.user_id;

alter table public.arksa_community_notifications enable row level security;
alter table public.arksa_notification_reads enable row level security;
alter table public.arksa_server_notification_state enable row level security;

revoke all on public.arksa_community_notifications from anon, authenticated;
revoke all on public.arksa_notification_reads from anon, authenticated;
revoke all on public.arksa_server_notification_state from anon, authenticated;
revoke all on public.arksa_notification_inbox from anon, authenticated;
grant select on public.arksa_notification_inbox to service_role;
