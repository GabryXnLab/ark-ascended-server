-- Sincronizza atomically i ruoli illimitati della community legacy con
-- ADMIN_EMAILS. La funzione gira soltanto tramite service_role dal backend.

create or replace function public.arksa_sync_legacy_admins(p_admin_emails text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  legacy_community constant uuid := '00000000-0000-4000-8000-000000000001';
  desired_owner uuid;
  owner_eligible boolean := false;
begin
  if coalesce(cardinality(p_admin_emails), 0) > 0 then
    select p.user_id
      into desired_owner
      from public.arksa_profiles p
     where p.email = lower(p_admin_emails[1])
     limit 1;
  end if;

  if desired_owner is not null then
    select not exists (
      select 1
        from public.arksa_community_memberships owned
       where owned.user_id = desired_owner
         and owned.community_id <> legacy_community
         and owned.role = 'owner'
         and owned.status = 'active'
    ) into owner_eligible;
  end if;

  -- Libera l'indice one-owner prima della promozione. Se il nuovo titolare non
  -- è ancora noto o possiede già un'altra community, nessun ruolo obsoleto
  -- resta illimitato: gli admin continuano a gestire, ma l'env va corretto per
  -- riottenere un owner.
  update public.arksa_community_memberships membership
     set role = case
       when array_position(p_admin_emails, profile.email) is not null then 'admin'
       else 'member'
     end
    from public.arksa_profiles profile
   where membership.community_id = legacy_community
     and membership.user_id = profile.user_id
     and membership.role = 'owner'
     and (not owner_eligible or membership.user_id <> desired_owner);

  -- Tutti gli indirizzi ADMIN_EMAILS già autenticati vengono riattivati e
  -- ricevono il ruolo esatto. L'upsert è nello stesso statement/transaction
  -- della demozione precedente, quindi non espone due owner concorrenti.
  insert into public.arksa_community_memberships (
    id, community_id, user_id, role, status, permissions, joined_at
  )
  select
    gen_random_uuid(),
    legacy_community,
    profile.user_id,
    case
      when owner_eligible and profile.user_id = desired_owner then 'owner'
      else 'admin'
    end,
    'active',
    '{"power":false,"mapSwitch":false,"timer":false,"proposeMods":false,"proposeMapInstall":false,"proposeIni":false,"proposeConfig":false,"proposeDelete":false,"applyConfig":false}'::jsonb,
    now()
  from public.arksa_profiles profile
  where array_position(p_admin_emails, profile.email) is not null
  on conflict (community_id, user_id) do update set
    role = excluded.role,
    status = 'active';

  -- Un indirizzo rimosso dall'env perde il ruolo illimitato nello stesso
  -- commit. Membership e permessi granulari restano disponibili come membro.
  update public.arksa_community_memberships membership
     set role = 'member'
    from public.arksa_profiles profile
   where membership.community_id = legacy_community
     and membership.user_id = profile.user_id
     and membership.role = 'admin'
     and array_position(p_admin_emails, profile.email) is null;
end;
$$;

revoke all on function public.arksa_sync_legacy_admins(text[]) from public, anon, authenticated;
grant execute on function public.arksa_sync_legacy_admins(text[]) to service_role;
